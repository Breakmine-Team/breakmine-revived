import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockSnow extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Snow";
        this.hardness = 0.3;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    handHardnessMultiplier() {
        return 1.4;
    }

    getPreferredToolType() {
        return 'shovel';
    }

    getTextureForFace(face) {
        return 'snow';
    }
}