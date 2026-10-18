import BlockFlower from "./BlockFlower.js";
import BlockGrass from "./BlockGrass.js";

export default class BlockGrassPlant extends BlockFlower {

    constructor(id, textureSlotId, textureName, name) {
        super(id, textureSlotId, textureName, name);
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
