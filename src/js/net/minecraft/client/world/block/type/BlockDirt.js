import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockDirt extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Dirt";
        this.hardness = 0.5;

        // Sound
        this.sound = Block.sounds.gravel;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }
    
    getPreferredToolType() {
        return 'shovel';
    }

    getTextureForFace(face) {
        return 'dirt';
    }
}