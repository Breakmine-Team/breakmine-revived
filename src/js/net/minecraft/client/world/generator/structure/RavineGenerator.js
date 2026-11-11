import {BlockRegistry} from "../../block/BlockRegistry.js";
import Generator from "../Generator.js";

export default class RavineGenerator extends Generator {

    constructor(world, seed) {
        super(world, seed);

        // A ravine can start this many chunks away and still reach the origin.
        // The maximum path below stays inside this radius so chunks on both
        // sides of a border agree on which ravines exist.
        this.chunkRange = 5;
        this.ravineChance = 30;

        this.STONE_ID = BlockRegistry.STONE.getId();
        this.DIRT_ID = BlockRegistry.DIRT.getId();
        this.GRASS_ID = BlockRegistry.GRASS.getId();
        this.SAND_ID = BlockRegistry.SAND.getId();
        this.GRAVEL_ID = BlockRegistry.GRAVEL.getId();
        this.SNOW_ID = BlockRegistry.SNOW.getId();
        this.WATER_ID = BlockRegistry.WATER.getId();
        this.LAVA_ID = BlockRegistry.LAVA.getId();
        this.BEDROCK_ID = BlockRegistry.BEDROCK.getId();

        this.CARVE_IDS = new Set([
            this.STONE_ID,
            this.DIRT_ID,
            this.GRASS_ID,
            this.SAND_ID,
            this.GRAVEL_ID,
            this.SNOW_ID
        ]);

        // Ravine paths are shared by every chunk they touch. Caching the
        // simulated path avoids walking the same ravine dozens of times.
        this.ravineCache = new Map();
        this.ravineCacheLimit = 512;
    }

    generateInChunk(originChunkX, originChunkZ, primer) {
        const offset = this.chunkRange;
        const {seedX, seedZ} = this.generateSeedOffset();
        const heightCache = new Int16Array(256).fill(-1);

        for (let chunkX = originChunkX - offset; chunkX <= originChunkX + offset; chunkX++) {
            for (let chunkZ = originChunkZ - offset; chunkZ <= originChunkZ + offset; chunkZ++) {
                const ravine = this.getRavine(chunkX, chunkZ, seedX, seedZ);
                if (ravine !== null) {
                    this.carveRavine(ravine, originChunkX, originChunkZ, primer, heightCache);
                }
            }
        }
    }

    getRavine(chunkX, chunkZ, seedX, seedZ) {
        const key = chunkX + "," + chunkZ;
        const cached = this.ravineCache.get(key);
        if (cached !== undefined) {
            return cached;
        }

        this.setSeedOffset(chunkX, chunkZ, seedX, seedZ);
        if (this.random.nextInt(this.ravineChance) !== 0) {
            return null;
        }

        let x = chunkX * 16 + 8 + this.random.nextInt(8) - 4;
        let z = chunkZ * 16 + 8 + this.random.nextInt(8) - 4;
        let floorY = 62 + this.random.nextInt(36);
        let angle = this.random.nextFloat() * Math.PI * 2;
        let floorDrift = (this.random.nextFloat() - 0.5) * 0.5;

        const steps = 36 + this.random.nextInt(27);
        const stepLength = 1.0 + this.random.nextFloat() * 0.25;
        const radiusX = 2.0 + this.random.nextFloat() * 2.0;
        const radiusZ = 2.0 + this.random.nextFloat() * 2.0;
        const wallSlope = 2 + this.random.nextInt(4);
        const slices = [];

        for (let step = 0; step < steps; step++) {
            const progress = steps <= 1 ? 1 : step / (steps - 1);
            const taper = 0.3 + 0.7 * Math.sin(Math.PI * progress);

            slices.push({
                x,
                z,
                radiusX: radiusX * taper,
                radiusZ: radiusZ * taper,
                floorY
            });

            angle += (this.random.nextFloat() - 0.5) * 0.16;
            if (this.random.nextInt(12) === 0) {
                angle += (this.random.nextFloat() - 0.5) * 0.8;
            }

            x += Math.cos(angle) * stepLength;
            z += Math.sin(angle) * stepLength;

            floorDrift += (this.random.nextFloat() - 0.5) * 0.06;
            floorDrift *= 0.92;
            floorY += floorDrift;

            if (floorY < 40) {
                floorY = 40;
            } else if (floorY > 110) {
                floorY = 110;
            }
        }

        const ravine = {slices, wallSlope};
        this.ravineCache.set(key, ravine);
        if (this.ravineCache.size > this.ravineCacheLimit) {
            this.ravineCache.delete(this.ravineCache.keys().next().value);
        }

        return ravine;
    }

    carveRavine(ravine, originChunkX, originChunkZ, primer, heightCache) {
        const slices = ravine.slices;
        for (let i = 0; i < slices.length; i++) {
            const slice = slices[i];
            this.carveRavineSlice(
                primer, heightCache, originChunkX, originChunkZ,
                slice.x, slice.z, slice.radiusX, slice.radiusZ, slice.floorY, ravine.wallSlope
            );
        }
    }

    carveRavineSlice(primer, heightCache, originChunkX, originChunkZ, centerX, centerZ, radiusX, radiusZ, floorY, wallSlope) {
        if (radiusX < 0.5 || radiusZ < 0.5) {
            return;
        }

        const originX = originChunkX * 16;
        const originZ = originChunkZ * 16;
        const minX = Math.max(originX, Math.floor(centerX - radiusX));
        const maxX = Math.min(originX + 15, Math.floor(centerX + radiusX));
        const minZ = Math.max(originZ, Math.floor(centerZ - radiusZ));
        const maxZ = Math.min(originZ + 15, Math.floor(centerZ + radiusZ));

        for (let worldX = minX; worldX <= maxX; worldX++) {
            const localX = worldX - originX;
            const offsetX = (worldX + 0.5 - centerX) / radiusX;

            for (let worldZ = minZ; worldZ <= maxZ; worldZ++) {
                const localZ = worldZ - originZ;
                const offsetZ = (worldZ + 0.5 - centerZ) / radiusZ;
                const distanceSq = offsetX * offsetX + offsetZ * offsetZ;

                if (distanceSq > 1.0) {
                    continue;
                }

                const cacheIndex = localX + (localZ << 4);
                let topY = heightCache[cacheIndex];
                if (topY === -1) {
                    topY = this.getSurfaceY(primer, localX, localZ);
                    heightCache[cacheIndex] = topY;
                }

                if (topY <= 1) {
                    continue;
                }

                // Water and lava only occur at the surface in this generator;
                // skipping the whole column keeps oceans and lava pools intact
                // without a second full-column scan.
                const topId = primer.get(localX, topY, localZ);
                if (topId === this.WATER_ID || topId === this.LAVA_ID) {
                    continue;
                }

                // The centre reaches the full depth; the edges step up to form
                // sloped walls instead of a square-sided trench.
                const bottomY = Math.max(1, Math.floor(floorY + distanceSq * wallSlope));
                if (bottomY >= topY) {
                    continue;
                }

                for (let y = topY; y >= bottomY; y--) {
                    const id = primer.get(localX, y, localZ);
                    if (id !== this.BEDROCK_ID && this.CARVE_IDS.has(id)) {
                        primer.set(localX, y, localZ, 0);
                    }
                }
            }
        }
    }

    getSurfaceY(primer, x, z) {
        for (let y = 255; y >= 1; y--) {
            if (primer.get(x, y, z) !== 0) {
                return y;
            }
        }
        return 0;
    }
}
