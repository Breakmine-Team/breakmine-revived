import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemFlint extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Flint";
        this.isTool = false;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    getTextureForFace(face) {
        return 'flint';
    }
}
