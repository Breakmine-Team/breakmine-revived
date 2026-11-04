import Block from "../Block.js";

export default class BlockMoldyBeans extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Moldy Beans";
        this.hardness = 0.5;

        // Sound
        this.sound = Block.sounds.gravel;
    }

    getTextureForFace(face) {
        return 'moldy_beans';
    }
}