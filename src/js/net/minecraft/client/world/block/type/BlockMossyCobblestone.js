import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockMossyCobblestone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Mossy Cobblestone";
        this.hardness = 2.0;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return 'mossy_cobblestone';
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}