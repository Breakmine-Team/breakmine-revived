import NoiseGeneratorOctaves from "./noise/NoiseGeneratorOctaves.js";
import Primer from "./Primer.js";
import CaveGenerator from "./structure/CaveGenerator.js";
import {BlockRegistry} from "../block/BlockRegistry.js";
import TreeGenerator from "./structure/TreeGenerator.js";
import BigTreeGenerator from "./structure/BigTreeGenerator.js";
import Generator from "./Generator.js";
import UndergroundHouseGenerator from "./structure/UndergroundHouseGenerator.js";

const AIR_ID = 0;

export default class WorldGenerator extends Generator {

    constructor(world, seed, worldType = "normal") {
        super(world, seed);

        this.amplified = worldType === "amplified";

        // Initialize block IDs safely inside constructor after registries are loaded
        this.STONE_ID = BlockRegistry.STONE.getId();
        this.WATER_ID = BlockRegistry.WATER.getId();
        this.GRASS_ID = BlockRegistry.GRASS.getId();
        this.DIRT_ID = BlockRegistry.DIRT.getId();
        this.BEDROCK_ID = BlockRegistry.BEDROCK.getId();
        this.SAND_ID = BlockRegistry.SAND.getId();
        this.CLAY_ID = BlockRegistry.CLAY.getId();
        this.GRAVEL_ID = BlockRegistry.GRAVEL.getId();
        this.COAL_ORE_ID = BlockRegistry.COAL_ORE.getId();
        this.IRON_ORE_ID = BlockRegistry.IRON_ORE.getId();
        this.GOLD_ORE_ID = BlockRegistry.GOLD_ORE.getId();
        this.DIAMOND_ORE_ID = BlockRegistry.DIAMOND_ORE.getId();
        this.EMERALD_ORE_ID = BlockRegistry.EMERALD_ORE.getId();
        this.SAPPHIRE_ORE_ID = BlockRegistry.SAPPHIRE_ORE.getId();
        this.BLUESTONE_ORE_ID = BlockRegistry.BLUESTONE_ORE.getId();

        this.COMMON_FLOWER_IDS = [
            BlockRegistry.FLOWER_ROSE.getId(),
            BlockRegistry.FLOWER_DANDELION.getId(),
            BlockRegistry.FLOWER_RED_TULIP.getId(),
            BlockRegistry.FLOWER_ORANGE_TULIP.getId(),
            BlockRegistry.FLOWER_WHITE_TULIP.getId(),
            BlockRegistry.FLOWER_PINK_TULIP.getId(),
        ];
        this.RARE_FLOWER_IDS = [
            BlockRegistry.FLOWER_BLUE_ORCHID.getId(),
            BlockRegistry.FLOWER_ALLIUM.getId(),
            BlockRegistry.FLOWER_AZURE_BLUET.getId(),
            BlockRegistry.FLOWER_OXEYE_DAISY.getId(),
            BlockRegistry.FLOWER_CORNFLOWER.getId(),
            BlockRegistry.FLOWER_WITHER_ROSE.getId(),
        ];
        this.GRASS_PLANT_ID = BlockRegistry.GRASS_PLANT.getId();
        this.LOG_ID = BlockRegistry.LOG.getId();
        this.LEAVE_ID = BlockRegistry.LEAVE.getId();

        this.caveGenerator = new CaveGenerator(world, seed);

        this.terrainGenerator4 = new NoiseGeneratorOctaves(this.random, 16);
        this.terrainGenerator5 = new NoiseGeneratorOctaves(this.random, 16);
        this.terrainGenerator3 = new NoiseGeneratorOctaves(this.random, 8);

        this.natureGenerator1 = new NoiseGeneratorOctaves(this.random, 4);
        this.natureGenerator2 = new NoiseGeneratorOctaves(this.random, 4);

        this.terrainGenerator1 = new NoiseGeneratorOctaves(this.random, 10);
        this.terrainGenerator2 = new NoiseGeneratorOctaves(this.random, 16);

        this.populationNoiseGenerator = new NoiseGeneratorOctaves(this.random, 8);

        this.seaLevel = 120;
    }

    newChunk(world, chunkX, chunkZ, ChunkClass) {
        this.random.setSeed(chunkX * 0x4f9939f508 + chunkZ * 0x1ef1565bd5);

        let chunk = new ChunkClass(world, chunkX, chunkZ);
        let primer = new Primer(chunk);

        this.generateInChunk(chunkX, chunkZ, primer);

        // Init skylight
        chunk.generateSkylightMap();
        chunk.generateBlockLightMap();

        return chunk;
    }

