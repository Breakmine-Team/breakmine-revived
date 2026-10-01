import BlockLiquid from "./BlockLiquid.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockWater extends BlockLiquid {

    constructor(id, textureSlotId) {
        super(id, textureSlotId, 'water');
        this.description = "Water";
        this.hardness = -1.0;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
    }

    getTextureForFace(face) {
        return 'water_still';
    }

    getOppositeLiquidId() {
        return BlockRegistry.LAVA.getId();
    }

    getSolidificationId() {
        return BlockRegistry.COBBLE_STONE.getId();
    }
}
