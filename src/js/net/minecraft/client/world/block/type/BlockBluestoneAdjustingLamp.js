import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockEntityBluestoneAdjustingLamp from "../entity/BlockEntityBluestoneAdjustingLamp.js";

const MAX_POWER = 15;

export default class BlockBluestoneAdjustingLamp extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Adjustable Bluestone Lamp";
        this.hardness = 0.3;
        this.isBluestoneConsumer = true;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestoneAdjustingLamp(world, x, y, z);
    }

    isSolid() { return true; }

    _getStoredPower(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        return (typeof data === 'number' && data >= 0 && data <= MAX_POWER) ? data : 0;
    }

    calculatePower(world, x, y, z) {
        // Corrected neighborFace values:
        // +X (East block) -> Facing Lamp via WEST face
        // -X (West block) -> Facing Lamp via EAST face
        // +Z (South block) -> Facing Lamp via NORTH face
        // -Z (North block) -> Facing Lamp via SOUTH face
        // -Y (Bottom block) -> Facing Lamp via TOP face
        // +Y (Top block) -> Facing Lamp via BOTTOM face
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
            if (!block || block === this) continue;

            if (typeof block.getPower === 'function') {
                const p = block.getPower(world, nx, ny, nz, neighborFace);
                if (p > best) best = p;
            } else if (block.isPowerSource) {
                return MAX_POWER;
            }
        }

        return Math.max(0, best);
    }

    updateState(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        const newPower = this.calculatePower(world, x, y, z);
        const current = this._getStoredPower(world, x, y, z);

        if (newPower !== current) {
            world.setBlockDataAt(x, y, z, newPower);
            world.onBlockChanged(x, y, z);
        }
    }

    getLightValue(world, x, y, z) {
        if (!world || typeof x !== 'number') return 0;
        return this._getStoredPower(world, x, y, z);
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (!world || typeof x !== 'number') {
            return 'bluestoneLampOff';
        }
        return this._getStoredPower(world, x, y, z) > 0
            ? 'bluestoneLampOn'
            : 'bluestoneLampOff';
    }

    getColor(world, x, y, z, face) {
        const power = (world && typeof x === 'number') ? this._getStoredPower(world, x, y, z) : 0;
        if (power <= 0) return 0xffffff;

        const t = power / MAX_POWER;

        // Warm glow that dims toward dark as the power level drops.
        const min = { r: 0x3a, g: 0x2e, b: 0x22 };
        const max = { r: 0xff, g: 0xf4, b: 0xdd };

        const r = Math.round(min.r + (max.r - min.r) * t);
        const g = Math.round(min.g + (max.g - min.g) * t);
        const b = Math.round(min.b + (max.b - min.b) * t);

        return (r << 16) | (g << 8) | b;
    }

    onBlockAdded(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, 1);
    }

    onNeighborBlockChange(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, 1);
    }

    onBlockTick(world, x, y, z) {
        this.updateState(world, x, y, z);
    }
}