    generateInChunk(chunkX, chunkZ, primer) {
        this.generateTerrain(chunkX, chunkZ, primer);
        this.naturalize(chunkX, chunkZ, primer);

        this.caveGenerator.generateInChunk(chunkX, chunkZ, primer);
        this.generateOres(chunkX, chunkZ, primer);
    }

    populateChunk(chunkX, chunkZ) {
        // Set seed for chunk
        this.setChunkSeed(chunkX, chunkZ);

        // Access noise data for population
        let absoluteX = chunkX * 16;
        let absoluteZ = chunkZ * 16;
        let amount = Math.floor((this.populationNoiseGenerator.perlin(absoluteX * 0.5, absoluteZ * 0.5) / 8 + this.random.nextDouble() * 4 + 4) / 3);
        if (amount < 0) {
            amount = 0;
        }
        if (this.random.nextInt(10) === 0) {
            amount++;
        }

        // Tree generator
        let bigTree = this.random.nextInt(10) === 0;
        let treeSeed = this.random.seed;
        let treeGenerator = bigTree ? new BigTreeGenerator(this.world, treeSeed) : new TreeGenerator(this.world, treeSeed);

        // Plant the trees in the chunk
        for (let i = 0; i < amount; i++) {
            let totalX = absoluteX + this.random.nextInt(16) + 8;
            let totalZ = absoluteZ + this.random.nextInt(16) + 8;
            let totalY = this.world.getHeightAt(totalX, totalZ);

            // Generate tree at position
            treeGenerator.generateAtBlock(totalX, totalY, totalZ);
        }

        let houseGenerator = new UndergroundHouseGenerator(this.world, this.random.seed);
        const UNDERGROUND_Y = 40; 
        const RARE_CHANCE_FACTOR = 30;

        if (this.random.nextInt(RARE_CHANCE_FACTOR) === 0) {
            let houseAttempts = 1; 
            for (let i = 0; i < houseAttempts; i++) {
                let totalX = absoluteX + this.random.nextInt(16) + 8;
                let totalZ = absoluteZ + this.random.nextInt(16) + 8;
                let totalY = UNDERGROUND_Y; 

                if (this.world.getBlockAt(totalX, totalY, totalZ) === 0) continue;
                
                let typeIdBelow = this.world.getBlockAt(totalX, totalY, totalZ);
                if (typeIdBelow !== this.STONE_ID) continue;

                houseGenerator.generateAtBlock(totalX, totalY, totalZ);
            }
        }

        // Flowers & grass plants: generate in distinct patches
        // Flower patches are larger and more concentrated
        let flowerPatches = this.random.nextInt(2); // 0-1 patches instead of 1-2
        for (let i = 0; i < flowerPatches; i++) {
            let patchX = absoluteX + this.random.nextInt(16);
            let patchZ = absoluteZ + this.random.nextInt(16);
            let patchCount = 3 + this.random.nextInt(5); // Reduced from 5-8 to 3-7

            // Determine patch type: single-type (70%) or double-type (30%)
            let isDoubleType = this.random.nextInt(10) < 3;
            
            // Select flower type(s) for this patch
            let flowerType1, flowerType2;
            if (this.random.nextInt(4) < 3) {
                // 75% chance for common flower
                flowerType1 = this.COMMON_FLOWER_IDS[this.random.nextInt(this.COMMON_FLOWER_IDS.length)];
            } else {
                // 25% chance for rare flower
                flowerType1 = this.RARE_FLOWER_IDS[this.random.nextInt(this.RARE_FLOWER_IDS.length)];
            }
            
            if (isDoubleType) {
                if (this.random.nextInt(4) < 3) {
                    flowerType2 = this.COMMON_FLOWER_IDS[this.random.nextInt(this.COMMON_FLOWER_IDS.length)];
                } else {
                    flowerType2 = this.RARE_FLOWER_IDS[this.random.nextInt(this.RARE_FLOWER_IDS.length)];
                }
            }

            for (let j = 0; j < patchCount; j++) {
                let plantX = patchX + this.random.nextInt(7) - 3;
                let plantZ = patchZ + this.random.nextInt(7) - 3;
                let plantY = this.world.getHeightAt(plantX, plantZ);

                if (plantY <= 0 || plantY >= 256) continue;
                if (this.world.getBlockAt(plantX, plantY - 1, plantZ) !== this.GRASS_ID) continue;
                // Prevent generating inside tree blocks
                if (this.world.getBlockAt(plantX, plantY, plantZ) !== 0) continue;

                let plantId;
                if (isDoubleType && this.random.nextInt(2) === 0) {
                    plantId = flowerType2;
                } else {
                    plantId = flowerType1;
                }

                // Withered roses only generate near stone
                let witherRoseId = BlockRegistry.FLOWER_WITHER_ROSE.getId();
                if (plantId === witherRoseId) {
                    // Check for stone nearby
                    let hasNearbyStone = false;
                    for (let dx = -2; dx <= 2; dx++) {
                        for (let dz = -2; dz <= 2; dz++) {
                            for (let dy = -2; dy <= 1; dy++) {
                                let checkX = plantX + dx;
                                let checkY = plantY + dy;
                                let checkZ = plantZ + dz;
                                if (this.world.getBlockAt(checkX, checkY, checkZ) === this.STONE_ID) {
                                    hasNearbyStone = true;
                                    break;
                                }
                            }
                            if (hasNearbyStone) break;
                        }
                        if (hasNearbyStone) break;
                    }
                    if (!hasNearbyStone) {
                        // Try the other flower type if available
                        if (isDoubleType) {
                            plantId = (plantId === flowerType1) ? flowerType2 : flowerType1;
                            // Re-check if the alternate is also wither rose
                            if (plantId === witherRoseId) continue;
                        } else {
                            continue; // Skip withered rose if no stone nearby
                        }
                    }
                }

                this.world.setBlockAt(plantX, plantY, plantZ, plantId);
            }
        }

        // Grass patches are separate and more scattered
        let grassPatches = 2 + this.random.nextInt(3);
        for (let i = 0; i < grassPatches; i++) {
            let patchX = absoluteX + this.random.nextInt(16);
            let patchZ = absoluteZ + this.random.nextInt(16);
            let patchCount = 3 + this.random.nextInt(5);

            for (let j = 0; j < patchCount; j++) {
                let plantX = patchX + this.random.nextInt(5) - 2;
                let plantZ = patchZ + this.random.nextInt(5) - 2;
                let plantY = this.world.getHeightAt(plantX, plantZ);

                if (plantY <= 0 || plantY >= 256) continue;
                if (this.world.getBlockAt(plantX, plantY - 1, plantZ) !== this.GRASS_ID) continue;
                if (this.world.getBlockAt(plantX, plantY, plantZ) !== 0) continue;

                this.world.setBlockAt(plantX, plantY, plantZ, this.GRASS_PLANT_ID);
            }
        }

        // Clay patches: small underwater deposits, up to 10 clay per patch
        let clayPatches = 1 + this.random.nextInt(2);
        for (let i = 0; i < clayPatches; i++) {
            let patchX = absoluteX + this.random.nextInt(16);
            let patchZ = absoluteZ + this.random.nextInt(16);

            // Find the sea floor (solid block under water)
            let floorY = -1;
            for (let y = this.seaLevel; y > 0; y--) {
                if (this.world.getBlockAt(patchX, y, patchZ) === this.WATER_ID) {
                    for (let fy = y - 1; fy > 0; fy--) {
                        let belowId = this.world.getBlockAt(patchX, fy, patchZ);
                        if (belowId !== this.WATER_ID && belowId !== AIR_ID) {
                            floorY = fy;
                            break;
                        }
                    }
                    break;
                }
            }
            if (floorY <= 0) continue;

            let clayCount = 1 + this.random.nextInt(10);
            for (let j = 0; j < clayCount; j++) {
                let clayX = patchX + this.random.nextInt(3) - 1;
                let clayZ = patchZ + this.random.nextInt(3) - 1;
                let clayY = floorY + this.random.nextInt(2);

                if (clayY <= 0 || clayY >= 256) continue;
                let currentId = this.world.getBlockAt(clayX, clayY, clayZ);
                if (currentId !== this.SAND_ID && currentId !== this.DIRT_ID && currentId !== this.GRAVEL_ID) continue;
                // Only replace blocks still underwater
                if (this.world.getBlockAt(clayX, clayY + 1, clayZ) !== this.WATER_ID) continue;

                this.world.setBlockAt(clayX, clayY, clayZ, this.CLAY_ID);
            }
        }
    }

