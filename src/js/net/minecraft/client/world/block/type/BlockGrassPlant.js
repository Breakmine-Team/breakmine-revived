import BlockFlower from "./BlockFlower.js";
import BlockGrass from "./BlockGrass.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class BlockGrassPlant extends BlockFlower {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId, textureName, name);
    }

    getDrop(world, x, y, z) {
        // Grass is the natural source of wheat seeds. Sometimes it gives the
        // plant itself instead (green dye), so the drop is not guaranteed.
        if (Math.random() < 0.35) {
            return [BlockRegistry.ITEM_WHEAT_SEEDS.getId(), 1];
        }
        return [this.id, 1];
    }

    getColor(world, x, y, z, face) {
        if (world === null) {
            return 0x7cbd6b;
        }

        let temperature = world.getTemperature(x, y, z);
        let humidity = world.getHumidity(x, y, z);
        let color = world.minecraft.grassColorizer.getColor(temperature, humidity);

        // Match the grass block: blue the closer to a Snowy biome
        const snowDist = BlockGrass.getDistanceToSnowBiome(world, x, z);
        if (snowDist < 5) {
            color = BlockGrass.blendTowardBlue(color, (5 - snowDist) / 5);
        }

        return color;
    }
}
