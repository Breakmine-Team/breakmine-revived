import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";
import BlockBluestoneDust from "./BlockBluestoneDust.js";

const TICK_DELAY = 1;

export default class BlockBluestoneRod extends BlockBluestoneDust {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Rod";
        this.hardness = 0.5;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
        this.isBluestoneRod = true;
        this.multipart = true;
    }

    // The rod conducts bluestone power in every direction, including up and
    // down (unlike dust, which stays horizontal).
    canConductTo(world, x, y, z, dx, dy, dz) {
        return this._isBluestoneWire(Block.getById(world.getBlockAt(x + dx, y + dy, z + dz)));
    }

    canReadFrom(world, x, y, z, dx, dy, dz) {
        return this._isBluestoneWire(Block.getById(world.getBlockAt(x + dx, y + dy, z + dz)));
    }

    getMultipart(world, x, y, z) {
        return [
            // Flat dust layer on top of the block, like bluestone dust
            ["block", this.id, new BoundingBox(0, 0, 0, 1, 0.0625, 1)],
            // Vertical rod: 4px x 16px x 4px, centered on the block, using
            // the Bluestone Block texture with bluestone color fading
            ["block", BlockRegistry.BLUESTONE_ROD_PILLAR.id, new BoundingBox(0.375, 0, 0.375, 0.625, 1, 0.625)]
        ];
    }

    onBlockAdded(world, x, y, z) {
        this._scheduleNeighbors(world, x, y, z);
        this.onBlockTick(world, x, y, z);
    }
}
