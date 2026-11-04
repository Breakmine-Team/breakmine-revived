import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneRepeater extends BlockEntityBluestone {

    static id = "bluestone_repeater";
}

BlockEntityRegistry.register(BlockEntityBluestoneRepeater);
