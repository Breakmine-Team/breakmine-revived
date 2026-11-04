import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

export default class BlockStoneBrick extends Block {

    constructor(id, textureSlotId, textureName, name, hardness = 3.0, drop = [4, 1], minLevel = null) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = hardness;
        this.drop = drop;
        this.minLevel = minLevel;

        // Sound
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;
    }

    handHardnessMultiplier() {
        return 1.5;
    }

    getPreferredToolType() {
        return 'pickaxe';
    }

    minimumToolLevel() {
        return this.minLevel;
    }
    
    getDrop(world, x, y, z) {
        return this.drop;
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}