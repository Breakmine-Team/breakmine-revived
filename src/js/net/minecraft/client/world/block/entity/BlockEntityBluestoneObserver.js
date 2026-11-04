import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneObserver extends BlockEntityBluestone {

    static id = "bluestone_observer";
}

BlockEntityRegistry.register(BlockEntityBluestoneObserver);
