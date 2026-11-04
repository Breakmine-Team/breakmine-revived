import Block from "../Block.js";

export default class BlockBrick extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Brick";
    }

    getPreferredToolType() { return 'pickaxe'; }

    getTextureForFace(face) {
        return 'brick';
    }
}
