import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGrass extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Grass Block";
        this.hardness = 0.6;

        // Sound
        this.sound = Block.sounds.grass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }
    
    getPreferredToolType() {
        return 'shovel';
    }

    getColor(world, x, y, z, face) {
        // Only top face has a biome color
        if (face !== EnumBlockFace.TOP) {
            return 0xFFFFFF;
        }

        // Inventory items have a default color
        if (world === null) {
            return 0x7cbd6b;
        }

        let temperature = world.getTemperature(x, y, z);
        let humidity = world.getHumidity(x, y, z);
        return world.minecraft.grassColorizer.getColor(temperature, humidity);
    }

    getDrop(world, x, y, z) {
        return [BlockRegistry.DIRT.getId(), 1]; // Drop dirt block
    }

    getParticleTextureFace() {
        return EnumBlockFace.NORTH;
    }

    getTextureForFace(face, data, x, y, z, world) {
        switch (face) {
            case EnumBlockFace.TOP:
                return 'grass_top';
            case EnumBlockFace.BOTTOM:
                return 'dirt';
            default:
                return (world && world.getBlockAt(x, y + 1, z) === BlockRegistry.SNOW.getId()) ? 'grass_block_snow' : 'grass_side';
        }
    }

}