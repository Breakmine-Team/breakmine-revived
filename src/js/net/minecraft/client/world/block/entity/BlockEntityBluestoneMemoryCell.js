import BlockEntityBluestone from "./BlockEntityBluestone.js";
import BlockEntityRegistry from "./BlockEntityRegistry.js";

export default class BlockEntityBluestoneMemoryCell extends BlockEntityBluestone {

    static id = "bluestone_memory_cell";
}

BlockEntityRegistry.register(BlockEntityBluestoneMemoryCell);
