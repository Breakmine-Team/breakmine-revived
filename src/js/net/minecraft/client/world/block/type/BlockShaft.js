import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";

/** A 4/16 stone rod; it faces the player who placed it. */
export default class BlockShaft extends BlockShaftPart {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Shaft";
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;
    }

    getShaftParts() {
        return [{part: ShaftRenderer.PART.SHAFT, texture: this.getShaftTexture()}];
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}
