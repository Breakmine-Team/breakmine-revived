import * as THREE from "../../../../../../libraries/three.module.js";
import Block from "../world/block/Block.js";
import World from "../world/World.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import BoundingBox from "../../util/BoundingBox.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import MovingObjectPosition from "../../util/MovingObjectPosition.js";
import Vector3 from "../../util/Vector3.js";
import {
    OFF_GRID_MAX_CELLS,
    OFF_GRID_MAX_DIM,
    OFF_GRID_WORLD_HEIGHT
} from "../../util/OffGridConstants.js";

export default class OffGridBlockField {

    
    static MAX_DIM = OFF_GRID_MAX_DIM;
    static MAX_CELLS = OFF_GRID_MAX_CELLS;

    
    static COLLISION_STEP = 1 / 6;

    
    static COLLISION_STEP_FINE = 1 / 12;

    
    static COLLISION_BOX_CAP = 1200;

    constructor(minecraft) {
        this.minecraft = minecraft;
        this.world = null;

        this.cells = new Map();

        this.regions = new Map();

        this.group = new THREE.Object3D();
        this.group.updateMatrix();
        this.group.matrixAutoUpdate = false;

        this.rotation = { x: 0, y: 0, z: 0 };
        this.offset = { x: 0, y: 0, z: 0 };

        this.posedBoxCache = new Map();
        this._poseContext = null;

        this.pivot = null;

        this.regionCells = new Map();

        this.localTicks = new Map();
        this.localNeighborQueue = [];
        this.processingLocalNeighborUpdates = false;

        this._localWorld = null;
        this._localWorldWorld = null;

        this._suppressCellSync = false;

        this.onCellEdit = null;
    }

    
    bind(world) {
        if (this.world !== null && this.world !== world && this.world.offGridField === this) {
            this.world.offGridField = null;
        }
        this.world = world;
        if (world) {
            world.offGridField = this;
        }
        this.attachToScene();
    }

    
    dispose() {
        this.clear();
        if (this.world && this.world.offGridField === this) {
            this.world.offGridField = null;
        }
        this.world = null;
        if (this.group.parent) {
            this.group.parent.remove(this.group);
        }
    }

    attachToScene() {
        const worldRenderer = this.minecraft && this.minecraft.worldRenderer;
        const scene = worldRenderer && worldRenderer.scene;
        if (scene && this.group.parent !== scene) {
            scene.add(this.group);
        }
    }


    covers(x, y, z) {
        return this.cells.has(x + "," + y + "," + z);
    }

    
    regionKeyOf(x, y, z) {
        return ((x >> 4) << 4) + "," + ((y >> 4) << 4) + "," + ((z >> 4) << 4);
    }

    addToRegionIndex(x, y, z) {
        const key = this.regionKeyOf(x, y, z);
        let set = this.regionCells.get(key);
        if (!set) {
            set = new Set();
            this.regionCells.set(key, set);
        }
        set.add(x + "," + y + "," + z);
    }

