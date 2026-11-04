import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockClay extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.textureName = textureName;
        this.hardness = 0.6;
        this.sound = Block.sounds.gravel;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getDrop(world, x, y, z) {
        return [BlockRegistry.ITEM_CLAY_BALL.getId(), 4];
    }

    getTextureForFace(face) {
        return this.textureName;
    }
}
