import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockCheese extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Cheese";
        this.textureName = "cheese";
        this.hardness = 0.5;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.FOOD;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}