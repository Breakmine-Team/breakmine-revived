import * as THREE from "../../../../../../libraries/three.module.js";
import Block from "../world/block/Block.js";
import World from "../world/World.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import BoundingBox from "../../util/BoundingBox.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import MovingObjectPosition from "../../util/MovingObjectPosition.js";
import Vector3 from "../../util/Vector3.js";

/**
 * Summoned block field: a sparse set of client-side blocks that behave like
 * real ones without touching chunk storage.
 *
 * The field is bound to a World as `world.offGridField`. World reads
 * (getBlockAt / getBlockDataAt / getTotalLightAt) and writes
 * (setBlockAt / setBlockAtNoEvents / setBlockDataAt) consult the field first
 * for covered positions, which is what makes summoned blocks work with every
 * system that already goes through the World API:
 *
 *   - collision        (World.getCollisionBoxes -> offGridField.addCollisionBoxes)
 *   - block raytrace   (World.rayTraceBlocks -> offGridField.rayTrace) ->
 *     breaking, targeting and the placement preview ghost all hit summoned
 *     blocks
 *
 * The group carries a pose (rotation + fractional offset, see applyTransform).
 * Once posed, the cells can no longer be found by looking at their integer
 * keys in world space, so every interaction seam is pose aware: collision
 * boxes are contributed for the query region as posed boxes, the raytrace
 * runs in local space through the inverse pose, and the rebuild/preview
 * proxies answer in local space while sampling the real world underneath the
 * pose.
 *   - server block sync (NetworkPlayHandler -> setBlockAtNoEvents) so edits
 *     made in singleplayer/multiplayer flow back into the field
 *
 * Rendering mimics ChunkSection.rebuild(): cells are batched per 16^3 region,
 * tessellated through the real BlockRenderer (so AO, face culling, multipart
 * models, liquids and custom renderers behave exactly like placed blocks) and
 * drawn as one opaque + one translucent mesh per region. Editing one cell
 * only re-tessellates the regions it and its neighbours live in.
 */
export default class OffGridBlockField {

    /** Safety caps for the debug command: per axis, and per summon. */
    static MAX_DIM = 64;
    static MAX_CELLS = 8192;

    /** Lattice step of the rotated-box collision approximation (world units). */
    static COLLISION_STEP = 1 / 6;

    /** Fine lattice step tried first when approximating rotated boxes. */
    static COLLISION_STEP_FINE = 1 / 12;

    /** Boxes above which the fine lattice falls back to the coarse grid. */
    static COLLISION_BOX_CAP = 1200;

    constructor(minecraft) {
        this.minecraft = minecraft;
        this.world = null;

        // "x,y,z" -> { x, y, z, typeId, data }. Only non-air cells exist, so
        // breaking a summoned block simply deletes its entry and the read
        // falls through to the real world underneath.
        this.cells = new Map();

        // "rx,ry,rz" (region origin, multiples of 16) -> { group, meshes }
        this.regions = new Map();

        // Parent of every region group. Attached to the world renderer's
        // scene; WorldRenderer.reset() drops it on a world switch, and the
        // next bind()/rebuild() re-attaches (stale meshes are cleared when
        // the command notices the world changed).
        this.group = new THREE.Object3D();
        this.group.updateMatrix();
        this.group.matrixAutoUpdate = false;

        // Group transform (see applyTransform): accumulated rotation in
        // degrees per axis, and the fractional part of the move offset in
        // world units. Whole-block movement is re-anchored into `cells`
        // instead, so collision and editing keep following the grid. The
        // pose itself is honoured by the interaction seams below        // (addCollisionBoxes / rayTrace / createLocalWorld), so collision,
        // breaking and the placement ghost track the posed structure.
        this.rotation = { x: 0, y: 0, z: 0 };
        this.offset = { x: 0, y: 0, z: 0 };

        // Pose collision approximation cache (per rigid pose of one box, see
        // posedRotatedBoxes). Invalidated by applyTransform / clear.
        this.posedBoxCache = new Map();
        this._poseContext = null;

        // Rotation anchor, frozen the first time a pose is needed and kept
        // while cells are edited - see getPivot.
        this.pivot = null;

        // "rx,ry,rz" -> Set of cell keys, so region rebuilds never scan the
        // whole cell map (an 8k-cell field re-scanned all of it once per
        // touched region on every single edit).
        this.regionCells = new Map();

        // Field-local block lifecycle: local tick queue + neighbor-update
        // cascade, mirroring World.scheduledBlockTicks / notifyNeighborBlockChange
        // but addressed in the field's LOCAL space (the proxy world's keys).
        this.localTicks = new Map();
        this.localNeighborQueue = [];
        this.processingLocalNeighborUpdates = false;

        // Cached local-world proxy; dropped whenever the pose or cells change
        // (applyTransform / clear are the mutation funnels). The previous
        // per-query rebuild churned a fresh Proxy + closure set through the
        // renderer's every block/face read.
        this._localWorld = null;
        this._localWorldWorld = null;
    }

