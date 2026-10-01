import BlockFlower from "./BlockFlower.js";

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
        return world.minecraft.grassColorizer.getColor(temperature, humidity);
    }
}
