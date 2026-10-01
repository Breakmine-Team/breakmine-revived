import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockTerracotta extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 1.25;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
