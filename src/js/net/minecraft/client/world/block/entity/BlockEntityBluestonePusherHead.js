import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestonePusherHead extends BlockEntityBluestone {

    static id = "bluestone_pusher_head";
}

BlockEntityRegistry.register(BlockEntityBluestonePusherHead);