    generateOres(chunkX, chunkZ, primer) {
        this.setChunkSeed(chunkX, chunkZ);

        this.generateOreVein(primer, this.COAL_ORE_ID, 20, 0, 256, 64);
        this.generateOreVein(primer, this.IRON_ORE_ID, 20, 0, 153, 24);
        this.generateOreVein(primer, this.GOLD_ORE_ID, 10, 0, 32, 8);
        this.generateOreVein(primer, this.DIAMOND_ORE_ID, 8, 0, 16, 3);
        this.generateOreVein(primer, this.EMERALD_ORE_ID, 6, 156, 256, 2);
        this.generateOreVein(primer, this.SAPPHIRE_ORE_ID, 4, 0, 32, 2);
        this.generateOreVein(primer, this.BLUESTONE_ORE_ID, 20, 0, 153, 24);
    }

    generateOreVein(primer, oreId, veinSize, minY, maxY, attempts) {
        const heightRange = maxY - minY;
        for (let i = 0; i < attempts; i++) {
            let x = this.random.nextInt(16);
            let y = this.random.nextInt(heightRange) + minY;
            let z = this.random.nextInt(16);

            this.generateVein(primer, oreId, x, y, z, veinSize);
        }
    }

    generateVein(primer, oreId, x, y, z, veinSize) {
        let float1 = this.random.nextFloat() * Math.PI;
        let d = (x + 0.5) - Math.sin(float1) * veinSize / 8.0;
        let d1 = (y + 0.5) + (this.random.nextFloat() * veinSize / 4.0);
        let d2 = (z + 0.5) + Math.cos(float1) * veinSize / 8.0;
        let d3 = x + 0.5 + Math.sin(float1) * veinSize / 8.0;
        let d4 = (y + 0.5) + (this.random.nextFloat() * veinSize / 4.0);
        let d5 = (z + 0.5) - Math.cos(float1) * veinSize / 8.0;

        for (let i = 0; i < veinSize; i++) {
            let f = i / veinSize;
            let f1 = this.random.nextFloat() * 0.2;
            let f2 = this.random.nextFloat() * 0.2;
            let f3 = this.random.nextFloat() * 0.2;

            let d6 = d * (1.0 - f) + d3 * f + (this.random.nextDouble() - 0.5) * 0.5;
            let d7 = d1 * (1.0 - f) + d4 * f + (this.random.nextDouble() - 0.5) * 0.5;
            let d8 = d2 * (1.0 - f) + d5 * f + (this.random.nextDouble() - 0.5) * 0.5;

            let l = Math.floor(d6 + f1);
            let i1 = Math.floor(d7 + f2);
            let j1 = Math.floor(d8 + f3);

            if (l >= 0 && l < 16 && i1 >= 0 && i1 < 256 && j1 >= 0 && j1 < 16) {
                if (primer.get(l, i1, j1) === this.STONE_ID) {
                    primer.set(l, i1, j1, oreId);
                }
            }
        }
    }

