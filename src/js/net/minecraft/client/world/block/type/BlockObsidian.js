import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockStoneLike from "./BlockStoneLike.js";

export default class BlockObsidian extends BlockStoneLike {

    constructor(id, textureSlotId) {
        super(id, textureSlotId, 'obsidian', 'Obsidian', 50.0, [id, 1], 'diamond');
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    handHardnessMultiplier() {
        return 1.5;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    minimumToolLevel() {
        return this.minLevel;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
