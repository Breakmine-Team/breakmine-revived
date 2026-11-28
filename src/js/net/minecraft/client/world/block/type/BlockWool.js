import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockWool extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.8;
        // Wool is the lightest thing you can build with, so it floats best.
        this.mass = 0.2;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
