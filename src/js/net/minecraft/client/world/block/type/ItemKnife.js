import ItemTool from "./ItemTool.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemKnife extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'knife');
        this.inventoryTab = EnumCreativeInventoryTab.COMBAT;
    }
}
