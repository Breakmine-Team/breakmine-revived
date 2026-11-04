import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ItemEdible from "../ItemEdible.js";

export default class ItemApple extends ItemEdible {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Apple";
        this.healAmount = 2;
        this.inventoryTab = EnumCreativeInventoryTab.FOODSTUFFS;
    }

    getTextureForFace(face) {
        return 'apple';
    }
}
