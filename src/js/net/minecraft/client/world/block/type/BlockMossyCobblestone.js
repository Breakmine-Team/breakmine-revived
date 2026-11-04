import Block from "../Block.js";

export default class BlockMossyCobblestone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Mossy Cobblestone";
        this.hardness = 2.0;
    }

    getTextureForFace(face) {
        return 'mossy_cobblestone';
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}