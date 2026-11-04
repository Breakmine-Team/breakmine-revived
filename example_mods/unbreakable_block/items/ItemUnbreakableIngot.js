import Item from "../Item.js";

export default class ItemUnbreakableIngot extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.tex = 'unbreakable_block:unbreakable_block';
        this.description = "Unbreakable Ingot";
    }

    getTextureForFace(face) {
        return 'unbreakable_block:unbreakable_block';
    }
}
