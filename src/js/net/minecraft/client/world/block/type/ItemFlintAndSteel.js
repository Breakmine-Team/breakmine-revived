import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemFlintAndSteel extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Flint and Steel";
        this.isTool = false;
        this.maxStackSize = 1;
        this.durability = 64;
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    getTextureForFace(face) {
        return 'flint_and_steel';
    }
}
