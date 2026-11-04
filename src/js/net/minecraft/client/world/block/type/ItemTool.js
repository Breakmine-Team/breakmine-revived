import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemTool extends Item {
    static materials = [null, 'wood', 'stone', 'iron', 'diamond', 'gold']

    static materialDurability = {
        wood: 59,
        stone: 131,
        iron: 250,
        diamond: 1561,
        gold: 32
    };

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
        this.attackSpeed = ItemTool.attackSpeeds[toolType]?.[material] ?? 4.0;
        this.attackAnimation = { type: 'whack', duration: 6 };
        this.durability = ItemTool.materialDurability[material] ?? 0;
        this.maxStackSize = 1;
        this.isTool = true;
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    static attackSpeeds = {
        axe: {
            wood: 0.8,
            stone: 0.8,
            iron: 0.9,
            diamond: 1.0,
            gold: 1.0
        },
        pickaxe: {
            wood: 1.2,
            stone: 1.2,
            iron: 1.2,
            diamond: 1.2,
            gold: 1.2
        },
        shovel: {
            wood: 1.0,
            stone: 1.0,
            iron: 1.0,
            diamond: 1.0,
            gold: 1.0
        },
        hoe: {
            wood: 1.0,
            stone: 2.0,
            iron: 3.0,
            diamond: 4.0,
            gold: 1.0
        }
    };

    efficiency() {
        return ItemTool.materialEfficiency[this.material] || 0;
    }

    getTextureForFace(face) {
        return this.tex;
    }
}
