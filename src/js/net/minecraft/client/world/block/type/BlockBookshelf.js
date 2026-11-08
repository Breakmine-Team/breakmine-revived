import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockBookshelf extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bookshelf";
        this.hardness = 1.5;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getPreferredToolType() {
        return 'axe';
    }

    getTextureForFace(face) {
        return face === EnumBlockFace.TOP || face === EnumBlockFace.BOTTOM
            ? 'oak_planks'
            : 'bookshelf';
    }
}
