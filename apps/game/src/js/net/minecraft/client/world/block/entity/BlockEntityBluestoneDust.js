import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneDust extends BlockEntityBluestone {

    static id = "bluestone_dust";
}

BlockEntityRegistry.register(BlockEntityBluestoneDust);
