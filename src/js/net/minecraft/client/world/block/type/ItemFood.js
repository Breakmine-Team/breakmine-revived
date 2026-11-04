import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ItemEdible from "../ItemEdible.js";

/** A vanilla-style food item backed by the shared edible/use pipeline. */
export default class ItemFood extends ItemEdible {
    constructor(id, texture, name, nutrition, saturation) {
        super(id, 0);
        this.tex = texture;
        this.description = name;
        this.nutrition = nutrition;
        this.saturation = saturation;
        this.healAmount = nutrition;
        this.inventoryTab = EnumCreativeInventoryTab.FOODSTUFFS;
    }

    getTextureForFace() {
        return this.tex;
    }
}
