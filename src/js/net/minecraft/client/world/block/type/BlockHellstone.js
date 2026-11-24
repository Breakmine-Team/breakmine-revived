import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockHellstone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Hellstone";
        this.hardness = 0.4;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace() {
        return 'netherrack';
    }
}
