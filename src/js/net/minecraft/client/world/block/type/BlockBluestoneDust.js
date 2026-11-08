import BoundingBox from "../../../../util/BoundingBox.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import BlockEntityBluestoneDust from "../entity/BlockEntityBluestoneDust.js";
import { BlockRegistry } from "../BlockRegistry.js";

const MAX_POWER = 15;
const TICK_DELAY = 1;

export default class BlockBluestoneDust extends Block {
    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Dust";
        this.hardness = 0.5;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.isBluestoneDust = true;
    }

    getDrop(world, x, y, z) {
        return [BlockRegistry.ITEM_BLUESTONE_DUST_PLACER.getId(), 1];
    }

    _isBluestoneWire(block) {
        return !!(block && (block.isBluestoneDust || block.isBluestoneRod));
    }

    canConductTo(world, x, y, z, dx, dy, dz) {
        if (dy !== 0) return false;
        return this._isBluestoneWire(Block.getById(world.getBlockAt(x + dx, y + dy, z + dz)));
    }

    canReadFrom(world, x, y, z, dx, dy, dz) {
        const block = Block.getById(world.getBlockAt(x + dx, y + dy, z + dz));
        if (!this._isBluestoneWire(block)) return false;
        if (block.isBluestoneRod) return true;
        return dy === 0;
    }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestoneDust(world, x, y, z);
    }

    shouldRenderFace(world, x, y, z, face) {
        if (face === EnumBlockFace.TOP) return true;
        if (face === EnumBlockFace.BOTTOM) {
            return !world || world.getBlockAtFace(x, y, z, face) === 0;
        }
        return false;
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (!world || typeof x !== 'number') {
            return 'bluestoneDust0000';
        }

        const isConnectable = (tx, tz, targetFace) => this.canConnect(world, tx, y, tz, targetFace);
        const up    = isConnectable(x, z - 1, EnumBlockFace.SOUTH) ? "1" : "0";
        const down  = isConnectable(x, z + 1, EnumBlockFace.NORTH) ? "1" : "0";
        const left  = isConnectable(x - 1, z, EnumBlockFace.EAST) ? "1" : "0";
        const right = isConnectable(x + 1, z, EnumBlockFace.WEST) ? "1" : "0";

        return `bluestoneDust${up}${down}${left}${right}`;
    }

    canConnect(world, x, y, z, targetFace) {
        const blockId = world.getBlockAt(x, y, z);
        const block = Block.getById(blockId);
        if (!block) return false;

        if (this._isBluestoneWire(block)) return true;

        if (typeof block.bluestoneConnectingFaces === 'function') {
            const faces = block.bluestoneConnectingFaces(world, x, y, z);
            if (Array.isArray(faces)) {
                return faces.includes(targetFace);
            }
        }

        return !!(block.isPowerSource || block.isBluestoneConsumer);
    }

    isSolid() { return false; }
    getCollisionBoundingBox() { return null; }
    getBoundingBox() { return new BoundingBox(0, 0, 0, 1, 0.0625, 1); }
    isTranslucent() { return true; }

    getPower(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        return (typeof data === 'number' && data >= 0 && data <= MAX_POWER) ? data : 0;
    }

    calculatePower(world, x, y, z) {
        const neighbors = [
            [x + 1, y, z, EnumBlockFace.WEST],
            [x - 1, y, z, EnumBlockFace.EAST],
            [x, y, z + 1, EnumBlockFace.NORTH],
            [x, y, z - 1, EnumBlockFace.SOUTH],
            [x, y - 1, z, EnumBlockFace.TOP],
            [x, y + 1, z, EnumBlockFace.BOTTOM],
        ];

        let best = 0;

        for (const [nx, ny, nz, neighborFace] of neighbors) {
            const blockId = world.getBlockAt(nx, ny, nz);
            if (blockId === undefined || blockId === null || blockId === -1) continue;

            const block = Block.getById(blockId);
            if (!block) continue;

            if (this._isBluestoneWire(block)) {
                if (!this.canReadFrom(world, x, y, z, nx - x, ny - y, nz - z)) continue;
                const p = this.getPower(world, nx, ny, nz) - 1;
                if (p > best) best = p;
            } else if (typeof block.getPower === 'function') {
                const p = block.getPower(world, nx, ny, nz, neighborFace);
                if (p > best) best = p;
            } else if (block.isPowerSource) {
                return MAX_POWER;
            }
        }

        return Math.max(0, best);
    }

    _neighborOffsets() {
        return [
            [1, 0, 0],
            [-1, 0, 0],
            [0, 0, 1],
            [0, 0, -1],
            [0, -1, 0],
            [0, 1, 0],
        ];
    }

    _scheduleNeighbors(world, x, y, z) {
        for (const [dx, dy, dz] of this._neighborOffsets()) {
            world.scheduleBlockTick(x + dx, y + dy, z + dz, TICK_DELAY);
        }
    }

    onBlockAdded(world, x, y, z) {
        world.onBlockChanged(x + 1, y, z);
        world.onBlockChanged(x - 1, y, z);
        world.onBlockChanged(x, y, z + 1);
        world.onBlockChanged(x, y, z - 1);

        this.onBlockTick(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        world.setBlockDataAt(x, y, z, 0);

        for (const [dx, dy, dz] of this._neighborOffsets()) {
            if (this.canConductTo(world, x, y, z, dx, dy, dz)) {
                this.onBlockTick(world, x + dx, y + dy, z + dz);
            }
        }

        this._scheduleNeighbors(world, x, y, z);
    }

    onNeighborBlockChange(world, x, y, z) {
        this._scheduleNeighbors(world, x, y, z);
        this.onBlockTick(world, x, y, z);
    }

    onBlockTick(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;
        this._propagate(world, x, y, z);
    }

    
    _propagate(world, x, y, z) {
        const queue = [[x, y, z]];
        let steps = 0;

        while (queue.length > 0 && steps < 4096) {
            steps++;
            const [cx, cy, cz] = queue.pop();

            const wireBlock = Block.getById(world.getBlockAt(cx, cy, cz));
            if (!wireBlock || !(wireBlock.isBluestoneDust || wireBlock.isBluestoneRod)) continue;

            const newPower     = wireBlock.calculatePower(world, cx, cy, cz);
            const currentPower = this.getPower(world, cx, cy, cz);
            if (newPower === currentPower) continue;

            world.setBlockDataAt(cx, cy, cz, newPower);
            world.onBlockChanged(cx, cy, cz);

            this._scheduleNeighbors(world, cx, cy, cz);

            for (const [dx, dy, dz] of this._neighborOffsets()) {
                world.notifyNeighborBlockChange(cx + dx, cy + dy, cz + dz);
            }

            for (const [dx, dy, dz] of this._neighborOffsets()) {
                if (wireBlock.canConductTo(world, cx, cy, cz, dx, dy, dz)) {
                    queue.push([cx + dx, cy + dy, cz + dz]);
                }
            }
        }
    }

    getColor(world, x, y, z, face) {
        const power = (world && typeof x === 'number')
            ? this.getPower(world, x, y, z)
            : 0;
        const t = power / MAX_POWER;

        const min = { r: 0x18, g: 0x1A, b: 0x38 };
        const max = { r: 0x30, g: 0x70, b: 0xFF };

        const r = Math.round(min.r + (max.r - min.r) * t);
        const g = Math.round(min.g + (max.g - min.g) * t);
        const b = Math.round(min.b + (max.b - min.b) * t);

        return (r << 16) | (g << 8) | b;
    }

    getOpacity() {
        return 0;
    }

    getTransparency() {
        return 0.8;
    }

    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }
}