    generateTerrain(chunkX, chunkZ, primer) {
        const range = 4;
        const sizeX = 5;
        const sizeZ = 33;
        const factor = 0.25;
        const sec = 0.125;
        const seaLevel = this.seaLevel;

        let noise = this.generateTerrainNoise(chunkX * range, 0, chunkZ * range, sizeX, sizeZ, sizeX);
        let isSnowBiome = false;

        for (let indexX = 0; indexX < range; indexX++) {
            const baseX = indexX * 4;
            const xOffset1 = indexX * sizeX;
            const xOffset2 = (indexX + 1) * sizeX;

            for (let indexZ = 0; indexZ < range; indexZ++) {
                const baseZ = indexZ * 4;
                const idx1Base = (xOffset1 + indexZ) * sizeZ;
                const idx2Base = (xOffset1 + indexZ + 1) * sizeZ;
                const idx3Base = (xOffset2 + indexZ) * sizeZ;
                const idx4Base = (xOffset2 + indexZ + 1) * sizeZ;

                for (let indexY = 0; indexY < 32; indexY++) {
                    const idx1 = idx1Base + indexY;
                    const idx2 = idx2Base + indexY;
                    const idx3 = idx3Base + indexY;
                    const idx4 = idx4Base + indexY;

                    let noise1 = noise[idx1];
                    let noise2 = noise[idx2];
                    let noise3 = noise[idx3];
                    let noise4 = noise[idx4];

                    let mut1 = (noise[idx1 + 1] - noise1) * sec;
                    let mut2 = (noise[idx2 + 1] - noise2) * sec;
                    let mut3 = (noise[idx3 + 1] - noise3) * sec;
                    let mut4 = (noise[idx4 + 1] - noise4) * sec;

                    const baseY = indexY * 8;

                    for (let y = 0; y < 8; y++) {
                        const worldY = baseY + y;
                        let stoneNoiseAtY1 = noise1;
                        let stoneNoiseAtY2 = noise2;

                        let diffNoiseY1 = (noise3 - noise1) * factor;
                        let diffNoiseY2 = (noise4 - noise2) * factor;

                        for (let x = 0; x < 4; x++) {
                            const blockX = baseX + x;
                            let stoneNoise = stoneNoiseAtY1;
                            let diffNoiseX = (stoneNoiseAtY2 - stoneNoiseAtY1) * factor;

                            for (let z = 0; z < 4; z++) {
                                let typeId = AIR_ID;

                                if (worldY < seaLevel) {
                                    typeId = (isSnowBiome && worldY >= seaLevel - 1) ? this.WATER_ID : this.WATER_ID;
                                }

                                if (stoneNoise > 0.0) {
                                    typeId = this.STONE_ID;
                                }

                                if (typeId !== AIR_ID) {
                                    primer.set(blockX, worldY, baseZ + z, typeId);
                                }
                                stoneNoise += diffNoiseX;
                            }

                            stoneNoiseAtY1 += diffNoiseY1;
                            stoneNoiseAtY2 += diffNoiseY2;
                        }

                        noise1 += mut1;
                        noise2 += mut2;
                        noise3 += mut3;
                        noise4 += mut4;
                    }
                }
            }
        }
    }

