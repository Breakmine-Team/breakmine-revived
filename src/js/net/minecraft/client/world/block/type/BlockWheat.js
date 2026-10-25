import BlockCrop from "./BlockCrop.js";

export default class BlockWheat extends BlockCrop {

    static MAX_STAGE = 7;

    constructor(id, textureSlotId) {
        super(id, textureSlotId, {
            description: "Wheat Crops",
            texturePrefix: "wheat_stage",
            maxStage: BlockWheat.MAX_STAGE,
            plantItemKey: "ITEM_WHEAT_SEEDS",
            produceItemKey: "ITEM_WHEAT",
            produceMin: 1,
            produceMax: 1,
            seedDropMin: 1,
            seedDropMax: 3
        });
    }
}
