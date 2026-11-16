import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

// Chorus plant is a regular solid block (full 3D bounding box), not a
// cross-shaped decoration: you can stand on it and it blocks light.
export default class BlockChorusPlant extends Block {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId);
        this.description = name;
        this.shiftDescription = "Drops a chorus fruit";
        this.textureName = textureName;
        this.hardness = 0.4;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return this.textureName;
    }

    getDrop(world, x, y, z) {
        return [BlockRegistry.ITEM_CHORUS_FRUIT.getId(), 1];
    }
}
