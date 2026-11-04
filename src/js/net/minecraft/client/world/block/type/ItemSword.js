import ItemTool from "./ItemTool.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class ItemSword extends ItemTool {
    constructor(id, textureName, name, material) {
        super(id, textureName, name, material, 'sword');
        this.attackSpeed = 1.6;
        this.swingAnimationType = 'whack';
        this.swingDurationTicks = 6;
        this.attackAnimation = { type: 'whack', duration: 6 };
        this.inventoryTab = EnumCreativeInventoryTab.COMBAT;
    }
}