    removeFromRegionIndex(x, y, z) {
        const key = this.regionKeyOf(x, y, z);
        const set = this.regionCells.get(key);
        if (set) {
            set.delete(x + "," + y + "," + z);
            if (set.size === 0) this.regionCells.delete(key);
        }
    }

    
    markWorldSectionsDirty(minX, minY, minZ, maxX, maxY, maxZ) {
        const world = this.world || (this.minecraft && this.minecraft.world);
        if (world && typeof world.setModified === "function") {
            world.setModified(minX - 1, minY - 1, minZ - 1, maxX + 1, maxY + 1, maxZ + 1);
        }
    }

    
    getBlockAt(x, y, z) {
        const cell = this.cells.get(x + "," + y + "," + z);
        return cell === undefined ? -1 : cell.typeId;
    }

    
    getBlockDataAt(x, y, z) {
        const cell = this.cells.get(x + "," + y + "," + z);
        return cell === undefined ? -1 : cell.data;
    }

    
    applyWrite(xRaw, yRaw, zRaw, typeId, data = 0, fromNetwork = false) {
        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        const key = x + "," + y + "," + z;
        const existing = this.cells.get(key);

        if (!typeId) {
            if (existing === undefined) return false;
            this.cells.delete(key);
            this.removeFromRegionIndex(x, y, z);
        } else {
            const nextData = data || 0;
            if (existing && existing.typeId === typeId && existing.data === nextData) {
                return false;
            }
            this.cells.set(key, { x, y, z, typeId, data: nextData });
            this.addToRegionIndex(x, y, z);
        }

        this.applyTransform();
        this.rebuildAround(x, y, z);

        this.markWorldSectionsDirty(x, y, z, x, y, z);

        if (typeof this.onCellEdit === "function") {
            try {
                this.onCellEdit(x, y, z, typeId ? typeId : 0, typeId ? (data || 0) : 0);
            } catch (e) {
                console.error(`offGridField cell edit hook error at ${x},${y},${z}:`, e);
            }
        }

        if (!fromNetwork && !this._suppressCellSync && typeof this.onCellChanged === "function") {
            try {
                this.onCellChanged(x, y, z, typeId ? typeId : 0, typeId ? (data || 0) : 0);
            } catch (e) {
                console.error(`offGridField cell sync error at ${x},${y},${z}:`, e);
            }
        }
        return true;
    }

    
    applyRemoteWrite(x, y, z, typeId, data = 0) {
        const changed = this.applyWrite(x, y, z, typeId, data, true);
        if (changed) this.initializeBlockState(Math.floor(x), Math.floor(y), Math.floor(z));
        return changed;
    }

    
    initializeBlockState(xRaw, yRaw, zRaw) {
        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        const cell = this.cells.get(x + "," + y + "," + z);
        if (cell === undefined) return;

        const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
        if (!block) return;

        if (!block.isPowerSource && !block.isBluestoneConsumer) return;

        const localWorld = this.createLocalWorld();
        if (!localWorld) return;

        const wasSuppressed = this._suppressCellSync;
        this._suppressCellSync = true;
        try {
            if (typeof block.onBlockAdded === 'function') {
                block.onBlockAdded(localWorld, x, y, z);
            } else if (typeof block.onBlockTick === 'function') {
                this.scheduleLocalTick(x, y, z, 1);
            }
        } catch (e) {
            console.error(`offGridField block init error at ${x},${y},${z}:`, e);
        } finally {
            this._suppressCellSync = wasSuppressed;
        }
    }

    
    initializeBlockStates() {
        for (const cell of this.cells.values()) {
            this.initializeBlockState(cell.x, cell.y, cell.z);
        }
    }

    
    applyNetworkSnapshot(cells, rotation, offset, pivot) {
        this.clear();

        const list = Array.isArray(cells) ? cells : [];
        for (let i = 0; i < list.length && this.cells.size < OFF_GRID_MAX_CELLS; i++) {
            const cell = list[i];
            if (!cell) continue;

            const x = Math.trunc(cell.x);
            const y = Math.trunc(cell.y);
            const z = Math.trunc(cell.z);
            const typeId = Math.trunc(cell.typeId);
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
            if (y < 0 || y >= OFF_GRID_WORLD_HEIGHT) continue;
            if (!Number.isInteger(typeId) || typeId <= 0) continue;
            if (!Block.getById(typeId) && !BlockRegistry.get(typeId)) continue;

            const data = Number.isInteger(cell.data) ? (cell.data & 0xF) : 0;
            this.cells.set(x + "," + y + "," + z, { x, y, z, typeId, data });
            this.addToRegionIndex(x, y, z);
        }

        const numberOrZero = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
        this.rotation = {
            x: numberOrZero(rotation && rotation.x),
            y: numberOrZero(rotation && rotation.y),
            z: numberOrZero(rotation && rotation.z)
        };
        this.offset = {
            x: numberOrZero(offset && offset.x),
            y: numberOrZero(offset && offset.y),
            z: numberOrZero(offset && offset.z)
        };
        this.pivot = pivot && Number.isFinite(pivot.x) && Number.isFinite(pivot.y) && Number.isFinite(pivot.z)
            ? { x: pivot.x, y: pivot.y, z: pivot.z }
            : null;

        const bounds = this.getBounds();
        if (bounds) {
            this.markWorldSectionsDirty(
                bounds.minX, bounds.minY, bounds.minZ,
                bounds.maxX, bounds.maxY, bounds.maxZ);
        }

        this.applyTransform();
        for (const key of [...this.regionCells.keys()]) {
            const parts = key.split(",");
            this.rebuildRegion(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
        }

        this.initializeBlockStates();
    }

    
    setPose(rotation, offset, pivot) {
        const bounds = this.getBounds();
        const numberOrZero = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;

        this.rotation = {
            x: numberOrZero(rotation && rotation.x),
            y: numberOrZero(rotation && rotation.y),
            z: numberOrZero(rotation && rotation.z)
        };
        this.offset = {
            x: numberOrZero(offset && offset.x),
            y: numberOrZero(offset && offset.y),
            z: numberOrZero(offset && offset.z)
        };
        this.pivot = pivot && Number.isFinite(pivot.x) && Number.isFinite(pivot.y) && Number.isFinite(pivot.z)
            ? { x: pivot.x, y: pivot.y, z: pivot.z }
            : null;

        if (bounds) {
            this.markWorldSectionsDirty(
                bounds.minX, bounds.minY, bounds.minZ,
                bounds.maxX, bounds.maxY, bounds.maxZ);
        }

        this.applyTransform();
        for (const key of [...this.regionCells.keys()]) {
            const parts = key.split(",");
            this.rebuildRegion(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
        }
    }


    
    mapLocalToWorldInt(x, y, z) {
        const w = this.localToWorld({ x, y, z });
        return { x: Math.floor(w.x), y: Math.floor(w.y), z: Math.floor(w.z) };
    }

    
    readLocal(x, y, z, kind = "block") {
        const cell = this.cells.get(x + "," + y + "," + z);
        if (cell) return kind === "data" ? cell.data : cell.typeId;

        const world = this.minecraft && this.minecraft.world;
        if (!world) return 0;
        const w = this.mapLocalToWorldInt(x, y, z);
        if (w.y < 0 || w.y >= World.TOTAL_HEIGHT) return 0;
        return kind === "data"
            ? world.getBlockDataAt(w.x, w.y, w.z)
            : world.getBlockAt(w.x, w.y, w.z);
    }

    
    setLocalBlock(xRaw, yRaw, zRaw, type, data = 0, events = true) {
        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);

        const localWorld = this.createLocalWorld();
        if (!localWorld) return;

        const oldTypeId = this.readLocal(x, y, z);
        const oldBlock = Block.getById(oldTypeId);

        if (events && oldBlock && oldBlock.onBlockRemoved && (type === 0 || oldTypeId !== type)) {
            try {
                oldBlock.onBlockRemoved(localWorld, x, y, z);
            } catch (e) {
                console.error(`offGridField onBlockRemoved error at ${x},${y},${z}:`, e);
            }
        }

        this.applyWrite(x, y, z, type, data);

        if (events) {
            const newBlock = Block.getById(type);
            if (newBlock) {
                const freshWorld = this.createLocalWorld() || localWorld;
                if (typeof newBlock.onBlockPlaced === "function") {
                    try {
                        newBlock.onBlockPlaced(freshWorld, x, y, z, null);
                    } catch (e) {
                        console.error(`offGridField onBlockPlaced error at ${x},${y},${z}:`, e);
                    }
                }
                if (typeof newBlock.onBlockAdded === "function") {
                    try {
                        newBlock.onBlockAdded(freshWorld, x, y, z);
                    } catch (e) {
                        console.error(`offGridField onBlockAdded error at ${x},${y},${z}:`, e);
                    }
                }
            }
            this.notifyNeighbors(x, y, z, true);
        }
    }

    
    setLocalData(xRaw, yRaw, zRaw, data) {
        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        const cell = this.cells.get(x + "," + y + "," + z);
        if (cell === undefined) return;
        this.applyWrite(x, y, z, cell.typeId, data);
    }

    
    notifyNeighbors(xRaw, yRaw, zRaw, recursive) {
        const localWorld = this.createLocalWorld();
        if (!localWorld) return;

        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);

        if (recursive) {
            this.localNeighborQueue.push([x, y, z]);
        }

        this.processingLocalNeighborUpdates = true;
        try {
            const faces = [
                { x: 1, y: 0, z: 0 }, { x: -1, y: 0, z: 0 },
                { x: 0, y: 0, z: 1 }, { x: 0, y: 0, z: -1 },
                { x: 0, y: 1, z: 0 }, { x: 0, y: -1, z: 0 }
            ];
            const queue = (recursive ? this.localNeighborQueue : [[x, y, z]]);
            let steps = 0;
            while (queue.length > 0 && steps < 16384) {
                const [cx, cy, cz] = queue.pop();
                steps++;

                for (const face of faces) {
                    const nx = cx + face.x;
                    const ny = cy + face.y;
                    const nz = cz + face.z;
                    const typeId = this.readLocal(nx, ny, nz);
                    if (typeId === 0) continue;
                    const block = Block.getById(typeId);
                    if (block && typeof block.onNeighborBlockChange === "function") {
                        block.onNeighborBlockChange(localWorld, nx, ny, nz, x, y, z);
                    }
                }
            }
            if (steps >= 16384) {
                console.warn("offGridField neighbor cascade capped after 16384 steps (oscillating bluestone circuit?)");
            }
        } finally {
            if (recursive) this.localNeighborQueue = [];
            this.processingLocalNeighborUpdates = false;
        }
    }

    
    scheduleLocalTick(xRaw, yRaw, zRaw, delay) {
        const world = this.minecraft && this.minecraft.world;
        if (!world) return;

        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        this.localTicks.set(x + "," + y + "," + z, { x, y, z, time: world.time + delay });
    }

    
    scheduleLocalNeighborTicks(xRaw, yRaw, zRaw) {
        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    const neighbor = { x: x + dx, y: y + dy, z: z + dz };
                    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) > 1) continue;
                    const typeId = this.readLocal(neighbor.x, neighbor.y, neighbor.z);
                    if (typeId !== 0) {
                        const block = Block.getById(typeId);
                        if (block && block.onBlockTick) {
                            this.scheduleLocalTick(neighbor.x, neighbor.y, neighbor.z, 1);
                        }
                    }
                }
            }
        }
    }

    
    tickBlocks() {
        if (this.localTicks.size === 0) return;

        const world = this.minecraft && this.minecraft.world;
        if (!world) return;

        const localWorld = this.createLocalWorld();
        if (!localWorld) return;

        let iterations = 0;
        for (const [key, tick] of [...this.localTicks]) {
            if (world.time < tick.time) continue;
            iterations++;
            this.localTicks.delete(key);
            const cell = this.cells.get(tick.x + "," + tick.y + "," + tick.z);
            if (cell === undefined) continue;
            const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
            if (block && typeof block.onBlockTick === "function") {
                try {
                    block.onBlockTick(localWorld, cell.x, cell.y, cell.z);
                } catch (e) {
                    console.error(`offGridField onBlockTick error at ${cell.x},${cell.y},${cell.z}:`, e);
                }
                if (iterations >= 512) {
                    this.localTicks.delete(key);
                    break; 
                }
            }
        }
    }

    
    fill(minXRaw, minYRaw, minZRaw, sizeX, sizeY, sizeZ, typeId, data = 0) {
        const minX = Math.floor(minXRaw);
        const minY = Math.floor(minYRaw);
        const minZ = Math.floor(minZRaw);
        const regionKeys = new Set();

        for (let x = minX; x < minX + sizeX; x++) {
            for (let y = minY; y < minY + sizeY; y++) {
                for (let z = minZ; z < minZ + sizeZ; z++) {
                    this.cells.set(x + "," + y + "," + z, { x, y, z, typeId, data: data || 0 });
                    this.addToRegionIndex(x, y, z);
                    regionKeys.add(this.regionKeyOf(x, y, z));
                }
            }
        }

        this.markWorldSectionsDirty(
            minX, minY, minZ,
            minX + sizeX - 1, minY + sizeY - 1, minZ + sizeZ - 1);

        this.applyTransform();

        for (const key of regionKeys) {
            const [rx, ry, rz] = key.split(",");
            this.rebuildRegion(parseInt(rx), parseInt(ry), parseInt(rz));
        }

        this.initializeBlockStates();

        return sizeX * sizeY * sizeZ;
    }

    
    clear() {
        const clearedBounds = this.getBounds();
        if (clearedBounds) {
            this.markWorldSectionsDirty(
                clearedBounds.minX, clearedBounds.minY, clearedBounds.minZ,
                clearedBounds.maxX, clearedBounds.maxY, clearedBounds.maxZ);
        }
        for (const region of this.regions.values()) {
            this.disposeRegion(region);
        }
        this.regions.clear();
        this.cells.clear();
        this.regionCells.clear();
        this.localTicks.clear();
        this.localNeighborQueue = [];
        this.processingLocalNeighborUpdates = false;
        this._localWorld = null;
        this._localWorldWorld = null;

        this.rotation = { x: 0, y: 0, z: 0 };
        this.offset = { x: 0, y: 0, z: 0 };
        this.group.position.set(0, 0, 0);
        this.group.rotation.set(0, 0, 0);
        this.group.updateMatrix();
        this.group.updateMatrixWorld(true);

        this.posedBoxCache.clear();
        this._poseContext = null;
        this.pivot = null;
    }


    
    getBounds() {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (const cell of this.cells.values()) {
            if (cell.x < minX) minX = cell.x;
            if (cell.y < minY) minY = cell.y;
            if (cell.z < minZ) minZ = cell.z;
            if (cell.x > maxX) maxX = cell.x;
            if (cell.y > maxY) maxY = cell.y;
            if (cell.z > maxZ) maxZ = cell.z;
        }

        return minX > maxX ? null : { minX, minY, minZ, maxX, maxY, maxZ };
    }

    
    move(dx, dy, dz, world) {
        const boundsBefore = this.getBounds();
        const deltas = { x: dx, y: dy, z: dz };
        const touched = new Set();
        let shifted = false;

        for (const axis of ["x", "y", "z"]) {
            const amount = Math.round(deltas[axis]);
            if (amount === 0) continue;
            const regions = this.shiftCellsAlongAxis(axis, amount, world);
            if (regions) {
                this.offset[axis] -= amount;
                shifted = true;
                for (const key of regions) touched.add(key);
            }
        }

        this.offset.x += dx;
        this.offset.y += dy;
        this.offset.z += dz;
        this.applyTransform();

        const keys = shifted ? touched : this.regions.keys();
        for (const key of keys) {
            const parts = key.split(",");
            this.rebuildRegion(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
        }

        if (boundsBefore) {
            this.markWorldSectionsDirty(
                boundsBefore.minX, boundsBefore.minY, boundsBefore.minZ,
                boundsBefore.maxX, boundsBefore.maxY, boundsBefore.maxZ);
        }
        const boundsAfter = this.getBounds();
        if (boundsAfter) {
            this.markWorldSectionsDirty(
                boundsAfter.minX, boundsAfter.minY, boundsAfter.minZ,
                boundsAfter.maxX, boundsAfter.maxY, boundsAfter.maxZ);
        }

        return { shifted };
    }

    
    rotate(degrees, axis) {
        this.rotation[axis] = (this.rotation[axis] || 0) + degrees;
        this.applyTransform();

        const bounds = this.getBounds();
        if (bounds) {
            this.markWorldSectionsDirty(
                bounds.minX, bounds.minY, bounds.minZ,
                bounds.maxX, bounds.maxY, bounds.maxZ);
        }
    }

    
    applyTransform() {
        const pose = this.computePose();
        this.group.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
        this.group.position.set(pose.position.x, pose.position.y, pose.position.z);

        this.group.updateMatrix();
        this.group.updateMatrixWorld(true);

        this.posedBoxCache.clear();
        this._poseContext = null;
        this._localWorld = null;
        this._localWorldWorld = null;
    }

    
    getPivot() {
        if (this.pivot !== null) return this.pivot;
        const bounds = this.getBounds();
        if (!bounds) return { x: 0, y: 0, z: 0 };
        this.pivot = {
            x: (bounds.minX + bounds.maxX + 1) / 2,
            y: (bounds.minY + bounds.maxY + 1) / 2,
            z: (bounds.minZ + bounds.maxZ + 1) / 2
        };
        return this.pivot;
    }

    
    computePose() {
        const pivot = this.getPivot();
        const pivotX = pivot.x;
        const pivotY = pivot.y;
        const pivotZ = pivot.z;

        const toRad = Math.PI / 180;
        const euler = new THREE.Euler(
            this.rotation.x * toRad,
            this.rotation.y * toRad,
            this.rotation.z * toRad,
            "XYZ"
        );

        const rotatedPivot = new THREE.Vector3(pivotX, pivotY, pivotZ).applyEuler(euler);
        return {
            position: {
                x: pivotX + this.offset.x - rotatedPivot.x,
                y: pivotY + this.offset.y - rotatedPivot.y,
                z: pivotZ + this.offset.z - rotatedPivot.z
            },
            rotation: { x: euler.x, y: euler.y, z: euler.z }
        };
    }

    getPoseTransform() {
        return this.computePose();
    }

    
    shiftCellsAlongAxis(axis, amount, world) {
        const bounds = this.getBounds();
        if (!bounds) return null;

        const minY = bounds.minY + (axis === "y" ? amount : 0);
        const maxY = bounds.maxY + (axis === "y" ? amount : 0);
        if (minY < 0 || maxY >= World.TOTAL_HEIGHT) return null;

        if (world && typeof world.chunkExists === "function") {
            const minX = bounds.minX + (axis === "x" ? amount : 0);
            const maxX = bounds.maxX + (axis === "x" ? amount : 0);
            const minZ = bounds.minZ + (axis === "z" ? amount : 0);
            const maxZ = bounds.maxZ + (axis === "z" ? amount : 0);
            for (let cx = (minX - 1) >> 4; cx <= (maxX + 1) >> 4; cx++) {
                for (let cz = (minZ - 1) >> 4; cz <= (maxZ + 1) >> 4; cz++) {
                    if (!world.chunkExists(cx, cz)) return null;
                }
            }
        }

        const oldRegions = new Set();
        const newRegions = new Set();
        const next = new Map();

        for (const cell of this.cells.values()) {
            const nx = cell.x + (axis === "x" ? amount : 0);
            const ny = cell.y + (axis === "y" ? amount : 0);
            const nz = cell.z + (axis === "z" ? amount : 0);
            oldRegions.add(((cell.x >> 4) << 4) + "," + ((cell.y >> 4) << 4) + "," + ((cell.z >> 4) << 4));
            newRegions.add(((nx >> 4) << 4) + "," + ((ny >> 4) << 4) + "," + ((nz >> 4) << 4));
            next.set(nx + "," + ny + "," + nz, { x: nx, y: ny, z: nz, typeId: cell.typeId, data: cell.data });
        }

        this.cells = next;

        if (this.pivot !== null) this.pivot[axis] += amount;

        this.regionCells = new Map();
        for (const cell of next.values()) {
            this.addToRegionIndex(cell.x, cell.y, cell.z);
        }

        return new Set([...oldRegions, ...newRegions]);
    }


    
    rebuildAround(x, y, z) {
        const regionKeys = new Set();
        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                for (let dz = -1; dz <= 1; dz++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    const nz = z + dz;
                    regionKeys.add(((nx >> 4) << 4) + "," + ((ny >> 4) << 4) + "," + ((nz >> 4) << 4));
                }
            }
        }

        for (const key of regionKeys) {
            const parts = key.split(",");
            this.rebuildRegion(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
        }
    }

    
    rebuildRegion(rx, ry, rz) {
        const world = this.minecraft && this.minecraft.world;
        const worldRenderer = this.minecraft && this.minecraft.worldRenderer;
        if (!world || !worldRenderer || !worldRenderer.blockRenderer) return;

        const cellsInRegion = [];
        const cellKeys = this.regionCells.get(rx + "," + ry + "," + rz);
        if (cellKeys) {
            for (const cellKey of cellKeys) {
                const cell = this.cells.get(cellKey);
                if (cell !== undefined) cellsInRegion.push(cell);
            }
        }

        const regionKey = rx + "," + ry + "," + rz;
        let region = this.regions.get(regionKey);

        if (cellsInRegion.length === 0) {
            if (region) {
                this.disposeRegion(region);
                this.regions.delete(regionKey);
            }
            return;
        }

        this.attachToScene();

        if (region) {
            for (const mesh of region.meshes) {
                region.group.remove(mesh);
                mesh.geometry.dispose();
                mesh.material.dispose();
            }
            region.meshes = [];
        } else {
            region = { group: new THREE.Object3D(), meshes: [] };
            this.regions.set(regionKey, region);
            this.group.add(region.group);
        }

        const blockRenderer = worldRenderer.blockRenderer;
        const tessellator = blockRenderer.tessellator;
        const ambientOcclusion = !!world.minecraft.settings.ambientOcclusion;
        const localWorld = this.createLocalWorld() || world;

        let cameraLocal = null;
        const player = world.minecraft.player;
        if (player) {
            const eye = this.worldToLocal({
                x: player.x,
                y: player.y + player.getEyeHeight(),
                z: player.z
            });
            cameraLocal = { x: eye.x, y: eye.y, z: eye.z };
        }

        for (let pass = 0; pass < 2; pass++) {
            const translucentPass = pass === 1;
            tessellator.startDrawing();
            tessellator.setRenderingPass(translucentPass);
            blockRenderer.beginModelPass();

            const blocksToRender = [];
            for (const cell of cellsInRegion) {
                const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
                if (!block || block.isTranslucent() !== translucentPass) continue;
                blocksToRender.push({ cell, block });
            }

            if (translucentPass && cameraLocal) {
                blocksToRender.sort((a, b) => {
                    const ax = a.cell.x + 0.5 - cameraLocal.x;
                    const ay = a.cell.y + 0.5 - cameraLocal.y;
                    const az = a.cell.z + 0.5 - cameraLocal.z;
                    const bx = b.cell.x + 0.5 - cameraLocal.x;
                    const by = b.cell.y + 0.5 - cameraLocal.y;
                    const bz = b.cell.z + 0.5 - cameraLocal.z;
                    const distASq = ax * ax + ay * ay + az * az;
                    const distBSq = bx * bx + by * by + bz * bz;
                    return distBSq - distASq;
                });
            }

            for (const blockData of blocksToRender) {
                blockRenderer.renderBlock(localWorld, blockData.block, ambientOcclusion,
                    blockData.cell.x, blockData.cell.y, blockData.cell.z);
            }

            if (tessellator.addedVertices > 0) {
                const mesh = tessellator.draw(region.group);
                mesh.position.set(rx, ry, rz);
                if (translucentPass) {
                    mesh.userData.isTranslucent = true;
                    mesh.visible = false;
                }
                region.meshes.push(mesh);
            }

            for (const modelMesh of blockRenderer.flushModelPasses(region.group)) {
                modelMesh.position.set(rx, ry, rz);
                region.meshes.push(modelMesh);
            }
        }

        if (region.meshes.length === 0) {
            this.disposeRegion(region);
            this.regions.delete(regionKey);
        }

        this.group.updateMatrixWorld(true);
    }


    
    isPosed() {
        return this.rotation.x !== 0 || this.rotation.y !== 0 || this.rotation.z !== 0 ||
            this.offset.x !== 0 || this.offset.y !== 0 || this.offset.z !== 0;
    }

    
    getParticlePose() {
        if (!this.isPosed()) return null;

        return {
            point: (x, y, z) => this.localToWorld({ x, y, z }),
            delta: (x, y, z) => {
                const pose = this.computePose();
                const v = new THREE.Vector3(x, y, z).applyEuler(new THREE.Euler(
                    pose.rotation.x, pose.rotation.y, pose.rotation.z
                ));
                return { x: v.x, y: v.y, z: v.z };
            }
        };
    }

    
    localToWorld(v) {
        return new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(this.group.matrix);
    }

    
    worldToLocal(v) {
        const inverse = this.group.matrix.clone().invert();
        return new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(inverse);
    }

    
    cellWorldBounds(lx, ly, lz) {
        let minX = Infinity;
        let minY = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < 8; i++) {
            const v = this.localToWorld({
                x: (i & 1) ? lx + 1 : lx,
                y: (i & 2) ? ly + 1 : ly,
                z: (i & 4) ? lz + 1 : lz
            });
            if (v.x < minX) minX = v.x;
            if (v.y < minY) minY = v.y;
            if (v.z < minZ) minZ = v.z;
            if (v.x > maxX) maxX = v.x;
            if (v.y > maxY) maxY = v.y;
            if (v.z > maxZ) maxZ = v.z;
        }

        return new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ);
    }

    
    addCollisionBoxes(region, out) {
        if (this.cells.size === 0) return;

        let lMinX = Infinity;
        let lMinY = Infinity;
        let lMinZ = Infinity;
        let lMaxX = -Infinity;
        let lMaxY = -Infinity;
        let lMaxZ = -Infinity;
        for (let corner = 0; corner < 8; corner++) {
            const v = this.worldToLocal({
                x: (corner & 1) ? region.maxX : region.minX,
                y: (corner & 2) ? region.maxY : region.minY,
                z: (corner & 4) ? region.maxZ : region.minZ
            });
            if (v.x < lMinX) lMinX = v.x;
            if (v.y < lMinY) lMinY = v.y;
            if (v.z < lMinZ) lMinZ = v.z;
            if (v.x > lMaxX) lMaxX = v.x;
            if (v.y > lMaxY) lMaxY = v.y;
            if (v.z > lMaxZ) lMaxZ = v.z;
        }

        const x0 = Math.floor(lMinX) - 1;
        const x1 = Math.ceil(lMaxX) + 1;
        const y0 = Math.max(0, Math.floor(lMinY) - 1);
        const y1 = Math.min(World.TOTAL_HEIGHT - 1, Math.ceil(lMaxY) + 1);
        const z0 = Math.floor(lMinZ) - 1;
        const z1 = Math.ceil(lMaxZ) + 1;

        const localWorld = this.createLocalWorld();
        if (!localWorld) return;

        for (let x = x0; x <= x1; x++) {
            for (let y = y0; y <= y1; y++) {
                for (let z = z0; z <= z1; z++) {
                    if (!this.cells.has(x + "," + y + "," + z)) continue;
                    for (const box of this.localCollisionBoxes(x, y, z, localWorld)) {
                        this.pushPosedBox(box, out, region);
                    }
                }
            }
        }
    }

    
    localCollisionBoxes(lx, ly, lz, localWorld) {
        const cell = this.cells.get(lx + "," + ly + "," + lz);
        if (cell === undefined) return [];

        const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
        if (!block) return [];

        if (block.multipart) {
            const parts = block.getMultipart(localWorld, lx, ly, lz);
            if (Array.isArray(parts) && parts.length > 0) {
                return parts.map((part) => {
                    const bbox = Block.getPartBoundingBox(part);
                    if (!bbox) return null;
                    return new BoundingBox(
                        lx + bbox.minX,
                        ly + bbox.minY,
                        lz + bbox.minZ,
                        lx + bbox.maxX,
                        ly + bbox.maxY,
                        lz + bbox.maxZ
                    );
                }).filter((box) => box !== null);
            }
        }

        if (block.isLiquid()) return [];

        const collisionBb = block.getCollisionBoundingBox(localWorld, lx, ly, lz);
        if (collisionBb) {
            return [new BoundingBox(
                lx + collisionBb.minX,
                ly + collisionBb.minY,
                lz + collisionBb.minZ,
                lx + collisionBb.maxX,
                ly + collisionBb.maxY,
                lz + collisionBb.maxZ
            )];
        }

        if (block.isSolid()) {
            return [new BoundingBox(lx, ly, lz, lx + 1, ly + 1, lz + 1)];
        }

        if (typeof block.isHalf === "function" && block.isHalf(localWorld, lx, ly, lz)) {
            return [new BoundingBox(lx, ly, lz, lx + 1, ly + 0.5, lz + 1)];
        }

        return [];
    }

    
    pushPosedBox(box, out, region) {
        const rotated = this.rotation.x !== 0 || this.rotation.y !== 0 || this.rotation.z !== 0;
        let posed;

        if (!this.isPosed()) {
            posed = [box];
        } else if (!rotated) {
            posed = [new BoundingBox(
                box.minX + this.offset.x,
                box.minY + this.offset.y,
                box.minZ + this.offset.z,
                box.maxX + this.offset.x,
                box.maxY + this.offset.y,
                box.maxZ + this.offset.z
            )];
        } else {
            posed = this.posedRotatedBoxes(box);
        }

        for (const b of posed) {
            const emit = rotated
                ? new BoundingBox(
                    b.minX + this.offset.x,
                    b.minY + this.offset.y,
                    b.minZ + this.offset.z,
                    b.maxX + this.offset.x,
                    b.maxY + this.offset.y,
                    b.maxZ + this.offset.z)
                : b;

            if (emit.minX > region.maxX + 1e-6 || emit.maxX < region.minX - 1e-6 ||
                emit.minY > region.maxY + 1e-6 || emit.maxY < region.minY - 1e-6 ||
                emit.minZ > region.maxZ + 1e-6 || emit.maxZ < region.minZ - 1e-6) {
                continue;
            }
            emit.epsilon = World.COLLISION_EPSILON;
            out.push(emit);
        }
    }

    
    hasExactRotation() {
        const skewed = (deg) => {
            const norm = ((deg % 90) + 90) % 90;
            return norm > 1e-9 && norm < 90 - 1e-9;
        };
        return !skewed(this.rotation.x) && !skewed(this.rotation.y) && !skewed(this.rotation.z);
    }

    
    getPoseContext() {
        const bounds = this.getBounds();
        if (!bounds) return null;

        const pivot = this.getPivot();
        const key = this.rotation.x + "," + this.rotation.y + "," + this.rotation.z +
            "|" + pivot.x + "," + pivot.y + "," + pivot.z;
        if (this._poseContext !== null && this._poseContext.key === key) {
            return this._poseContext;
        }

        const toRad = Math.PI / 180;
        const euler = new THREE.Euler(
            this.rotation.x * toRad,
            this.rotation.y * toRad,
            this.rotation.z * toRad,
            "XYZ"
        );
        const e = new THREE.Matrix4().makeRotationFromEuler(euler).elements;
        const axes = [
            new THREE.Vector3(e[0], e[1], e[2]),
            new THREE.Vector3(e[4], e[5], e[6]),
            new THREE.Vector3(e[8], e[9], e[10])
        ];

        this._poseContext = {
            key,
            pivot: pivot,
            euler,
            axes
        };
        return this._poseContext;
    }

    
    posePointNoOffset(v) {
        const ctx = this.getPoseContext();
        if (!ctx) return { x: v.x, y: v.y, z: v.z };

        const rotated = new THREE.Vector3(
            v.x - ctx.pivot.x,
            v.y - ctx.pivot.y,
            v.z - ctx.pivot.z
        ).applyEuler(ctx.euler);

        return {
            x: rotated.x + ctx.pivot.x,
            y: rotated.y + ctx.pivot.y,
            z: rotated.z + ctx.pivot.z
        };
    }

    
    posedRotatedBoxes(box) {
        const ctx = this.getPoseContext();
        if (!ctx) return [box];

        const q = (v) => Math.round(v * 1024) / 1024;
        const key = ctx.key + "|" + q(box.minX) + "," + q(box.minY) + "," + q(box.minZ) +
            "," + q(box.maxX) + "," + q(box.maxY) + "," + q(box.maxZ);

        let cached = this.posedBoxCache.get(key);
        if (cached) return cached;

        const half = {
            x: (box.maxX - box.minX) / 2,
            y: (box.maxY - box.minY) / 2,
            z: (box.maxZ - box.minZ) / 2
        };
        const center = this.posePointNoOffset({
            x: (box.minX + box.maxX) / 2,
            y: (box.minY + box.maxY) / 2,
            z: (box.minZ + box.maxZ) / 2
        });

        let minX = Infinity, minY = Infinity, minZ = Infinity;
        let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
        for (let i = 0; i < 8; i++) {
            const p = this.posePointNoOffset({
                x: (i & 1) ? box.maxX : box.minX,
                y: (i & 2) ? box.maxY : box.minY,
                z: (i & 4) ? box.maxZ : box.minZ
            });
            if (p.x < minX) minX = p.x;
            if (p.y < minY) minY = p.y;
            if (p.z < minZ) minZ = p.z;
            if (p.x > maxX) maxX = p.x;
            if (p.y > maxY) maxY = p.y;
            if (p.z > maxZ) maxZ = p.z;
        }

        const boxes = [];

        if (this.hasExactRotation()) {
            boxes.push(new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ));
        } else {
            const AXJ = ["x", "y", "z"];
            const axes = ctx.axes;
            const dot = (a, v) => a.x * v.x + a.y * v.y + a.z * v.z;
            const halves = [half.x, half.y, half.z];
            const worldRadius = AXJ.map((j) =>
                half.x * Math.abs(axes[0][j]) +
                half.y * Math.abs(axes[1][j]) +
                half.z * Math.abs(axes[2][j]));

            const buildLattice = (STEP) => {
                const from = { x: Math.floor(minX / STEP), y: Math.floor(minY / STEP), z: Math.floor(minZ / STEP) };
                const to = { x: Math.floor(maxX / STEP), y: Math.floor(maxY / STEP), z: Math.floor(maxZ / STEP) };
                const nx = to.x - from.x + 1;
                const ny = to.y - from.y + 1;
                const nz = to.z - from.z + 1;

                if (nx <= 0 || ny <= 0 || nz <= 0 || nx * ny * nz > 150000) {
                    return [new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ)];
                }

                const built = [];
                const cubeHalf = STEP / 2;
                const state = new Uint8Array(nx * ny * nz);
                const lin = (gx, gy, gz) => (gx * ny + gy) * nz + gz;

                for (let gx = 0; gx < nx; gx++) {
                    const cx = (from.x + gx) * STEP + cubeHalf;
                    for (let gy = 0; gy < ny; gy++) {
                        const cy = (from.y + gy) * STEP + cubeHalf;
                        for (let gz = 0; gz < nz; gz++) {
                            const cz = (from.z + gz) * STEP + cubeHalf;
                            const d = { x: cx - center.x, y: cy - center.y, z: cz - center.z };

                            let separated = false;
                            let fullyInside = true;

                            for (let a = 0; a < 3; a++) {
                                const axis = axes[a];
                                const cubeR = cubeHalf * (Math.abs(axis.x) + Math.abs(axis.y) + Math.abs(axis.z));
                                const dist = Math.abs(dot(axis, d));
                                if (dist > halves[a] + cubeR) {
                                    separated = true;
                                    break;
                                }
                                if (dist > halves[a] - cubeR) fullyInside = false;
                            }

                            if (!separated) {
                                for (let j = 0; j < 3; j++) {
                                    const dist = Math.abs(d[AXJ[j]]);
                                    if (dist > worldRadius[j] + cubeHalf) {
                                        separated = true;
                                        break;
                                    }
                                    if (dist > worldRadius[j] - cubeHalf) fullyInside = false;
                                }
                            }

                            state[lin(gx, gy, gz)] = separated ? 0 : (fullyInside ? 2 : 1);
                        }
                    }
                }

                const cubeBox = (gx, gy, gz, zMax) => new BoundingBox(
                    (from.x + gx) * STEP,
                    (from.y + gy) * STEP,
                    (from.z + gz) * STEP,
                    (from.x + gx + 1) * STEP,
                    (from.y + gy + 1) * STEP,
                    (from.z + zMax + 1) * STEP
                );

                for (let gx = 0; gx < nx; gx++) {
                    for (let gy = 0; gy < ny; gy++) {
                        let gz = 0;
                        while (gz < nz) {
                            if (state[lin(gx, gy, gz)] === 2) {
                                let end = gz;
                                while (end + 1 < nz && state[lin(gx, gy, end + 1)] === 2) end++;
                                built.push(cubeBox(gx, gy, gz, end));
                                gz = end + 1;
                            } else {
                                gz++;
                            }
                        }
                    }
                }

                for (let gx = 0; gx < nx; gx++) {
                    for (let gy = 0; gy < ny; gy++) {
                        for (let gz = 0; gz < nz; gz++) {
                            if (state[lin(gx, gy, gz)] === 1) {
                                built.push(cubeBox(gx, gy, gz, gz));
                            }
                        }
                    }
                }

                return built;
            };

            let lattice = buildLattice(OffGridBlockField.COLLISION_STEP_FINE);
            if (lattice.length > OffGridBlockField.COLLISION_BOX_CAP) {
                lattice = buildLattice(OffGridBlockField.COLLISION_STEP);
            }
            boxes.push(...lattice);
        }

        if (this.posedBoxCache.size > 4096) this.posedBoxCache.clear();
        this.posedBoxCache.set(key, boxes);
        return boxes;
    }

    
    createLocalWorld() {
        const realWorld = this.minecraft && this.minecraft.world;
        if (!realWorld) return null;

        if (this._localWorld !== null && this._localWorldWorld === realWorld) {
            return this._localWorld;
        }

        const field = this;

        const toWorldInt = (x, y, z) => {
            const w = field.localToWorld({ x, y, z });
            return { x: Math.floor(w.x), y: Math.floor(w.y), z: Math.floor(w.z) };
        };
        const cellAt = (x, y, z) => field.cells.get(x + "," + y + "," + z);
        const outOfWorld = (w) => w.y < 0 || w.y >= World.TOTAL_HEIGHT;

        const readLocalBlock = (x, y, z) => {
            const cell = cellAt(x, y, z);
            if (cell) return cell.typeId;
            const w = toWorldInt(x, y, z);
            return outOfWorld(w) ? 0 : realWorld.getBlockAt(w.x, w.y, w.z);
        };
        const readLocalData = (x, y, z) => {
            const cell = cellAt(x, y, z);
            if (cell) return cell.data;
            const w = toWorldInt(x, y, z);
            return outOfWorld(w) ? 0 : realWorld.getBlockDataAt(w.x, w.y, w.z);
        };
        const readLocalLight = (x, y, z) => {
            const cell = cellAt(x, y, z);
            if (cell) return 15;
            const w = toWorldInt(x, y, z);
            return outOfWorld(w) ? 15 : realWorld.getTotalLightAt(w.x, w.y, w.z);
        };
        const isSolidLocal = (x, y, z) => {
            const cell = cellAt(x, y, z);
            if (cell) {
                const cellBlock = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
                return !!cellBlock && !cellBlock.multipart && cellBlock.isSolid();
            }
            const w = toWorldInt(x, y, z);
            return outOfWorld(w) ? false : realWorld.isSolidBlockAt(w.x, w.y, w.z);
        };
        const isTranslucentLocal = (x, y, z) => {
            const typeId = readLocalBlock(x, y, z);
            return typeId === 0 || Block.getById(typeId).isTranslucent();
        };
        const readLocalAtFace = (x, y, z, face) => readLocalBlock(x + face.x, y + face.y, z + face.z);

        const chunkProxies = new Map();
        const chunkProxyAt = (cx, cz) => {
            const ckey = cx + "," + cz;
            let proxy = chunkProxies.get(ckey);
            if (proxy !== undefined) return proxy;

            const chunk = realWorld.getChunkAt(cx, cz);
            const readChunkLocal = (chunkProp, lx, ly, lz) => {
                const cell = cellAt((cx << 4) + lx, ly, (cz << 4) + lz);
                if (cell) return chunkProp === "getBlockAt" ? cell.typeId : cell.data;
                const w = field.localToWorld({ x: (cx << 4) + lx, y: ly, z: (cz << 4) + lz });
                const worldPos = { x: Math.floor(w.x), y: Math.floor(w.y), z: Math.floor(w.z) };
                if (outOfWorld(worldPos)) return 0;
                return chunkProp === "getBlockAt"
                    ? realWorld.getBlockAt(worldPos.x, worldPos.y, worldPos.z)
                    : realWorld.getBlockDataAt(worldPos.x, worldPos.y, worldPos.z);
            };

            proxy = new Proxy(chunk || {}, {
                get(chunkTarget, chunkProp) {
                    if (chunkProp === "getBlockAt" || chunkProp === "getBlockDataAt") {
                        return (lx, ly, lz) => readChunkLocal(chunkProp, lx, ly, lz);
                    }
                    return chunkTarget[chunkProp];
                }
            });
            chunkProxies.set(ckey, proxy);
            return proxy;
        };

        this._localWorld = new Proxy(realWorld, {
            get(target, prop) {
                switch (prop) {
                    case "getBlockAt":
                        return readLocalBlock;
                    case "getBlockAtFace":
                        return readLocalAtFace;
                    case "isTranslucentBlockAt":
                        return isTranslucentLocal;
                    case "getBlockDataAt":
                        return readLocalData;
                    case "getTotalLightAt":
                        return readLocalLight;
                    case "isSolidBlockAt":
                        return isSolidLocal;
                    case "getChunkAt":
                        return chunkProxyAt;
                    case "setBlockAt":
                        return (x, y, z, type, data = 0) =>
                            field.setLocalBlock(x, y, z, type, data, true);
                    case "setBlockAtNoEvents":
                        return (x, y, z, type, data = 0) =>
                            field.setLocalBlock(x, y, z, type, data, false);
                    case "setBlockDataAt":
                        return (x, y, z, data) =>
                            field.setLocalData(x, y, z, data);
                    case "scheduleBlockTick":
                        return (x, y, z, delay) =>
                            field.scheduleLocalTick(x, y, z, delay);
                    case "notifyNeighborBlockChange":
                        return (x, y, z) =>
                            field.notifyNeighbors(x, y, z, false);
                    case "scheduleNeighborTicks":
                        return (x, y, z) =>
                            field.scheduleLocalNeighborTicks(x, y, z);
                    case "getBlockEntity":
                        return (x, y, z) => {
                            const fx = Math.floor(x);
                            const fy = Math.floor(y);
                            const fz = Math.floor(z);
                            if (field.covers(fx, fy, fz)) return null;
                            const w = field.mapLocalToWorldInt(fx, fy, fz);
                            if (w.y < 0 || w.y >= World.TOTAL_HEIGHT) return null;
                            return target.getBlockEntity ? target.getBlockEntity(w.x, w.y, w.z) : null;
                        };
                    case "onBlockChanged":
                        return (x, y, z) => {
                            const fx = Math.floor(x);
                            const fy = Math.floor(y);
                            const fz = Math.floor(z);
                            if (field.covers(fx, fy, fz)) return; 
                            const w = field.mapLocalToWorldInt(fx, fy, fz);
                            if (w.y < 0 || w.y >= World.TOTAL_HEIGHT) return;
                            if (typeof target.onBlockChanged === "function") {
                                target.onBlockChanged(w.x, w.y, w.z);
                            }
                        };
                    case "isFieldLocalWorld":
                        return true;
                }
                return target[prop];
            }
        });
        this._localWorldWorld = realWorld;

        return this._localWorld;
    }

    
    traceCell(x, y, z, lFrom, lTo, localWorld) {
        const cell = this.cells.get(x + "," + y + "," + z);
        if (cell === undefined) return null;

        const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
        if (!block || !block.canInteract()) return null;

        return block.collisionRayTrace(localWorld, x, y, z, lFrom, lTo);
    }

    
    rayTrace(from, to, slab = false) {
        if (this.cells.size === 0) return null;

        const localWorld = this.createLocalWorld();
        if (!localWorld) return null;

        const lFromW = this.worldToLocal(from);
        const lToW = this.worldToLocal(to);
        const lFrom = new Vector3(lFromW.x, lFromW.y, lFromW.z);
        const lTo = new Vector3(lToW.x, lToW.y, lToW.z);

        const dx = lTo.x - lFrom.x;
        const dy = lTo.y - lFrom.y;
        const dz = lTo.z - lFrom.z;

        let x = Math.floor(lFrom.x);
        let y = Math.floor(lFrom.y);
        let z = Math.floor(lFrom.z);
        const endX = Math.floor(lTo.x);
        const endY = Math.floor(lTo.y);
        const endZ = Math.floor(lTo.z);

        const stepX = dx === 0 ? 0 : (dx > 0 ? 1 : -1);
        const stepY = dy === 0 ? 0 : (dy > 0 ? 1 : -1);
        const stepZ = dz === 0 ? 0 : (dz > 0 ? 1 : -1);
        if (stepX === 0 && stepY === 0 && stepZ === 0) return null;

        let tMaxX = stepX > 0 ? ((x + 1) - lFrom.x) / dx : (stepX < 0 ? (x - lFrom.x) / dx : Infinity);
        let tMaxY = stepY > 0 ? ((y + 1) - lFrom.y) / dy : (stepY < 0 ? (y - lFrom.y) / dy : Infinity);
        let tMaxZ = stepZ > 0 ? ((z + 1) - lFrom.z) / dz : (stepZ < 0 ? (z - lFrom.z) / dz : Infinity);
        const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
        const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
        const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

        let entryFace = null;
        let guard = 512;
        while (guard-- > 0) {
            const hit = this.traceCell(x, y, z, lFrom, lTo, localWorld);
            if (hit) {
                if (slab) {
                    if (hit.face === EnumBlockFace.TOP) return 0;
                    if (hit.face === EnumBlockFace.BOTTOM) return 1;
                    if (lFrom.y - y >= 0.5) return 1;
                }
                const mop = new MovingObjectPosition(this.localToWorld(hit.vector), hit.face || entryFace, x, y, z);
                mop.fieldCell = true;
                return mop;
            }

            if (x === endX && y === endY && z === endZ) return null;

            if (tMaxX <= tMaxY && tMaxX <= tMaxZ) {
                if (stepX === 0) return null;
                x += stepX;
                tMaxX += tDeltaX;
                entryFace = stepX > 0 ? EnumBlockFace.WEST : EnumBlockFace.EAST;
            } else if (tMaxY <= tMaxZ) {
                if (stepY === 0) return null;
                y += stepY;
                tMaxY += tDeltaY;
                entryFace = stepY > 0 ? EnumBlockFace.BOTTOM : EnumBlockFace.TOP;
            } else {
                if (stepZ === 0) return null;
                z += stepZ;
                tMaxZ += tDeltaZ;
                entryFace = stepZ > 0 ? EnumBlockFace.NORTH : EnumBlockFace.SOUTH;
            }
        }

        return null;
    }

    disposeRegion(region) {
        for (const mesh of region.meshes) {
            region.group.remove(mesh);
            mesh.geometry.dispose();
            mesh.material.dispose();
        }
        region.meshes = [];
        if (region.group.parent) {
            region.group.parent.remove(region.group);
        }
    }
}