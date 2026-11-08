import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockSand extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Sand";
        this.hardness = 0.5;

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
        world.scheduleBlockTick(x, y, z, 3);
    }

    onBlockTick(world, x, y, z) {
        if (!world.isSolidBlockAt(x, y - 1, z)) {
            let typeId = world.getBlockAt(x, y, z);
            let blockData = world.getBlockDataAt(x, y, z);

            world.setBlockAt(x, y, z, 0, 0);
            world.setBlockAt(x, y - 1, z, typeId, blockData);

            if (y - 1 > 0 && !world.isSolidBlockAt(x, y - 2, z)) {
                world.scheduleBlockTick(x, y - 1, z, 3);
            }
        }
    }
}