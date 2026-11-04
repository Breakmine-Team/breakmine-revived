import Block from "../Block.js";

export default class BlockBeans extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Beans";
        this.hardness = 0.5;

        // Sound
        this.sound = Block.sounds.gravel;
    }

    getTextureForFace(face) {
        return 'beans';
    }
}