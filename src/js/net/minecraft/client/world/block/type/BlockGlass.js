import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGlass extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Glass";
        this.hardness = 0.3;

        // Sound
        this.sound = Block.sounds.glass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return 'glass';
    }

    isTranslucent() {
        return true;
    }

    shouldRenderFace(world, x, y, z, face) {
        let typeId = world.getBlockAtFace(x, y, z, face);
        return typeId === 0 || typeId !== this.id;
    }

    getOpacity() {
        return 0;
    }
}