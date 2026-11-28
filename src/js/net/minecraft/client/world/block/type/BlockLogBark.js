import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockLogBark extends Block {

    constructor(id, textureSlotId, woodType = "oak", displayName = "Oak Bark") {
        super(id, textureSlotId);
        this.description = displayName;
        this.woodType = woodType;
        this.hardness = 2.0;
        this.mass = 1.6;

        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }
    
    getPreferredToolType() {
        return 'axe';
    }

    getTextureForFace(face, data = 0) {
        return `${this.woodType}_log`;
    }
}
