import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import BlockEntityBluestoneBulb from "../entity/BlockEntityBluestoneBulb.js";

export default class BlockBluestoneBulb extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Bulb";
        this.hardness = 0.3;
        this.isBluestoneConsumer = true;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestoneBulb(world, x, y, z);
    }

    isSolid() { return true; }

    isPowered(world, x, y, z) {
        const neighbors = [
            [x + 1, y, z],
            [x - 1, y, z],
            [x, y, z + 1],
            [x, y, z - 1],
            [x, y - 1, z],
            [x, y + 1, z],
        ];

        for (const [nx, ny, nz] of neighbors) {
            const blockId = world.getBlockAt(nx, ny, nz);
            if (blockId === undefined || blockId === null || blockId === -1) continue;

            const block = Block.getById(blockId);
            if (!block) continue;

            if (typeof block.getPower === 'function') {
                if (block.getPower(world, nx, ny, nz) > 0) return true;
            } else if (block.isPowerSource) {
                return true;
            }
        }

        return false;
    }

    getState(world, x, y, z) {
        const data = world.getBlockDataAt(x, y, z);
        return (data & 1) === 1 ? 1 : 0;
    }

    updateState(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        const powered = this.isPowered(world, x, y, z) ? 1 : 0;
        const data = world.getBlockDataAt(x, y, z);
        const isOn = (data & 1) === 1;
        const wasPowered = (data & 2) === 2;

        let newData = data;

        // Rising edge of power toggles the bulb.
        if (powered === 1 && !wasPowered) {
            newData = isOn ? (newData & ~1) : (newData | 1);
        }

        // Track the last seen power state (bit 1) to detect edges.
        newData = powered === 1 ? (newData | 2) : (newData & ~2);

        if (newData !== data) {
            world.setBlockDataAt(x, y, z, newData);
            world.onBlockChanged(x, y, z);
        }
    }

    getLightValue(world, x, y, z) {
        if (!world || typeof x !== 'number') return 0;
        return this.getState(world, x, y, z) === 1 ? 14 : 0;
    }

    getTextureForFace(face, data, x, y, z, world) {
        if (!world || typeof x !== 'number') {
            return 'bluestoneBulbOff';
        }
        return this.getState(world, x, y, z) === 1
            ? 'bluestoneBulbOn'
            : 'bluestoneBulbOff';
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
