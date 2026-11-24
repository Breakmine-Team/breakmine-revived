import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const RADIUS = 3;
const TOGGLE_CHANCE = 0.35;

export default class BlockRawUranium extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Raw Uranium";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace() {
        return 'raw_uranium';
    }

    isBluestoneInterference(block) {
        if (!block) return false;
        if (typeof block.doorBottomId === 'number') return false; // doors are never toggled
        if (block.lever === true) return true;
        return block.isBluestoneConsumer === true && block.isPusher !== true;
    }

    onBlockAdded(world, x, y, z) {
        this.scheduleInterference(world, x, y, z);
    }

    scheduleInterference(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, 20 + Math.floor(Math.random() * 40));
    }

    onBlockTick(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        this.scheduleInterference(world, x, y, z);

        if (Math.random() > TOGGLE_CHANCE) return;

        const targets = [];
        for (let dx = -RADIUS; dx <= RADIUS; dx++) {
            for (let dy = -RADIUS; dy <= RADIUS; dy++) {
                for (let dz = -RADIUS; dz <= RADIUS; dz++) {
                    if (dx === 0 && dy === 0 && dz === 0) continue;
                    if (dx * dx + dy * dy + dz * dz > RADIUS * RADIUS) continue;
                    const targetId = world.getBlockAt(x + dx, y + dy, z + dz);
                    if (!this.isBluestoneInterference(Block.getById(targetId))) continue;
                    targets.push([x + dx, y + dy, z + dz]);
                }
            }
        }

        if (targets.length === 0) return;

        const [targetX, targetY, targetZ] = targets[Math.floor(Math.random() * targets.length)];
        this.toggleBluestone(world, targetX, targetY, targetZ);
    }

    toggleBluestone(world, x, y, z) {
        const block = Block.getById(world.getBlockAt(x, y, z));
        if (!this.isBluestoneInterference(block)) return;

        const data = world.getBlockDataAt(x, y, z) || 0;

        if (block.lever === true) {
            world.setBlockDataAt(x, y, z, (data & ~1) | (1 - (data & 1)));
            world.scheduleNeighborTicks(x, y, z);
            world.notifyNeighborBlockChange(x, y, z);
            return;
        }

        // The adjustable lamp stores brightness (0-15) instead of an on/off bit
        if (typeof block._getStoredPower === 'function') {
            const power = block._getStoredPower(world, x, y, z);
            world.setBlockDataAt(x, y, z, power > 0 ? 0 : 15);
        } else {
            world.setBlockDataAt(x, y, z, (data & ~1) | (1 - (data & 1)));
        }

        world.onBlockChanged(x, y, z);
        world.scheduleBlockTick(x, y, z, 1);
    }
}
