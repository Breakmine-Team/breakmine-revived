import ItemEdible from "../ItemEdible.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemBread extends ItemEdible {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bread";
        this.healAmount = 4;
        this.inventoryTab = EnumCreativeInventoryTab.FOODSTUFFS;
    }

    getTextureForFace(face) {
        return 'bread';
    }
}
