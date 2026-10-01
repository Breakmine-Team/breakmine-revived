import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemTool extends Item {
    static materials = [null, 'wood', 'stone', 'iron', 'diamond', 'gold']

    static materialEfficiency = {
        'wood': 1,
        'stone': 2,
        'iron': 3,
        'diamond': 4,
        'gold': 5
    }

    constructor(id, textureName, name, material, toolType) {
        super(id, 0);
        this.tex = textureName;
        this.description = name;
        this.material = material;
        this.toolType = toolType;
        this.durability = ItemTool.materials.indexOf(material) * 64;
        this.isTool = true;
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    efficiency() {
        return ItemTool.materialEfficiency[this.material] || 0;
    }

    getTextureForFace(face) {
        return this.tex;
    }
}