    /** Attach this field to a world (idempotent) and to the current scene. */
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

    /** Drop the binding, every mesh and every summoned block. */
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

    // ------------------------------------------------------------------
    // World-facing API (called from the World read/write hooks)
    // ------------------------------------------------------------------

    covers(x, y, z) {
        return this.cells.has(x + "," + y + "," + z);
    }

    /** Cell keys grouped by their 16^3 region, kept in sync by the writes. */
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

    /**
     * Mark the real chunk sections around a box so their neighbour culling
     * re-resolves against the overlay (World reads the field through
     * getBlockAt / getBlockDataAt while it lies flat on the grid).
     */
    markWorldSectionsDirty(minX, minY, minZ, maxX, maxY, maxZ) {
        const world = this.world || (this.minecraft && this.minecraft.world);
        if (world && typeof world.setModified === "function") {
            world.setModified(minX - 1, minY - 1, minZ - 1, maxX + 1, maxY + 1, maxZ + 1);
        }
    }

    /** @returns {number} type id, or -1 when the position is not covered. */
    getBlockAt(x, y, z) {
        const cell = this.cells.get(x + "," + y + "," + z);
        return cell === undefined ? -1 : cell.typeId;
    }

    /** @returns {number} metadata, or -1 when the position is not covered. */
    getBlockDataAt(x, y, z) {
        const cell = this.cells.get(x + "," + y + "," + z);
        return cell === undefined ? -1 : cell.data;
    }

    /**
     * Mirror a write aimed at a covered position (server block sync or local
     * edit) into the field and re-tessellate the affected regions.
     * @returns {boolean} true when the field actually changed.
     */
    applyWrite(xRaw, yRaw, zRaw, typeId, data = 0) {
        // Same integer-grid rule as fill(): fractional coordinates would
        // silently produce cells no interaction seam can reach.
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

        // Re-apply the pose BEFORE tessellation: the region meshes sample
        // neighbours at posed positions.
        this.applyTransform();
        this.rebuildAround(x, y, z);

        // Real chunk meshes read the overlay cells through the world for
        // their neighbour culling; those sections must re-tessellate to keep
        // agreeing with the overlay (hidden faces under placed cells, shown
        // terrain under broken ones).
        this.markWorldSectionsDirty(x, y, z, x, y, z);
        return true;
    }

    // ------------------------------------------------------------------
    // Field-local block lifecycle (bluestone, doors, ...)
    // ------------------------------------------------------------------
    //
    // The local proxy world (createLocalWorld) routes reads into local space,
    // so block code called with LOCAL coordinates must get local sequencing
    // too: scheduled ticks and neighbor notifications fall through to the
    // real world otherwise, where the local keys name unrelated terrain (or
    // nothing), and placed bluestone propagates into the void while doors
    // never write their upper half.

    /** Local point -> integer world position the proxy would read for it. */
    mapLocalToWorldInt(x, y, z) {
        const w = this.localToWorld({ x, y, z });
        return { x: Math.floor(w.x), y: Math.floor(w.y), z: Math.floor(w.z) };
    }

    /** Local-space read (field cell first, real terrain through the pose). */
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

    /**
     * Local-space setBlockAt with the full block lifecycle the real world
     * runs (onBlockRemoved / onBlockPlaced / onBlockAdded / neighbor notify).
     * This is what makes doors place their upper half and bluestone dust
     * propagate when written against the proxy world.
     */
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
                // Re-fetch after the write: applyWrite() invalidates the pose
                // cache, so the fresh proxy answers the callbacks' follow-up
                // writes (door top half, dust propagation) consistently.
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

