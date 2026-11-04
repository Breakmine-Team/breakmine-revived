import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockConcrete extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.8;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
