import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockCounter extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Counter";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getTextureForFace(face) {
        switch (face) {
            case EnumBlockFace.TOP:
                return 'counter_top';
            case EnumBlockFace.BOTTOM:
                return 'spruce_planks';
            default:
                return 'counter_side';
        }
    }

    pickedItem() {
        return this.id;
    }
}
