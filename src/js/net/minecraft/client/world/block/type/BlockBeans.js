import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockBeans extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Beans";
        this.hardness = 0.5;

        this.sound = Block.sounds.gravel;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getTextureForFace(face) {
        return 'beans';
    }
}