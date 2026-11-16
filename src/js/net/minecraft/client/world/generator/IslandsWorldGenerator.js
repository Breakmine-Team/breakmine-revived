import Primer from "./Primer.js";
import Generator from "./Generator.js";
import { BlockRegistry } from "../block/BlockRegistry.js";
import NoiseGeneratorPerlin from "./noise/NoiseGeneratorPerlin.js";
import TreeGenerator from "./structure/TreeGenerator.js";
import { BiomeRegistry } from "../biome/BiomeRegistry.js";

const AIR_ID = 0;

const ISLAND_MIN_Y = 24;
const ISLAND_MAX_Y = 140;

const SPAWN_TOP = 64;
const SPAWN_RADIUS = 14;

// Empty sky kept around the starting island so the spawn search cannot land on
// a neighbouring island.
const SPAWN_CLEARANCE = 30;

// Islands sit close enough together to hop or glide between them.
const ISLAND_NOISE_SCALE = 0.04;
const ISLAND_THRESHOLD = 0.05;

// A waterfall drops this far below the island it pours off.
const FALL_DEPTH = 28;
const RIM_DIRECTIONS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

// Overworld floating islands: thick pancake shaped islands of grass, dirt and
// stone drifting in an otherwise empty sky. The sky, weather and light are the
// ordinary overworld ones; only the terrain is gone.
export default class IslandsWorldGenerator extends Generator {

    static SPAWN_Y = SPAWN_TOP;
    static SPAWN_RADIUS = SPAWN_RADIUS;

    constructor(world, seed) {
        super(world, seed);

        this.STONE_ID = BlockRegistry.STONE.getId();
        this.DIRT_ID = BlockRegistry.DIRT.getId();
        this.GRASS_ID = BlockRegistry.GRASS.getId();
        this.GRASS_PLANT_ID = BlockRegistry.GRASS_PLANT.getId();
        this.WATER_ID = BlockRegistry.WATER.getId();
        this.COAL_ORE_ID = BlockRegistry.COAL_ORE.getId();
        this.IRON_ORE_ID = BlockRegistry.IRON_ORE.getId();
        this.GOLD_ORE_ID = BlockRegistry.GOLD_ORE.getId();
        this.DIAMOND_ORE_ID = BlockRegistry.DIAMOND_ORE.getId();
        this.FLOWER_IDS = [
            BlockRegistry.FLOWER_DANDELION.getId(),
            BlockRegistry.FLOWER_ROSE.getId(),
            BlockRegistry.FLOWER_RED_TULIP.getId(),
            BlockRegistry.FLOWER_ORANGE_TULIP.getId(),
            BlockRegistry.FLOWER_WHITE_TULIP.getId()
        ];

        this.maskGenerator = new NoiseGeneratorPerlin(this.random);
        this.detailGenerator = new NoiseGeneratorPerlin(this.random);
        this.topGenerator = new NoiseGeneratorPerlin(this.random);
        this.biomeGenerator = new NoiseGeneratorPerlin(this.random);
        this.streamGenerator = new NoiseGeneratorPerlin(this.random);

        this.seaLevel = SPAWN_TOP;
    }

    getBiomeAt(x, z) {
        return this.biomeGenerator.perlin(x * 0.008, z * 0.008) > 0.25
            ? BiomeRegistry.FOREST
            : BiomeRegistry.PLAINS;
    }

    newChunk(world, chunkX, chunkZ, ChunkClass) {
        this.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);

        let chunk = new ChunkClass(world, chunkX, chunkZ);
        let primer = new Primer(chunk);

        this.generateInChunk(chunkX, chunkZ, primer);
        this.generateBiomes(chunkX, chunkZ, chunk);

        chunk.generateSkylightMap();
        chunk.generateBlockLightMap();

