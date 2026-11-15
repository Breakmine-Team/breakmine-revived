import WorldGenerator from "./WorldGenerator.js";
import { BlockRegistry } from "../block/BlockRegistry.js";

// The Bob dimension reuses the overworld's terrain shape, but every solid block
// is a bob block: no caves, ravines, ores, trees or plants. Only bob and water.
export default class BobWorldGenerator extends WorldGenerator {

    constructor(world, seed, worldType = "bob") {
        super(world, seed, worldType);

        const bobId = BlockRegistry.BOB.getId();

        this.STONE_ID = bobId;
        this.GRASS_ID = bobId;
        this.DIRT_ID = bobId;
        this.SAND_ID = bobId;
        this.CLAY_ID = bobId;
        this.GRAVEL_ID = bobId;
        this.BEDROCK_ID = bobId;
    }

    generateInChunk(chunkX, chunkZ, primer) {
        this.generateTerrain(chunkX, chunkZ, primer);
        this.naturalize(chunkX, chunkZ, primer);
    }

    populateChunk(chunkX, chunkZ) {
        this.setChunkSeed(chunkX, chunkZ);
    }
}
