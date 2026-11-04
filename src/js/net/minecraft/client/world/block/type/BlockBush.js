import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockBush extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Flower Bush";
        this.hardness = 0.0;

        // Sound
        this.sound = Block.sounds.grass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face, data, x, y, z, world) {
        const value = (x + y + z) % 3;
        return value == 0 ? 'bush' : value == 1 ? 'bush2' : 'bush3';
    }
    
    getDrop(world, x, y, z) {
        const rnd = Math.random();
        if (rnd < 0.5) {
            return [BlockRegistry.ITEM_APPLE.getId(), 1];
        } else {
            return [BlockRegistry.ITEM_STICK.getId(), 1];
        }
    }

    shouldRenderFace(world, x, y, z, face) {
        let typeId = world.getBlockAtFace(x, y, z, face);
        return typeId === 0 || typeId !== this.id || typeId === this.id || typeId === BlockRegistry.LEAVE.getId();
    }

    isTranslucent() {
        return true;
    }

    canCastAmbientOcclusion() {
        return true;
    }
}
