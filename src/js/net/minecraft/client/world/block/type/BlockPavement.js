import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockPavement extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 1.5;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
