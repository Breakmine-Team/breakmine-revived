import Block from "../Block.js";

//ID is converted like this:
//BlockUnbreakableBlock -> UnbreakableBlock -> unbreakable_block
//<modid>:unbreakable_block (assigned random hashed UUID)
export default class BlockUnbreakableBlock extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Unbreakable Block";
        this.hardness = -1.0;
    }

    getTextureForFace(face) {
        //<modId>:<textureName>
        return 'unbreakable_block:unbreakable_block';
    }
}