    /** Metadata write against the proxy (BlockBluestone power levels etc.) */
    setLocalData(xRaw, yRaw, zRaw, data) {
        // Round to int for cell lookup like fill/applyWrite do.
        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        const cell = this.cells.get(x + "," + y + "," + z);
        if (cell === undefined) return;
        this.applyWrite(x, y, z, cell.typeId, data);
    }

    /**
     * Local neighbor-notification cascade, mirroring
     * World.notifyNeighborBlockChange but running inside the field: targeted
     * blocks receive the LOCAL world + LOCAL coordinates, so their own reads
     * and writes (dust data updates, schedules) stay in the pose space.
     */
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
            // When recursive, also probe the six neighbors of the origin;
            // otherwise just the neighbors of the queued origin below.
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

    /** Field-local version of World.scheduleBlockTick. */
    scheduleLocalTick(xRaw, yRaw, zRaw, delay) {
        const world = this.minecraft && this.minecraft.world;
        if (!world) return;

        const x = Math.floor(xRaw);
        const y = Math.floor(yRaw);
        const z = Math.floor(zRaw);
        this.localTicks.set(x + "," + y + "," + z, { x, y, z, time: world.time + delay });
    }

    /** Schedule ticks for neighbors (originally triggered by removal) */
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

    /** Drain the local tick queue; called from World.onTick. */
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
                    break; // cap per frame to avoid runaway cascades
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Summoning
    // ------------------------------------------------------------------
    /**
     * Fill the axis-aligned volume with one block type.
     * Validation (size caps, world bounds, loaded chunks) belongs to the
     * caller - see OffGridBlockRendererCommand.
     *
     * @returns {number} number of cells written.
     */
    fill(minXRaw, minYRaw, minZRaw, sizeX, sizeY, sizeZ, typeId, data = 0) {
        // Cells are keyed and looked up on the integer grid everywhere
        // (covers / raytrace / collision boxes), so fractional summon
        // positions (e.g. a raw player position) MUST be floored here: they
        // used to render fine but were invisible to every interaction seam.
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

        // Real chunk meshes read the overlay cells through the world; their
        // sections must re-tessellate around the summoned volume.
        this.markWorldSectionsDirty(
            minX, minY, minZ,
            minX + sizeX - 1, minY + sizeY - 1, minZ + sizeZ - 1);

        // The pose mapping may have changed - apply it BEFORE tessellating,
        // since the meshes sample neighbours at posed positions.
        this.applyTransform();

        for (const key of regionKeys) {
            const [rx, ry, rz] = key.split(",");
            this.rebuildRegion(parseInt(rx), parseInt(ry), parseInt(rz));
        }

        return sizeX * sizeY * sizeZ;
    }

    /** Remove every summoned block, dispose all meshes and reset transforms. */
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

