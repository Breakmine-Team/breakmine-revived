import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockStone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Stone";
        this.hardness = 1.5;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    handHardnessMultiplier() {
        return 1.5;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
    
    getDrop(world, x, y, z) {
        return [4, 1];
    }

    getTextureForFace(face) {
        return 'stone';
    }
}