        return chunk;
    }

    generateBiomes(chunkX, chunkZ, chunk) {
        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                const biome = this.getBiomeAt(chunkX * 16 + x, chunkZ * 16 + z);
                chunk.setBiomeAt(x, z, biome.id);
            }
        }
    }

    generateInChunk(chunkX, chunkZ, primer) {
        this.generateTerrain(chunkX, chunkZ, primer);
        this.generateOres(chunkX, chunkZ, primer);
        this.naturalize(chunkX, chunkZ, primer);
    }

    // The island the player starts on: a small flat grass pancake at the origin.
    // An air ring around it keeps neighbouring islands from touching it.
    spawnIsland(worldX, worldZ) {
        const distance = Math.sqrt(worldX * worldX + worldZ * worldZ);
        if (distance > SPAWN_RADIUS) {
            return distance < SPAWN_CLEARANCE ? AIR_ID : null;
        }

        const core = 1 - distance / SPAWN_RADIUS;
        return { top: SPAWN_TOP, thickness: Math.round(5 + core * 7) };
    }

    // Island top and thickness for a column, or null when the column is empty
    // sky. Islands are thick pancakes: a wide, almost flat top with near
    // vertical rims that taper to a thin edge.
    sampleColumn(worldX, worldZ) {
        const spawn = this.spawnIsland(worldX, worldZ);
        if (spawn === AIR_ID) return null;
        if (spawn !== null) return spawn;

        const islandness = this.maskGenerator.perlin(worldX * ISLAND_NOISE_SCALE, worldZ * ISLAND_NOISE_SCALE)
            + this.detailGenerator.perlin(worldX * ISLAND_NOISE_SCALE, worldZ * ISLAND_NOISE_SCALE) * 0.3;
        if (islandness <= ISLAND_THRESHOLD) return null;

        // Only drifting slowly across an island keeps the top surface flat.
        const top = Math.round(78 + this.topGenerator.perlin(worldX * 0.012, worldZ * 0.012) * 14);

        const core = Math.min(1, (islandness - ISLAND_THRESHOLD) * 1.6);
        const thickness = Math.round(8 + core * 24);

        return { top, thickness };
    }

    generateTerrain(chunkX, chunkZ, primer) {
        const tops = new Int16Array(256).fill(-1);
        const bottoms = new Int16Array(256).fill(-1);

        for (let x = 0; x < 16; x++) {
            const worldX = chunkX * 16 + x;

            for (let z = 0; z < 16; z++) {
                const column = this.sampleColumn(worldX, chunkZ * 16 + z);
                if (column === null) continue;

                const top = Math.min(column.top, ISLAND_MAX_Y);
                const bottom = Math.max(ISLAND_MIN_Y, top - column.thickness + 1);
                tops[x * 16 + z] = top;
                bottoms[x * 16 + z] = bottom;

                for (let y = bottom; y <= top; y++) {
                    const depth = top - y;

                    let typeId = this.STONE_ID;
                    if (depth === 0) {
                        typeId = this.GRASS_ID;
                    } else if (depth <= 3) {
                        typeId = this.DIRT_ID;
                    }

                    primer.set(x, y, z, typeId);
                }
            }
        }

        this.generateWaterfalls(chunkX, chunkZ, primer, tops, bottoms);
    }

    // Winding brooks on the island tops. Where a brook reaches the rim it pours
    // over the edge and falls into the void.
    generateWaterfalls(chunkX, chunkZ, primer, tops, bottoms) {
        for (let x = 0; x < 16; x++) {
            const worldX = chunkX * 16 + x;

            for (let z = 0; z < 16; z++) {
                const index = x * 16 + z;
                const top = tops[index];
                if (top < 0) continue;

                const worldZ = chunkZ * 16 + z;
                if (Math.sqrt(worldX * worldX + worldZ * worldZ) <= SPAWN_RADIUS + 2) continue;

                const stream = this.streamGenerator.perlin(worldX * 0.045, worldZ * 0.045);
                if (Math.abs(stream) > 0.015) continue;

                const bottom = bottoms[index];
                const atRim = RIM_DIRECTIONS.some(([dx, dz]) =>
                    this.sampleColumn(worldX + dx * 2, worldZ + dz * 2) === null);

                if (!atRim) {
                    primer.set(x, top, z, this.WATER_ID);
                    continue;
                }

                const fallEnd = Math.max(4, bottom - FALL_DEPTH);
                for (let y = fallEnd; y <= top; y++) {
                    primer.set(x, y, z, this.WATER_ID);
                }
            }
        }
    }

    generateOres(chunkX, chunkZ, primer) {
        this.setChunkSeed(chunkX, chunkZ);

        this.generateOreVein(primer, this.COAL_ORE_ID, 12, 20, ISLAND_MAX_Y, 12);
        this.generateOreVein(primer, this.IRON_ORE_ID, 9, 16, ISLAND_MAX_Y, 9);
        this.generateOreVein(primer, this.GOLD_ORE_ID, 6, 12, 60, 3);
        this.generateOreVein(primer, this.DIAMOND_ORE_ID, 5, 10, 40, 2);
    }

    generateOreVein(primer, oreId, veinSize, minY, maxY, attempts) {
        const heightRange = maxY - minY;

        for (let i = 0; i < attempts; i++) {
            const x = this.random.nextInt(16);
            const y = this.random.nextInt(heightRange) + minY;
            const z = this.random.nextInt(16);

            this.generateVein(primer, oreId, x, y, z, veinSize);
        }
    }

    generateVein(primer, oreId, x, y, z, veinSize) {
        const angle = this.random.nextFloat() * Math.PI;
        const startX = (x + 0.5) - Math.sin(angle) * veinSize / 8.0;
        const startY = (y + 0.5) + (this.random.nextFloat() * veinSize / 4.0);
        const startZ = (z + 0.5) + Math.cos(angle) * veinSize / 8.0;
        const endX = x + 0.5 + Math.sin(angle) * veinSize / 8.0;
        const endY = (y + 0.5) + (this.random.nextFloat() * veinSize / 4.0);
        const endZ = z + 0.5 - Math.cos(angle) * veinSize / 8.0;

        for (let i = 0; i < veinSize; i++) {
            const t = i / veinSize;
            const px = Math.floor(startX * (1.0 - t) + endX * t + (this.random.nextDouble() - 0.5) * 0.5);
            const py = Math.floor(startY * (1.0 - t) + endY * t + (this.random.nextDouble() - 0.5) * 0.5);
            const pz = Math.floor(startZ * (1.0 - t) + endZ * t + (this.random.nextDouble() - 0.5) * 0.5);

            if (px < 0 || px > 15 || py < 0 || py > Generator.TOTAL_HEIGHT - 1 || pz < 0 || pz > 15) continue;

            if (primer.get(px, py, pz) === this.STONE_ID) {
                primer.set(px, py, pz, oreId);
            }
        }
    }

    // Grass and flowers on the island tops.
    naturalize(chunkX, chunkZ, primer) {
        this.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5 + 0x2545f491);

        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                let surface = -1;
                for (let y = ISLAND_MAX_Y; y > ISLAND_MIN_Y; y--) {
                    const typeId = primer.get(x, y, z);
                    if (typeId === AIR_ID) continue;

                    if (typeId === this.GRASS_ID) {
                        surface = y;
                    }
                    break;
                }

                // No plants in brooks or on the waterfall lips.
                if (surface < 0) continue;

                const roll = this.random.nextInt(14);
                if (roll > 1) continue;

                const plantId = roll === 0
                    ? this.GRASS_PLANT_ID
                    : this.FLOWER_IDS[this.random.nextInt(this.FLOWER_IDS.length)];

                primer.set(x, surface + 1, z, plantId);
            }
        }
    }

    // Oak trees, placed after the neighbouring chunks exist so they can cross
    // chunk borders.
    populateChunk(chunkX, chunkZ) {
        this.setChunkSeed(chunkX, chunkZ);

        const absoluteX = chunkX * 16;
        const absoluteZ = chunkZ * 16;
        const amount = 1 + this.random.nextInt(2);

        for (let i = 0; i < amount; i++) {
            const totalX = absoluteX + this.random.nextInt(16);
            const totalZ = absoluteZ + this.random.nextInt(16);
            const totalY = this.world.getHeightAt(totalX, totalZ);

            if (Math.hypot(totalX, totalZ) < SPAWN_RADIUS + 4) continue;
            if (totalY <= ISLAND_MIN_Y || totalY >= Generator.TOTAL_HEIGHT - 8) continue;
            if (this.world.getBlockAt(totalX, totalY - 1, totalZ) !== this.GRASS_ID) continue;
            if (this.world.getBlockAt(totalX, totalY, totalZ) !== AIR_ID) continue;

            const tree = new TreeGenerator(this.world, this.random.seed, "oak");
            tree.generateAtBlock(totalX, totalY, totalZ);
        }
    }
}
