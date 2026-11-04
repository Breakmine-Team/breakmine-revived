import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneBlock extends BlockEntityBluestone {

    static id = "bluestone_block";
}

BlockEntityRegistry.register(BlockEntityBluestoneBlock);