    naturalize(chunkX, chunkZ, primer) {
        const strength = 0.03125; // 1 / 32
        const chunkSize = Generator.CHUNK_SIZE;
        const seaLevel = this.seaLevel;

        let natureNoise1 = this.natureGenerator1.generateNoiseOctaves(
            chunkX * chunkSize, chunkZ * chunkSize,
            0.0, chunkSize, chunkSize, 1,
            strength, strength, 1.0
        );
        let natureNoise2 = this.natureGenerator1.generateNoiseOctaves(
            chunkZ * chunkSize, 109.0134, chunkX * chunkSize,
            chunkSize, 1, chunkSize,
            strength, 1.0, strength
        );
        let natureNoise3 = this.natureGenerator2.generateNoiseOctaves(
            chunkX * chunkSize, chunkZ * chunkSize, 0.0,
            chunkSize, chunkSize, 1,
            strength * 2, strength * 2, strength * 2
        );

        for (let x = 0; x < 16; x++) {
            for (let z = 0; z < 16; z++) {
                const xzIdx = x + (z << 4);
                let sandPatchNoise = natureNoise1[xzIdx] + this.random.nextFloat() * 0.2 > 0;
                let gravelPatchNoise = natureNoise2[xzIdx] + this.random.nextFloat() * 0.2 > 3;
                let stonePatchNoise = (natureNoise3[xzIdx] / 3 + 3 + this.random.nextFloat() * 0.25);

                let prevStonePatchNoise = -1;
                let topLayerTypeId = this.GRASS_ID;
                let innerLayerTypeId = this.DIRT_ID;

                // For y in [5,255] the bedrock threshold (nextInt(6)-1, max 4) can never
                // match, so those 251 nextInt(6) calls only advance the RNG. Advance the
                // LCG in closed form instead of burning 251 draws per column.
                this.random.skip(251);

                for (let y = 255; y >= 0; y--) {
                    // Execute PRNG in exact sequence to preserve seed alignment
                    let bedrockThreshold = -1;
                    if (y < 5) {
                        bedrockThreshold = (this.random.nextInt(6)) - 1;
                        if (y <= bedrockThreshold || y === 0) {
                            primer.set(x, y, z, this.BEDROCK_ID);
                            continue;
                        }
                    }

                    let typeIdAt = primer.get(x, y, z);

                    if (typeIdAt === AIR_ID) {
                        prevStonePatchNoise = -1;
                        continue;
                    }

                    if (typeIdAt !== this.STONE_ID) {
                        continue;
                    }

                    if (prevStonePatchNoise === -1) {
                        if (stonePatchNoise <= 0) {
                            topLayerTypeId = AIR_ID;
                            innerLayerTypeId = this.STONE_ID;
                        } else if (y >= seaLevel - 4 && y <= seaLevel + 1) {
                            topLayerTypeId = this.GRASS_ID;
                            innerLayerTypeId = this.DIRT_ID;

                            if (gravelPatchNoise) {
                                topLayerTypeId = AIR_ID;
                                innerLayerTypeId = this.GRAVEL_ID;
                            }

                            if (sandPatchNoise) {
                                topLayerTypeId = this.SAND_ID;
                                innerLayerTypeId = this.SAND_ID;
                            }
                        }

                        if (y < seaLevel && topLayerTypeId === AIR_ID) {
                            topLayerTypeId = this.WATER_ID;
                        }

                        prevStonePatchNoise = stonePatchNoise;

                        if (y >= seaLevel - 1) {
                            primer.set(x, y, z, topLayerTypeId);
                        } else {
                            primer.set(x, y, z, innerLayerTypeId);
                        }
                        continue;
                    }

                    if (prevStonePatchNoise > 0) {
                        prevStonePatchNoise--;
                        primer.set(x, y, z, innerLayerTypeId);
                    }
                }
            }
        }
    }

