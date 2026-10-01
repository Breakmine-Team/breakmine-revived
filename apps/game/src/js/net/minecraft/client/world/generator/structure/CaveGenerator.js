import Random from "../../../../util/Random.js";
import {BlockRegistry} from "../../block/BlockRegistry.js";
import Generator from "../Generator.js";

export default class CaveGenerator extends Generator {

    constructor(world, seed) {
        super(world, seed);

        this.chunkRange = 8;
        this.STONE_ID = BlockRegistry.STONE.getId();
        this.DIRT_ID = BlockRegistry.DIRT.getId();
        this.GRASS_ID = BlockRegistry.GRASS.getId();
        this.WATER_ID = BlockRegistry.WATER.getId();
        this.LAVA_ID = BlockRegistry.LAVA.getId();
        this.SLIME_ID = BlockRegistry.SLIME.getId();
    }

    generateInChunk(originChunkX, originChunkZ, primer) {
        let offset = this.chunkRange;
        let {seedX, seedZ} = this.generateSeedOffset();

        // Generate entire cave over 16x16 chunk area
        for (let chunkX = originChunkX - offset; chunkX <= originChunkX + offset; chunkX++) {
            for (let chunkZ = originChunkZ - offset; chunkZ <= originChunkZ + offset; chunkZ++) {
                // Set seed for position
                this.setSeedOffset(chunkX, chunkZ, seedX, seedZ);

                // Generate entire cave
                this.generateCave(chunkX, chunkZ, originChunkX, originChunkZ, primer);
            }
        }

        this.generateSlimeBlocks(originChunkX, originChunkZ, primer);
    }

    generateSlimeBlocks(chunkX, chunkZ, primer) {
        this.setChunkSeed(chunkX, chunkZ);

        const attempts = 48 + this.random.nextInt(48);
        for (let i = 0; i < attempts; i++) {
            let x = this.random.nextInt(16);
            let y = 8 + this.random.nextInt(200);
            let z = this.random.nextInt(16);

            // Only replace stone
            if (primer.get(x, y, z) === this.STONE_ID) {
                primer.set(x, y, z, this.SLIME_ID);
            }
        }
    }

    generateCave(chunkX, chunkZ, originChunkX, originChunkZ, primer) {
        let num = this.random.nextInt(this.random.nextInt(this.random.nextInt(40) + 1) + 1);
        if (this.random.nextInt(15) !== 0) {
            num = 0;
        }

        // Generate multiple caves in the given area
        for (let i = 0; i < num; i++) {
            let x = chunkX * 16 + this.random.nextInt(16);
            let y = this.random.nextInt(this.random.nextInt(240) + 8);
            let z = chunkZ * 16 + this.random.nextInt(16);

            let amount = 1;

            if (this.random.nextInt(4) === 0) {
                this.generateBasicCaveAtBlock(originChunkX, originChunkZ, primer, x, y, z);
                amount += this.random.nextInt(4);
            }

            if (this.random.nextInt(5) === 0) {
                this.generateBlobCaveAtBlock(originChunkX, originChunkZ, primer, x, y, z);
            }

            for (let j = 0; j < amount; j++) {
                let rotation1 = this.random.nextFloat() * Math.PI * 2.0;
                let rotation2 = ((this.random.nextFloat() - 0.5) * 2.0) / 8;
                let amplitude = this.random.nextFloat() * 2.0 + this.random.nextFloat();
                this.generateCaveAtBlock(originChunkX, originChunkZ, primer, x, y, z, amplitude, rotation1, rotation2, 0, 0, 1.0);
            }
        }
    }

    generateBasicCaveAtBlock(originChunkX, originChunkZ, primer, x, y, z) {
        this.generateCaveAtBlock(originChunkX, originChunkZ, primer,
            x, y, z,
            1.0 + this.random.nextFloat() * 6,
            0.0, 0.0,
            -1, -1, 0.5
        );
    }

    generateBlobCaveAtBlock(originChunkX, originChunkZ, primer, x, y, z) {
        let radius = 3.0 + this.random.nextFloat() * 4.0;
        this.generateCaveAtBlock(
            originChunkX, originChunkZ, primer,
            x, y, z,
            radius,
            0.0, 0.0,
            -1, -1, 1.2
        );
    }

