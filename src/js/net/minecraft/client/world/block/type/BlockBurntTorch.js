import BlockTorch from "./BlockTorch.js";

export default class BlockBurntTorch extends BlockTorch {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Burnt Torch";
    }

    getTextureForFace(face) {
        return 'torch_off';
    }

    getLightValue() {
        return 0;
    }
}
