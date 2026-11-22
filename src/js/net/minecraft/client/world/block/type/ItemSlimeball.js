import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemSlimeball extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Slimeball";
        this.isTool = false;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    getTextureForFace(face) {
        return 'slime_ball';
    }
}