    generateCaveAtBlock(originChunkX, originChunkZ, primer, absoluteX, absoluteY, absoluteZ, amplitude, rotation1, rotation2, progress, distance, strength) {
        let centerX = originChunkX * 16 + 8;
        let centerZ = originChunkZ * 16 + 8;

        let motion2 = 0;
        let motion1 = 0;

        let random = new Random(this.random.nextLong());
        if (distance <= 0) {
            let range = this.chunkRange * 16 - 16;
            distance = range - random.nextInt(Math.floor(range / 4));
        }

        let isBeginning = false;
        if (progress === -1) {
            progress = Math.floor(distance / 2);
            isBeginning = true;
        }

        let maxProgress = random.nextInt(Math.floor(distance / 2)) + Math.floor(distance / 4);
        let isStrong = random.nextInt(6) === 0;

        for (; progress < distance; progress++) {
            let value = 1.5 + (Math.sin((progress * Math.PI) / distance) * amplitude);
            let valueWithStrength = value * strength;

            let cos = Math.cos(rotation2);
            let sin = Math.sin(rotation2);

            absoluteX += Math.cos(rotation1) * cos;
            absoluteY += sin;
            absoluteZ += Math.sin(rotation1) * cos;

            if (isStrong) {
                rotation2 *= 0.92;
            } else {
                rotation2 *= 0.7;
            }

            rotation2 += motion1 * 0.1;
            rotation1 += motion2 * 0.1;

            motion1 *= 0.9;
            motion2 *= 0.75;

            motion1 += (random.nextFloat() - random.nextFloat()) * random.nextFloat() * 2.0;
            motion2 += (random.nextFloat() - random.nextFloat()) * random.nextFloat() * 4;

            if (!isBeginning && progress === maxProgress && amplitude > 1.0) {
                this.generateCaveAtBlock(
                    originChunkX, originChunkZ, primer,
                    absoluteX, absoluteY, absoluteZ,
                    random.nextFloat() * 0.5 + 0.5, rotation1 - 1.570796, rotation2 / 3, progress, distance, 1.0
                );
                this.generateCaveAtBlock(
                    originChunkX, originChunkZ, primer,
                    absoluteX, absoluteY, absoluteZ,
                    random.nextFloat() * 0.5 + 0.5, rotation1 + 1.570796, rotation2 / 3, progress, distance, 1.0
                );

                if (random.nextInt(4) === 0) {
                    this.generateBlobCaveAtBlock(originChunkX, originChunkZ, primer, absoluteX, absoluteY, absoluteZ);
                }

                return;
            }

            if (!isBeginning && random.nextInt(4) === 0) {
                continue;
            }

            let distanceToCenterX = absoluteX - centerX;
            let distanceToCenterY = absoluteZ - centerZ;

            let progressInvert = distance - progress;
            let shiftedAmplitude = amplitude + 2.0 + 16;

            if ((distanceToCenterX * distanceToCenterX + distanceToCenterY * distanceToCenterY)
                - progressInvert * progressInvert > shiftedAmplitude * shiftedAmplitude) {
                return;
            }

            if (absoluteX < centerX - 16 - value * 2
                || absoluteZ < centerZ - 16 - value * 2
                || absoluteX > centerX + 16 + value * 2
                || absoluteZ > centerZ + 16 + value * 2) {
                continue;
            }

            distanceToCenterX = (absoluteX - value | 0) - originChunkX * 16 - 1;
            let layerX = ((absoluteX + value | 0) - originChunkX * 16) + 1;

            distanceToCenterY = (absoluteY - valueWithStrength | 0) - 1;
            let layerY = (absoluteY + valueWithStrength | 0) + 1;

            progressInvert = (absoluteZ - value | 0) - originChunkZ * 16 - 1;
            let layerZ = ((absoluteZ + value | 0) - originChunkZ * 16) + 1;

            distanceToCenterX = Math.max(distanceToCenterX, 0);
            layerX = Math.min(layerX, 16);
            distanceToCenterY = Math.max(distanceToCenterY, 1);
            layerY = Math.min(layerY, 248);
            progressInvert = Math.max(progressInvert, 0);
            layerZ = Math.min(layerZ, 16);

            // Skip if bounding box doesn't intersect the chunk
            if (distanceToCenterX >= layerX || progressInvert >= layerZ || distanceToCenterY >= layerY) {
                continue;
            }

            let isWaterCave = false;

            // Check for water
            for (let x = distanceToCenterX; !isWaterCave && x < layerX; x++) {
                for (let z = progressInvert; !isWaterCave && z < layerZ; z++) {
                    for (let y = layerY + 1; !isWaterCave && y >= distanceToCenterY - 1; y--) {
                        if (y < 0 || y >= 256) {
                            continue;
                        }

                        let typeId = primer.get(x, y, z);

                        if (typeId === this.WATER_ID) {
                            isWaterCave = true;
                        }

                        if (y !== distanceToCenterY - 1 && x !== distanceToCenterX && x !== layerX - 1 && z !== progressInvert && z !== layerZ - 1) {
                            y = distanceToCenterY;
                        }
                    }
                }
            }
            if (isWaterCave) {
                continue;
            }

            // For each block on layer x
            for (let x = distanceToCenterX; x < layerX; x++) {
                let offsetX = (((x + originChunkX * 16) + 0.5) - absoluteX) / value;

                // For each block on layer z
                for (let z = progressInvert; z < layerZ; z++) {
                    let offsetZ = (((z + originChunkZ * 16) + 0.5) - absoluteZ) / value;

                    let totalY = layerY;
                    let hasGrass = false;

                    // For each block on layer y
                    for (let y = layerY - 1; y >= distanceToCenterY; y--) {
                        let offsetY = ((y + 0.5) - absoluteY) / valueWithStrength;

                        // Check if the offset vector length is below 1
                        if (offsetY > -0.7 && offsetX * offsetX + offsetY * offsetY + offsetZ * offsetZ < 1.0) {
                            let typeId = primer.get(x, totalY, z)

                            // We found grass
                            if (typeId === this.GRASS_ID) {
                                hasGrass = true;
                            }

                            // Check if we can create a cave here
                            if (typeId === this.STONE_ID || typeId === this.DIRT_ID || typeId === this.GRASS_ID) {

                                if (y < 10) {
                                    // Lava cave
                                    primer.set(x, totalY, z, this.LAVA_ID);
                                } else {
                                    // Normal cave
                                    primer.set(x, totalY, z, 0);

                                    // Grow grass if we have dirt in here
                                    if (hasGrass && primer.get(x, totalY - 1, z) === this.DIRT_ID) {
                                        primer.set(x, totalY - 1, z, this.GRASS_ID);
                                    }
                                }
                            }
                        }

                        // Go further down
                        totalY--;
                    }
                }
            }

            if (isBeginning) {
                break;
            }
        }
    }

}