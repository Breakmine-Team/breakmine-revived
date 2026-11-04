import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockBedrock extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bedrock";
        this.hardness = -1.0;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return 'bedrock';
    }
}