import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockStoneLike from "./BlockStoneLike.js";

export default class BlockCryingObsidian extends BlockStoneLike {

    constructor(id, textureSlotId) {
        super(id, textureSlotId, 'crying_obsidian', 'Crying Obsidian', 50.0, [id, 1], 'diamond');
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
