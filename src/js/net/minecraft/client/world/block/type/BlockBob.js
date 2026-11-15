import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockBob extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bob";
        this.textureName = "bob";
        this.hardness = 1.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
