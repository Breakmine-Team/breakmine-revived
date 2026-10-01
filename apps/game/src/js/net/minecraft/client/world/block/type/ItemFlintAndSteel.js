import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemFlint extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Flint and Steel";
        this.isTool = false;
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    getTextureForFace(face) {
        return 'flint_and_steel';
    }
}
