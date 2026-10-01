import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestonePusher extends BlockEntityBluestone {

    static id = "bluestone_pusher";
}

BlockEntityRegistry.register(BlockEntityBluestonePusher);
