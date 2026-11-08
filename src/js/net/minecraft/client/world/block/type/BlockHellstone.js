import Block from "../Block.js";

export default class BlockHellstone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Hellstone";
        this.hardness = 0.4;
        this.sound = Block.sounds.stone;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace() {
        return 'netherrack';
    }
}
