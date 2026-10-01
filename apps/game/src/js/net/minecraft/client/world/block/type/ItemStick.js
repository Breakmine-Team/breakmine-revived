import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemStick extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Stick";
        this.isTool = true;
    }

    getTextureForFace(face) {
        return 'stick';
    }
}
