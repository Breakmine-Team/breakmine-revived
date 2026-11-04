import Primer from "./Primer.js";
import Generator from "./Generator.js";
import { BlockRegistry } from "../block/BlockRegistry.js";
import NoiseGeneratorOctaves from "./noise/NoiseGeneratorOctaves.js";

export default class FlatWorldGenerator extends Generator {
    static FLAT_HEIGHT = 64; 
    static CHUNK_SIZE = 16;
    
    constructor(world, seed) {
        super(world, seed);

        this.populationNoiseGenerator = new NoiseGeneratorOctaves(this.random, 8);
        
        const FLAT_HEIGHT = FlatWorldGenerator.FLAT_HEIGHT;
        this.precalculatedColumn = new Array(FLAT_HEIGHT + 1).fill(0);
        
        const topGrassY = FLAT_HEIGHT;
        const topDirtY = FLAT_HEIGHT - 3;
        const topStoneY = FLAT_HEIGHT - 4;
        const bedrockY = 0;
        
        for (let y = 0; y <= FLAT_HEIGHT; y++) {
            if (y === bedrockY) {
                this.precalculatedColumn[y] = BlockRegistry.BEDROCK.getId();
            } else if (y <= topStoneY) {
                this.precalculatedColumn[y] = BlockRegistry.STONE.getId();
            } else if (y < topGrassY) {
                this.precalculatedColumn[y] = BlockRegistry.DIRT.getId();
            } else if (y === topGrassY) {
                this.precalculatedColumn[y] = BlockRegistry.GRASS.getId();
            }
        }
    }
    
    newChunk(world, chunkX, chunkZ, ChunkClass) {
        this.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);

        let chunk = new ChunkClass(world, chunkX, chunkZ);
        let primer = new Primer(chunk);

        this.generateInChunk(chunkX, chunkZ, primer);

        chunk.generateSkylightMap();
        chunk.generateBlockLightMap();

        return chunk;
    }

    generateInChunk(chunkX, chunkZ, primer) {
        this.generateTerrain(chunkX, chunkZ, primer);
        this.naturalize(chunkX, chunkZ, primer);
    }

    // --- Population (No Structures) ---

    populateChunk(chunkX, chunkZ) {
        this.setChunkSeed(chunkX, chunkZ);
        return; 
    }

    // --- Optimized Flat Layered Terrain Generation ---

    generateTerrain(chunkX, chunkZ, primer) {
        // Use the instance property calculated in the constructor
        const columnData = this.precalculatedColumn; 
        const flatHeight = FlatWorldGenerator.FLAT_HEIGHT;
        const chunkSize = FlatWorldGenerator.CHUNK_SIZE;
        const WATER_ID = BlockRegistry.WATER.getId();
        
        for (let x = 0; x < chunkSize; x++) {
            for (let z = 0; z < chunkSize; z++) {
                for (let y = 0; y <= flatHeight; y++) {
                    const typeId = columnData[y];
                    if (typeId !== 0) {
                        primer.set(x, y, z, typeId);
                    }
                }
                for (let y = flatHeight + 1; y < this.seaLevel; y++) {
                     primer.set(x, y, z, WATER_ID);
                }
            }
        }
    }
    
    naturalize(chunkX, chunkZ, primer) {
        return;
    }
    
    generateTerrainNoise(noiseX, noiseY, noiseZ, width, height, depth) {
        return [];
    }

    setChunkSeed(chunkX, chunkZ) {
        this.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);
        return;
    }
    
}