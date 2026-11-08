import Block from "../Block.js";

export default class BlockLogBark extends Block {

    constructor(id, textureSlotId, woodType = "oak", displayName = "Oak Bark") {
        super(id, textureSlotId);
        this.description = displayName;
        this.woodType = woodType;
        this.hardness = 2.0;

        this.sound = Block.sounds.wood;
    }
    
    getPreferredToolType() {
        return 'axe';
    }

    getTextureForFace(face, data = 0) {
        return `${this.woodType}_log`;
    }
}
