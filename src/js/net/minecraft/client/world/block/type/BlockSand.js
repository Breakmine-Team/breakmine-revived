import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockSand extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Sand";
        this.hardness = 0.5;

        // Sound
        this.sound = Block.sounds.sand;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }
    
    getPreferredToolType() {
        return 'shovel';
    }

    getTextureForFace(face) {
        return 'sand';
    }

    onBlockPlaced(world, x, y, z, face) {
        // Schedule a tick to check if it should fall
        world.scheduleBlockTick(x, y, z, 3);
    }

    onBlockTick(world, x, y, z) {
        // Check if block below is not solid
        if (!world.isSolidBlockAt(x, y - 1, z)) {
            // Fall down
            let typeId = world.getBlockAt(x, y, z);
            let blockData = world.getBlockDataAt(x, y, z);

            // Move block down
            world.setBlockAt(x, y, z, 0, 0);
            world.setBlockAt(x, y - 1, z, typeId, blockData);

            // Schedule another tick if it can continue falling
            if (y - 1 > 0 && !world.isSolidBlockAt(x, y - 2, z)) {
                world.scheduleBlockTick(x, y - 1, z, 3);
            }
        }
    }
}