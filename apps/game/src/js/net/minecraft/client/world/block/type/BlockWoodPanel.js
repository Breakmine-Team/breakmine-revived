import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";

export default class BlockWoodPanel extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Oak Panel";
        this.hardness = 2.0;
        this.boundingBox = new BoundingBox(0, 0, 0, 1, (1/16), 1);
        this.multipart = true;
        this.noFaceCull = true;
    }
    
    getPreferredToolType() {
        return 'axe';
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getTextureForFace(face) {
        return 'planks_oak';
    }

    getMultipart(world, x, y, z) {
        return [["block", 5, this.boundingBox]];
    }

    getAmbientOcclusion() {
        return false;
    }
}
