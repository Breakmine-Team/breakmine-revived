import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneLamp extends BlockEntityBluestone {

    static id = "bluestone_lamp";
}

BlockEntityRegistry.register(BlockEntityBluestoneLamp);
