import Block from "../Block.js";

export default class BlockCobblestone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Cobblestone";
        this.hardness = 2.0;
        this.requiresToolForDrops = true;
    }

    getPreferredToolType() { return 'pickaxe'; }

    getTextureForFace(face) {
        return 'cobblestone';
    }
}
