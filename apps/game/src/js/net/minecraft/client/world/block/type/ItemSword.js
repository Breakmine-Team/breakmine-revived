import ItemTool from "./ItemTool.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemSword extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'sword');
        this.inventoryTab = EnumCreativeInventoryTab.COMBAT;
    }
}
