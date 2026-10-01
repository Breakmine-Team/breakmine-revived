import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockBluestoneDust from "./BlockBluestoneDust.js";

export default class BlockBluestoneLeverDust extends BlockBluestoneDust {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Lever";
        this.hardness = 0.5;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.isBluestoneDust = false;
    }

    getPower(world, x, y, z) {
        if (world && typeof x === 'number') {
            return ((world.getBlockDataAt(x, y, z) || 0) & 1) === 1 ? 15 : 0;
        }
        return 0;
    }
}
