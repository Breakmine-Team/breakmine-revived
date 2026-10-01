import BlockLiquid from "./BlockLiquid.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockLava extends BlockLiquid {

    constructor(id, textureSlotId) {
        super(id, textureSlotId, 'lava');
        this.description = "Lava";
        this.hardness = -1.0;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
    }

    getTextureForFace(face) {
        return 'lava';
    }

    getLightValue() {
        return 15;
    }

    isLava() {
        return true;
    }

    getOppositeLiquidId() {
        return BlockRegistry.WATER.getId();
    }

    getSolidificationId() {
        return BlockRegistry.COBBLE_STONE.getId();
    }
}