        // The pose (rotation + bounds pivot) any cached collision geometry
        // was approximated for is gone.
        this.posedBoxCache.clear();
        this._poseContext = null;
        this.pivot = null;
    }

    // ------------------------------------------------------------------
    // Group transforms (move / rotate the whole summoned assembly)
    // ------------------------------------------------------------------

    /** Axis-aligned bounds of the summoned cells (inclusive), or null. */
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

    /**
     * Move the whole group by a (possibly fractional) world-space delta.
     * Whole-block parts re-anchor the cells - collision, raytracing and
     * editing follow them to the new grid position; the fractional remainder
     * stays a visual offset on the group, so decimal moves work too.
     *
     * @returns {{ shifted: boolean }} true when the grid was re-anchored.
     */
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
                // Grid took over this part of the delta; keep only the
                // fraction on the visual offset (offset += delta - amount).
                this.offset[axis] -= amount;
                shifted = true;
                for (const key of regions) touched.add(key);
            }
        }

        this.offset.x += dx;
        this.offset.y += dy;
        this.offset.z += dz;
        this.applyTransform();

        // Rebuild after the pose is applied: mesh neighbour sampling happens
        // at posed positions, so tessellating against the stale pose is what
        // made moved structures lose their sides.
        const keys = shifted ? touched : this.regions.keys();
        for (const key of keys) {
            const parts = key.split(",");
            this.rebuildRegion(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
        }

        // The grid footprint changed: the real sections under the old keys
        // must show their terrain again, the ones under the new keys read
        // the overlay cells for their neighbour culling.
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

    /**
     * Accumulate a rotation (degrees) around one axis of the group's own
     * centre. Arbitrary angles cannot be re-baked into the integer block
     * grid, so the cells stay on the grid and the interaction seams
     * (addCollisionBoxes / rayTrace / createLocalWorld) follow the pose.
     */
    rotate(degrees, axis) {
        this.rotation[axis] = (this.rotation[axis] || 0) + degrees;
        this.applyTransform();

        // Rotating toggles the pose: real sections read the overlay through
        // the world only while it lies flat, so re-tessellate around it.
        const bounds = this.getBounds();
        if (bounds) {
            this.markWorldSectionsDirty(
                bounds.minX, bounds.minY, bounds.minZ,
                bounds.maxX, bounds.maxY, bounds.maxZ);
        }
    }

    /**
     * Recompute the group transform: rotate around the centre of the
     * summoned bounds, then translate by the fractional offset:
     *
     *   world' = R * (v - pivot) + pivot + offset
     *
     * Everything the field draws hangs off this group, so the meshes follow
     * without touching their region-local positions.
     */
    applyTransform() {
        const pose = this.computePose();
        this.group.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
        this.group.position.set(pose.position.x, pose.position.y, pose.position.z);

        // matrixAutoUpdate is off on the group (Tessellator.draw disables it),
        // so bake the transform and force world matrices down the tree.
        this.group.updateMatrix();
        this.group.updateMatrixWorld(true);

        // The pose (rotation + bounds pivot) any cached collision geometry
        // was approximated for is gone; the local world proxy follows the
        // same pose.
        this.posedBoxCache.clear();
        this._poseContext = null;
        this._localWorld = null;
        this._localWorldWorld = null;
    }

    /**
     * Rotation anchor. Frozen the first time a pose is needed and kept while
     * cells are edited: re-centering on every edit moved the whole structure
     * (group position = pivot + offset - R*pivot), so faces ended up sampled
     * against random ground and placements landed elsewhere. Movement sticks
     * the anchor to the structure (shiftCellsAlongAxis).
     */
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

    /**
     * The current pose as { position, rotation (radians) }, matching exactly
     * what the group matrix does: rotate around the summoned pivot, then
     * translate by the fractional offset. Consumers (hit box outline,
     * placement ghost) copy it onto their own groups to draw in the posed
     * space.
     */
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

        // Rewrite as a plain position/rotation node: pos = pivot + offset - R*pivot.
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

    /**
     * Shift every cell along one axis by a whole number of blocks, provided
     * the destination (with the renderer's 1-block sample margin) sits in
     * loaded chunks and inside the world - otherwise this returns null and
     * the caller keeps the move purely visual, avoiding a mid-frame chunk
     * generation or an out-of-world cell.
     *
     * @returns {null|Set<string>} keys "rx,ry,rz" of the regions to re-
     *          tessellate once the caller has re-applied the pose, or null
     *          when the shift was not possible (cells untouched).
     */
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

        // Stick the rotation anchor to the moved structure so a later
        // rotation pivots around the structure's current, not former, centre.
        if (this.pivot !== null) this.pivot[axis] += amount;

        // Rebuild the region -> cells index for the new layout.
        this.regionCells = new Map();
        for (const cell of next.values()) {
            this.addToRegionIndex(cell.x, cell.y, cell.z);
        }

        // Caller tessellates these after the new pose has been applied.
        return new Set([...oldRegions, ...newRegions]);
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    /** Re-tessellate every region the edited cell and its neighbours touch. */
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

    /**
     * Re-tessellate one 16^3 region: one opaque and one translucent mesh,
     * exactly like ChunkSection.rebuild() but only over field cells.
     *
     * All cells in a 16-aligned region share the same chunk origin, and
     * BlockRenderer emits vertices relative to that origin
     * (x - (chunkX << 4)), so both meshes sit at the region origin.
     */
    rebuildRegion(rx, ry, rz) {
        const world = this.minecraft && this.minecraft.world;
        const worldRenderer = this.minecraft && this.minecraft.worldRenderer;
        if (!world || !worldRenderer || !worldRenderer.blockRenderer) return;

        // Cells are indexed per region by the write paths - an 8k-cell
        // field used to be rescanned in full for every touched region.
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

        // WorldRenderer.reset() may have dropped the group from the scene.
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
        // Same setting the chunk sections render with.
        const ambientOcclusion = !!world.minecraft.settings.ambientOcclusion;
        // Cells live in the field's local space: sample neighbours through a
        // local proxy so culling/AO/multipart read the cells themselves and
        // the real world under the current pose for everything else.
        const localWorld = this.createLocalWorld() || world;

        // Camera in LOCAL space for translucent ordering. ChunkSection
        // rebuild() sorts translucent blocks back-to-front before
        // tessellating; the field must do the same, and since the mesh
        // vertices are in local space the camera has to be mapped through
        // the inverse pose (rotation/offset) or the sort would compare world
        // distances against local cell centres.
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

            // Collect blocks for this pass (mirrors ChunkSection.rebuild)
            const blocksToRender = [];
            for (const cell of cellsInRegion) {
                const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
                if (!block || block.isTranslucent() !== translucentPass) continue;
                blocksToRender.push({ cell, block });
            }

            // Sort translucent blocks back-to-front from the (local-space)
            // camera for proper depth ordering, exactly like chunk sections.
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
                    // Far to near (far blocks render first)
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
                    // Mirror ChunkSection.rebuild(): translucent meshes are
                    // hidden and their geometry is stolen by the global
                    // TranslucentMeshBatcher every frame, which does the
                    // perfect world-wide face sort.
                    mesh.userData.isTranslucent = true;
                    mesh.visible = false;
                }
                region.meshes.push(mesh);
            }
        }

        if (region.meshes.length === 0) {
            this.disposeRegion(region);
            this.regions.delete(regionKey);
        }
    }

    // ------------------------------------------------------------------
    // Pose-aware interaction seams
    // ------------------------------------------------------------------

    /** True when the group carries a non-identity transform. */
    isPosed() {
        return this.rotation.x !== 0 || this.rotation.y !== 0 || this.rotation.z !== 0 ||
            this.offset.x !== 0 || this.offset.y !== 0 || this.offset.z !== 0;
    }

    /**
     * Pose helpers for effects that spawn around a summoned cell in its
     * local (grid) coordinates - break particles, and anything else that
     * would otherwise appear at the grid key instead of on the posed block.
     *
     * @returns {null|{point: Function, delta: Function}} null when the field
     *     is unposed, so callers take the free identity path.
     */
    getParticlePose() {
        if (!this.isPosed()) return null;

        return {
            // Cell-local position -> world position through the group matrix.
            point: (x, y, z) => this.localToWorld({ x, y, z }),
            // Cell-local direction -> world direction (rotation only).
            delta: (x, y, z) => {
                const pose = this.computePose();
                const v = new THREE.Vector3(x, y, z).applyEuler(new THREE.Euler(
                    pose.rotation.x, pose.rotation.y, pose.rotation.z
                ));
                return { x: v.x, y: v.y, z: v.z };
            }
        };
    }

    /** Map a local-space point into world space through the group matrix. */
    localToWorld(v) {
        return new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(this.group.matrix);
    }

    /** Map a world-space point into the field's local space. */
    worldToLocal(v) {
        const inverse = this.group.matrix.clone().invert();
        return new THREE.Vector3(v.x, v.y, v.z).applyMatrix4(inverse);
    }

    /** World-space bounds of one cell under the current pose. */
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

    /**
     * Contribute the posed collision boxes of every summoned cell that can
     * touch `region` to `out`. World.getCollisionBoxes calls this once per
     * query: a per-position lookup cannot see a rotated structure, so the
     * field answers for the whole region from its local space instead.
     */
    addCollisionBoxes(region, out) {
        if (this.cells.size === 0) return;

        // Conservative local-space bounds of the query region: inverse-transform
        // its eight corners and take the enclosing box (plus a 1-cell margin).
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

    /**
     * Collision shapes of one cell in local space - mirrors
     * World.getBlockCollisionBoxesAt (multipart, liquids, custom boxes,
     * half blocks) so posed cells collide exactly like placed blocks.
     */
    localCollisionBoxes(lx, ly, lz, localWorld) {
        const cell = this.cells.get(lx + "," + ly + "," + lz);
        if (cell === undefined) return [];

        const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
        if (!block) return [];

        if (block.multipart) {
            const parts = block.getMultipart(localWorld, lx, ly, lz);
            if (Array.isArray(parts) && parts.length > 0) {
                return parts.map((part) => {
                    const bbox = part[2];
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

        // Liquids have no collision
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

    /**
     * Push the posed version of one local collision box into `out`, keeping
     * only boxes that can touch `region`:
     *   - unposed: the box itself (exact);
     *   - translated: the box shifted by the fractional offset (exact);
     *   - rotated: the exact box for 90 degree steps, otherwise a fine
     *     axis-aligned lattice that strictly covers the rotated geometry
     *     (posedRotatedBoxes) so sliding along a tilted side feels close to
     *     the rendered surface instead of stepping every quarter block.
     */
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
            // Cached per (rotation, box), WITHOUT the fractional offset.
            posed = this.posedRotatedBoxes(box);
        }

        for (const b of posed) {
            // Rotated geometry carries no offset (the cache is offset-free);
            // translation-only boxes already include it.
            const emit = rotated
                ? new BoundingBox(
                    b.minX + this.offset.x,
                    b.minY + this.offset.y,
                    b.minZ + this.offset.z,
                    b.maxX + this.offset.x,
                    b.maxY + this.offset.y,
                    b.maxZ + this.offset.z)
                : b;

            // Keep only boxes that can touch the query region (the world path
            // includes boundary-touching blocks too, hence the epsilon).
            if (emit.minX > region.maxX + 1e-6 || emit.maxX < region.minX - 1e-6 ||
                emit.minY > region.maxY + 1e-6 || emit.maxY < region.minY - 1e-6 ||
                emit.minZ > region.maxZ + 1e-6 || emit.maxZ < region.minZ - 1e-6) {
                continue;
            }
            emit.epsilon = World.COLLISION_EPSILON;
            out.push(emit);
        }
    }

    /** True when every rotated axis lands back on a world axis (90° steps). */
    hasExactRotation() {
        const skewed = (deg) => {
            const norm = ((deg % 90) + 90) % 90;
            return norm > 1e-9 && norm < 90 - 1e-9;
        };
        return !skewed(this.rotation.x) && !skewed(this.rotation.y) && !skewed(this.rotation.z);
    }

    /**
     * Cached context for the current rotation: the summoned bounds pivot and
     * the rotated basis vectors. Null when nothing is summoned.
     */
    getPoseContext() {
        const bounds = this.getBounds();
        if (!bounds) return null;

        // The pivot is part of the key: whole-block moves carry it (the
        // anchor stays stuck to the structure), so cached screened pose
        // geometry must not leak across a move.
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
        // Column-major matrix elements: the rotated block-local axes.
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

    /**
     * Rotate a local-space point around the summoned bounds pivot, WITHOUT
     * the fractional world offset the render group carries on top.
     */
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

    /**
     * Posed, offset-free collision geometry of one local box under the
     * current rotation. Exact for multiples of 90°; otherwise a lattice of
     * COLLISION_STEP-sized axis-aligned cubes that intersect the rotated box
     * (a separating-axis test on the box's OBB, so the union always covers
     * the rendered geometry and never lets the player clip through), merged
     * into streaks where cubes fall fully inside to keep the box count low.
     * The partial rim cubes are what make sliding along a tilted side track
     * the rendered surface instead of stepping every slab.
     *
     * @returns {BoundingBox[]} cached per (rotation, local box).
     */
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

        // World-space AABB of the posed box (offset ignored here).
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
            // 90° steps re-align the box with the world axes.
            boxes.push(new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ));
        } else {
            const AXJ = ["x", "y", "z"];
            const axes = ctx.axes;
            const dot = (a, v) => a.x * v.x + a.y * v.y + a.z * v.z;
            const halves = [half.x, half.y, half.z];
            // Half-extent of the box's OBB along each world axis.
            const worldRadius = AXJ.map((j) =>
                half.x * Math.abs(axes[0][j]) +
                half.y * Math.abs(axes[1][j]) +
                half.z * Math.abs(axes[2][j]));

            // Axis-aligned staircase approximating the rotated box. A fine
            // step hugs the rendered surface (smoother sliding along tilted
            // sides); boxes that explode the rim count fall back to the
            // coarser grid that keeps collision queries cheap.
            const buildLattice = (STEP) => {
                const from = { x: Math.floor(minX / STEP), y: Math.floor(minY / STEP), z: Math.floor(minZ / STEP) };
                const to = { x: Math.floor(maxX / STEP), y: Math.floor(maxY / STEP), z: Math.floor(maxZ / STEP) };
                const nx = to.x - from.x + 1;
                const ny = to.y - from.y + 1;
                const nz = to.z - from.z + 1;

                if (nx <= 0 || ny <= 0 || nz <= 0 || nx * ny * nz > 150000) {
                    // Degenerate or huge: fall back to the plain AABB over-cover.
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

                // Merge streaks of fully-contained cubes along z; the rim's
                // partial cubes stay individual so they can hug the surface.
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

    /**
     * A proxy world that answers in field-local space: covered positions
     * come from the cells, everything else is sampled from the real world at
     * the posed (world) position of the query. Used for neighbour culling/AO
     * during rebuilds, for placement checks and for raytracing cells.
     *
     * The proxy and every chunk sub-proxy are cached and only rebuilt when
     * the world changes or a mutation drops the cache (applyTransform /
     * clear, see the constructor): each of the renderer's per-block/per-face
     * reads used to allocate a fresh closure (and every getChunkAt a fresh
     * Proxy) which made every break/place a GC storm.
     */
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

        // Reads through the proxy share one responder so every seam
        // (getBlockAt / getBlockAtFace / isTranslucentBlockAt) samples the
        // same local space. Block.shouldRenderFace and BlockRenderer's face
        // culling both go through getBlockAtFace - without interception it
        // read the real terrain under the grid key, hiding the structure's
        // sides after a move put it over different ground.
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

        // Chunk-local reads (BlockRenderer reads metadata through the chunk
        // with chunk-local x/z and world y): answered in local space. One
        // Proxy per chunk column instead of one per getChunkAt call.
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
                    // Writes done against the proxy go into the field at the
                    // same LOCAL key, so placer items (bluestone dust, doors,
                    // ... called with local coordinates after a fieldCell hit)
                    // extend the summoned structure instead of scribbling on
                    // the real terrain at whatever grid position the local
                    // key happens to name. The block lifecycle mirrors the
                    // real World.setBlockAt so both get the full write.
                    case "setBlockAt":
                        return (x, y, z, type, data = 0) =>
                            field.setLocalBlock(x, y, z, type, data, true);
                    case "setBlockAtNoEvents":
                        return (x, y, z, type, data = 0) =>
                            field.setLocalBlock(x, y, z, type, data, false);
                    case "setBlockDataAt":
                        return (x, y, z, data) =>
                            field.setLocalData(x, y, z, data);
                    // Local sequencing: tick schedules and neighbor updates
                    // must resolve inside the LOCAL space (dust propagation,
                    // lever scheduling, lamp ticks), not against the real
                    // terrain that happens to sit at the local keys.
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
                            if (field.covers(fx, fy, fz)) return; // field meshes rebuild themselves
                            const w = field.mapLocalToWorldInt(fx, fy, fz);
                            if (w.y < 0 || w.y >= World.TOTAL_HEIGHT) return;
                            if (typeof target.onBlockChanged === "function") {
                                target.onBlockChanged(w.x, w.y, w.z);
                            }
                        };
                    // Marker for placer items: suppress the server placement
                    // packet - summoned cells are client-side only and the
                    // server would persist a block nobody can see.
                    case "isFieldLocalWorld":
                        return true;
                }
                return target[prop];
            }
        });
        this._localWorldWorld = realWorld;

        return this._localWorld;
    }

    /** Test one local cell against the local-space ray. */
    traceCell(x, y, z, lFrom, lTo, localWorld) {
        const cell = this.cells.get(x + "," + y + "," + z);
        if (cell === undefined) return null;

        const block = Block.getById(cell.typeId) || BlockRegistry.get(cell.typeId);
        if (!block || !block.canInteract()) return null;

        return block.collisionRayTrace(localWorld, x, y, z, lFrom, lTo);
    }

    /**
     * Raytrace the summoned cells in local space so the hit follows the pose.
     *
     * @returns {MovingObjectPosition} with a world-space `vector` but LOCAL
     *          x/y/z and face (edits address cells in local space, which is
     *          also what the server echo keys off), or null / the 0/1 slab
     *          sentinels in slab mode.
     */
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