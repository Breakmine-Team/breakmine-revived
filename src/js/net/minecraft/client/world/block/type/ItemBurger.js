import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ItemEdible from "../ItemEdible.js";

export default class ItemBurger extends ItemEdible {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Burger";
        this.healAmount = 6;
        this.inventoryTab = EnumCreativeInventoryTab.FOODSTUFFS;
    }

    getTextureForFace(face) {
        return 'burger';
    }
}
