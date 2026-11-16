import BlockChorusPlant from "./BlockChorusPlant.js";

// The chorus flower is a solid block too, so it needs its own texture but the
// same shape, drops and behaviour as the plant.
export default class BlockChorusFlower extends BlockChorusPlant {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId, textureName, name);
        this.shiftDescription = "Drops a chorus fruit";
    }
}
