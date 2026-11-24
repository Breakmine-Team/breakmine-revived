import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockCobblestone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Cobblestone";
        this.hardness = 2.0;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() { return 'pickaxe'; }

    getTextureForFace(face) {
        return 'cobblestone';
    }
}