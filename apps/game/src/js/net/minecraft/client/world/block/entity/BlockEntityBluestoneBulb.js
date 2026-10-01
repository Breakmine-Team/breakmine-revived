import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneBulb extends BlockEntityBluestone {

    static id = "bluestone_bulb";
}

BlockEntityRegistry.register(BlockEntityBluestoneBulb);
