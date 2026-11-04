import Block from "../Block.js";

export default class BlockMissing extends Block {

    constructor(id) {
        super(id, 0);
        this.description = "Missing Block";
    }

    getTextureForFace(face) {
        return 'missing';
    }
}
