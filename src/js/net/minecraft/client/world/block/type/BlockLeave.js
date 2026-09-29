import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockLeave extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Oak Leaves";
        this.hardness = 0.2;

        // Sound
        this.sound = Block.sounds.leaves;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getTextureForFace(face) {
        return 'oak_leaves';
    }

    shouldRenderFace(world, x, y, z, face) {
        let typeId = world.getBlockAtFace(x, y, z, face);
        return typeId === 0 || typeId !== this.id || typeId === this.id;
    }

    isTranslucent() {
        return true;
    }

    canCastAmbientOcclusion() {
        return true;
    }
    
    getDrop(world, x, y, z) {
        const rnd = Math.random();
        const rnd2 = Math.random();
        if (rnd2 > 0.5) {
            if (rnd < 0.4) {
                return [BlockRegistry.ITEM_APPLE.getId(), 1];
            } else {
                return [BlockRegistry.ITEM_STICK.getId(), 1];
            }
        }
    }

    getColor(world, x, y, z, face) {
        if (world === null) {
            return 0 << 16 | 255 << 8 | 0;
        }

        let temperature = world.getTemperature(x, y, z);
        let humidity = world.getHumidity(x, y, z);
        return world.minecraft.grassColorizer.getColor(temperature, humidity);
    }
}