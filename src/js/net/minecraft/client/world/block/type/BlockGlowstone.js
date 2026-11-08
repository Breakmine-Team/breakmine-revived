import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGlowstone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Glowstone";
        this.hardness = 0.3;
        this.sound = Block.sounds.glass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace() {
        return 'glowstone';
    }

    getLightValue() {
        return 15;
    }
}