    generateTerrainNoise(noiseX, noiseY, noiseZ, width, height, depth) {
        const strength = 684.412;

        let terrainNoise1 = this.terrainGenerator1.generateNoiseOctaves(noiseX, noiseY, noiseZ, width, 1, depth, 1.0, 0.0, 1.0);
        let terrainNoise2 = this.terrainGenerator2.generateNoiseOctaves(noiseX, noiseY, noiseZ, width, 1, depth, 100, 0.0, 100);
        let terrainNoise3 = this.terrainGenerator3.generateNoiseOctaves(noiseX, noiseY, noiseZ, width, height, depth, strength / 80, strength / 160, strength / 80);
        let terrainNoise4 = this.terrainGenerator4.generateNoiseOctaves(noiseX, noiseY, noiseZ, width, height, depth, strength, strength, strength);
        let terrainNoise5 = this.terrainGenerator5.generateNoiseOctaves(noiseX, noiseY, noiseZ, width, height, depth, strength, strength, strength);

        let output = new Float64Array(width * height * depth);

        let index = 0;
        let id = 0;

        for (let x = 0; x < width; x++) {
            for (let z = 0; z < depth; z++) {
                let out1 = (terrainNoise1[id] + 256) / 512;
                if (out1 > 1.0) {
                    out1 = 1.0;
                }

                let maxY = 0.0;
                let out2 = terrainNoise2[id] / 8000;

                if (out2 < 0.0) {
                    out2 = -out2;
                }

                out2 = out2 * 3 - 3;

                if (out2 < 0.0) {
                    out2 /= 2;

                    if (out2 < -1) {
                        out2 = -1;
                    }

                    out2 /= 1.4;
                    out2 /= 2;
                    out1 = 0.0;
                } else {
                    if (out2 > 1.0) {
                        out2 = 1.0;
                    }
                    out2 /= 6;
                }

                out1 += 0.5;

                if (this.amplified) {
                    out1 = Math.max(out1 / 3.0, 0.01);
                }

                out2 = (out2 * height) / 16;
                id++;

                let h = height / 2 + out2 * 4;

                for (let y = 0; y < height; y++) {
                    let noise = 0;
                    let value = ((y - h) * 12) / out1;

                    if (value < 0.0) {
                        value *= 4;
                    }

                    let out4 = terrainNoise4[index] / 512;
                    let out5 = terrainNoise5[index] / 512;
                    let out3 = (terrainNoise3[index] / 10 + 1.0) / 2;

                    if (out3 < 0.0) {
                        noise = out4;
                    } else if (out3 > 1.0) {
                        noise = out5;
                    } else {
                        noise = out4 + (out5 - out4) * out3;
                    }

                    noise -= value;

                    if (y > height - 4) {
                        let diff = (y - (height - 4)) / 3;
                        noise = noise * (1.0 - diff) + -10 * diff;
                    }

                    if (y < maxY) {
                        let diff = (maxY - y) / 4;

                        if (diff < 0.0) {
                            diff = 0.0;
                        }

                        if (diff > 1.0) {
                            diff = 1.0;
                        }
                        noise = noise * (1.0 - diff) + -10 * diff;
                    }

                    output[index] = noise;
                    index++;
                }
            }
        }

        return output;
    }
}