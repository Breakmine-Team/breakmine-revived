import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockIce extends Block {

    constructor(id, textureSlotId, textureName, name, hardness = 0.5, slipperiness = 0.98) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = hardness;
        this.slipperiness = slipperiness;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    handHardnessMultiplier() {
        return 1.4;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
