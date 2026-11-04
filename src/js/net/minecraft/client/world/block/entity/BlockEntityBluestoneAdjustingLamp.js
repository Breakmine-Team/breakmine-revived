import BlockEntityBluestoneLamp from "./BlockEntityBluestoneLamp.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneAdjustingLamp extends BlockEntityBluestoneLamp {

    static id = "bluestone_adjusting_lamp";
}

BlockEntityRegistry.register(BlockEntityBluestoneAdjustingLamp);
