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

    getOpacity() {
        return 0;
    }

    getTransparency() {
        return 0.2;
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    canConductTo(world, x, y, z, dx, dy, dz) {
        return this._isBluestoneWire(Block.getById(world.getBlockAt(x + dx, y + dy, z + dz)));
    }

    canReadFrom(world, x, y, z, dx, dy, dz) {
        return this._isBluestoneWire(Block.getById(world.getBlockAt(x + dx, y + dy, z + dz)));
    }

    getMultipart(world, x, y, z) {
        return [
            ["block", this.id, new BoundingBox(0, 0, 0, 1, 0.0625, 1)],
            ["block", BlockRegistry.BLUESTONE_ROD_PILLAR.id, new BoundingBox(0.375, 0, 0.375, 0.625, 1, 0.625)]
        ];
    }

    onBlockAdded(world, x, y, z) {
        this._scheduleNeighbors(world, x, y, z);
        this.onBlockTick(world, x, y, z);
    }
}
