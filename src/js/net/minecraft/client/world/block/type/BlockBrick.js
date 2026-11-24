import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockBrick extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Brick";
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() { return 'pickaxe'; }

    getTextureForFace(face) {
        return 'brick';
    }
}
