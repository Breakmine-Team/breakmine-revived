import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockWood extends Block {

    constructor(id, textureSlotId, woodType = "oak", displayName = "Oak Planks") {
        super(id, textureSlotId);
        this.description = displayName;
        this.woodType = woodType;
        this.hardness = 2.0;
        
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return this.woodType + '_planks';
    }
    
    getPreferredToolType() {
        return 'axe';
    }
}
