import ItemEdible from "../ItemEdible.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemFood extends ItemEdible {

    constructor(id, textureName, description, healAmount = 2) {
        super(id, 0);
        this.tex = textureName;
        this.description = description;
        this.healAmount = healAmount;
        this.inventoryTab = EnumCreativeInventoryTab.FOODSTUFFS;
    }

    getTextureForFace(face) {
        return this.tex;
    }
}
