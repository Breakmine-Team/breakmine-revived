import Primer from "./Primer.js";
import Generator from "./Generator.js";
import { BlockRegistry } from "../block/BlockRegistry.js";
import NoiseGeneratorOctaves from "./noise/NoiseGeneratorOctaves.js";
import NoiseGeneratorPerlin from "./noise/NoiseGeneratorPerlin.js";

const BEDROCK_Y = 0;
const AIR_ID = 0;

// Density field resolution. One noise sample every GRID_STEP blocks, then
// trilinearly interpolated to every block, exactly like the overworld
// generator's coarse noise grid.
const GRID_STEP = 4;
const GRID_X = 5;   // 0..16
const GRID_Z = 5;   // 0..16
const GRID_Y = 29;  // 0..112

/**
 * Hellish world: a Nether-like dimension built from a 3D perlin density field.
 *
 * There is no heightmap: whether a block is hellstone or air comes from
 * interpolated 3D noise, so the world is made of overhangs, caverns and
 * floating chunks rather than a surface with things on top. The bottom of the
 * world is a large lava sea (y 1..32) with hellstone pillars poking out of it,
 * and a bedrock ceiling closes the dimension at y 112..127.
 */
export default class HellWorldGenerator extends Generator {

    static LAVA_LEVEL = 32;

    // Bedrock ceiling: jagged underside between ROOF_MIN and ROOF_MAX, solid up
    // to ROOF_TOP, and open air above it.
    static ROOF_TOP = 127;
    static ROOF_MIN = 112;
    static ROOF_MAX = 120;

    // The server's spawn search scans down from here so it lands on the
    // walkable terrain body, not on a floating chunk or a stalactite.
    static SPAWN_SCAN_TOP = 72;

    static PILLAR_THRESHOLD = 0.22;
    static SHORE_THRESHOLD = 0.10;
    static TERRAIN_BIAS = 0.04;
    static TERRAIN_FALLOFF = 0.005;

    constructor(world, seed) {
        super(world, seed);

        this.HELLSTONE_ID = BlockRegistry.HELLSTONE.getId();
        this.LAVA_ID = BlockRegistry.LAVA.getId();
        this.GLOWSTONE_ID = BlockRegistry.GLOWSTONE.getId();
        this.BEDROCK_ID = BlockRegistry.BEDROCK.getId();

        this.lavaLevel = HellWorldGenerator.LAVA_LEVEL;
        this.shoreTop = this.lavaLevel + 8;

        // A couple of blocks above the lava sea, so ChunkProviderGenerate's
        // findSpawn() never mistakes the lava surface for solid ground.
        this.seaLevel = this.lavaLevel + 2;

        // The density field: one perlin stream is the base shape, a second one
        // bends it so the caverns are not aligned in obvious sheets.
        this.densityGenerator = new NoiseGeneratorPerlin(this.random);
        this.warpGenerator = new NoiseGeneratorPerlin(this.random);
        this.roofGenerator = new NoiseGeneratorOctaves(this.random, 3);
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

    /** Horizontal warp for a world column. Sampled once per column, not per block. */
    getWarpAt(worldX, worldZ, warpOut) {
        warpOut.x = this.warpGenerator.perlinXYZ(worldX * 0.011, 0, worldZ * 0.011) * 6;
        warpOut.z = this.warpGenerator.perlinXYZ(worldX * 0.011 + 31.7, 0, worldZ * 0.011 + 17.3) * 6;
        return warpOut;
    }

    /**
     * 3D perlin fBm, roughly in [-1, 1]. Sampled on the coarse grid and
     * interpolated by generateTerrain(), so this is only called a few hundred
     * times per chunk rather than once per block.
     */
    sampleDensity(worldX, y, worldZ, warpX, warpZ) {
        if (warpX === undefined) {
            const warp = this.getWarpAt(worldX, worldZ, { x: 0, z: 0 });
            warpX = warp.x;
            warpZ = warp.z;
        }

        const x = (worldX + warpX) * 0.05;
        const z = (worldZ + warpZ) * 0.05;

        let total = 0;
        let amplitude = 1;
        let frequency = 1;
        let norm = 0;

        for (let octave = 0; octave < 3; octave++) {
            total += this.densityGenerator.perlinXYZ(x * frequency, y * 0.062 * frequency, z * frequency) * amplitude;
            norm += amplitude;
            amplitude *= 0.5;
            frequency *= 2;
        }

        return total / norm;
    }

    /** Density threshold that turns the field into hellstone at a given height. */
    isSolidAt(y, density) {
        if (y <= BEDROCK_Y) return true;

        // Inside the lava sea only sparse pillars and islands survive; a
        // higher threshold here keeps the lakes large and open.
        if (y <= this.lavaLevel) {
            return density > HellWorldGenerator.PILLAR_THRESHOLD;
        }

        // Just above the lava sea: a thin broken crust, so the lakes stay
        // visible instead of being sealed under rock.
        if (y <= this.shoreTop) {
            return density > HellWorldGenerator.SHORE_THRESHOLD;
        }

        // Solid mass in the lower middle, thinning out into floating chunks
        // toward the roof.
        const bias = HellWorldGenerator.TERRAIN_BIAS
            - (y - 50) * HellWorldGenerator.TERRAIN_FALLOFF;
        return density + bias > 0;
    }

    /** Lowest bedrock block of the roof over a world column. */
    getRoofBottomAt(worldX, worldZ) {
        const noise = this.roofGenerator.perlin(worldX * 0.05, worldZ * 0.05);
        const norm = Math.max(0, Math.min(1, noise * 0.5 + 0.5));
        const span = HellWorldGenerator.ROOF_MAX - HellWorldGenerator.ROOF_MIN;

        return HellWorldGenerator.ROOF_MIN + Math.min(span, Math.floor(norm * (span + 1)));
    }

    /**
     * Top of the solid column at a world position, or 1 when the column is all
     * lava/air. Used by world features (entity placement); terrain generation
     * itself never calls it.
     */
    getHeightAt(worldX, worldZ) {
        const warp = this.getWarpAt(worldX, worldZ, { x: 0, z: 0 });

        for (let y = HellWorldGenerator.ROOF_MIN - 1; y > BEDROCK_Y; y--) {
            if (this.isSolidAt(y, this.sampleDensity(worldX, y, worldZ, warp.x, warp.z))) {
                return y + 1;
            }
        }
        return 1;
    }

    generateTerrain(chunkX, chunkZ, primer) {
        const lavaLevel = this.lavaLevel;
        const shoreTop = this.shoreTop;
        const roofTop = HellWorldGenerator.ROOF_TOP;

        const pillarThreshold = HellWorldGenerator.PILLAR_THRESHOLD;
        const shoreThreshold = HellWorldGenerator.SHORE_THRESHOLD;
        const terrainBias = HellWorldGenerator.TERRAIN_BIAS;
        const terrainFalloff = HellWorldGenerator.TERRAIN_FALLOFF;

        const warp = { x: 0, z: 0 };

        // Coarse 3D density grid for this chunk and one block of its neighbour
        // border: the last sample of a chunk is the first sample of the next
        // one, so terrain lines up across chunk borders.
        const grid = new Float64Array(GRID_X * GRID_Z * GRID_Y);
        let index = 0;

        for (let gridX = 0; gridX < GRID_X; gridX++) {
            const worldX = chunkX * 16 + gridX * GRID_STEP;

            for (let gridZ = 0; gridZ < GRID_Z; gridZ++) {
                const worldZ = chunkZ * 16 + gridZ * GRID_STEP;

                this.getWarpAt(worldX, worldZ, warp);

                for (let gridY = 0; gridY < GRID_Y; gridY++) {
                    grid[index++] = this.sampleDensity(worldX, gridY * GRID_STEP, worldZ, warp.x, warp.z);
                }
            }
        }

        // Roof height for this chunk plus a one-block border. A column's
        // bedrock is exposed sideways wherever a neighbour's roof starts
        // higher, so the plating pass needs to see across the chunk edge.
        const ROOF_STRIDE = 18;
        const roofBottoms = new Int32Array(ROOF_STRIDE * ROOF_STRIDE);
        for (let gx = 0; gx < ROOF_STRIDE; gx++) {
            for (let gz = 0; gz < ROOF_STRIDE; gz++) {
                roofBottoms[gz * ROOF_STRIDE + gx] =
                    this.getRoofBottomAt(chunkX * 16 - 1 + gx, chunkZ * 16 - 1 + gz);
            }
        }

        for (let x = 0; x < 16; x++) {
            const gridX = x >> 2;
            const fracX = (x & 3) / GRID_STEP;

            // Base offsets of this column's grid corners, computed once per
            // column instead of eight times per block.
            const baseX0 = gridX * GRID_Z * GRID_Y;
            const baseX1 = (gridX + 1) * GRID_Z * GRID_Y;

            for (let z = 0; z < 16; z++) {
                const gridZ = z >> 2;
                const fracZ = (z & 3) / GRID_STEP;

                const worldX = chunkX * 16 + x;
                const worldZ = chunkZ * 16 + z;

                const roofIndex = (z + 1) * ROOF_STRIDE + (x + 1);
                const roofBottom = roofBottoms[roofIndex];

                // Plate down to the lowest neighbouring roof height, so the
                // vertical faces of roof steps are covered as well.
                let highestNeighbour = roofBottoms[roofIndex - 1];
                if (roofBottoms[roofIndex + 1] > highestNeighbour) highestNeighbour = roofBottoms[roofIndex + 1];
                if (roofBottoms[roofIndex - ROOF_STRIDE] > highestNeighbour) highestNeighbour = roofBottoms[roofIndex - ROOF_STRIDE];
                if (roofBottoms[roofIndex + ROOF_STRIDE] > highestNeighbour) highestNeighbour = roofBottoms[roofIndex + ROOF_STRIDE];

                const plateTop = Math.min(roofTop, Math.max(roofBottom, highestNeighbour - 1));

                const corner00 = baseX0 + gridZ * GRID_Y;
                const corner10 = baseX1 + gridZ * GRID_Y;
                const corner01 = baseX0 + (gridZ + 1) * GRID_Y;
                const corner11 = baseX1 + (gridZ + 1) * GRID_Y;

                primer.set(x, BEDROCK_Y, z, this.BEDROCK_ID);

                for (let y = 1; y < roofBottom; y++) {
                    const gridY = Math.min(y >> 2, GRID_Y - 2);
                    const fracY = (y & 3) / GRID_STEP;

                    // Trilinear interpolation of the eight surrounding samples.
                    const i000 = corner00 + gridY;
                    const i100 = corner10 + gridY;
                    const i010 = corner01 + gridY;
                    const i110 = corner11 + gridY;
                    const i001 = i000 + 1;
                    const i101 = i100 + 1;
                    const i011 = i010 + 1;
                    const i111 = i110 + 1;

                    const d00 = grid[i000] + (grid[i100] - grid[i000]) * fracX;
                    const d10 = grid[i010] + (grid[i110] - grid[i010]) * fracX;
                    const d01 = grid[i001] + (grid[i101] - grid[i001]) * fracX;
                    const d11 = grid[i011] + (grid[i111] - grid[i011]) * fracX;

                    const d0 = d00 + (d10 - d00) * fracZ;
                    const d1 = d01 + (d11 - d01) * fracZ;

                    const density = d0 + (d1 - d0) * fracY;

                    // Same thresholds as isSolidAt(), inlined because this loop
                    // runs once per block.
                    let solid;
                    if (y <= lavaLevel) {
                        solid = density > pillarThreshold;
                    } else if (y <= shoreTop) {
                        solid = density > shoreThreshold;
                    } else {
                        solid = density + terrainBias - (y - 50) * terrainFalloff > 0;
                    }

                    if (solid) {
                        primer.set(x, y, z, this.HELLSTONE_ID);
                    } else if (y <= lavaLevel) {
                        // The bottom of the dimension is one large lava sea;
                        // the 3D field only leaves pillars and islands in it.
                        primer.set(x, y, z, this.LAVA_ID);
                    }
                    // Air above the lava is left untouched: generated chunks
                    // start empty, so writing 0 here is wasted work.
                }

                // Hellstone-plated underside: looking up from inside the
                // dimension shows netherrack instead of the bare bedrock roof,
                // including the exposed sides of the jagged roof steps.
                for (let y = roofBottom; y <= plateTop; y++) {
                    primer.set(x, y, z, this.HELLSTONE_ID);
                }
                for (let y = plateTop + 1; y <= roofTop; y++) {
                    primer.set(x, y, z, this.BEDROCK_ID);
                }
            }
        }
    }

    /**
     * Decoration pass. Runs after generateTerrain() from the chunk seed alone,
     * so the server's probe pass (terrain + naturalize) matches full chunks.
     */
    naturalize(chunkX, chunkZ, primer) {
        this.generateStalactites(chunkX, chunkZ, primer);
        this.generateCeilingGlowstone(chunkX, chunkZ, primer);
        this.generateGroundGlowstone(chunkX, chunkZ, primer);
    }

    /** Hellstone spikes hanging from the roof, some tipped with glowstone. */
    generateStalactites(chunkX, chunkZ, primer) {
        const stalactites = 1 + this.random.nextInt(3);

        for (let i = 0; i < stalactites; i++) {
            const x = 1 + this.random.nextInt(14);
            const z = 1 + this.random.nextInt(14);
            const roofBottom = this.getRoofBottomAt(chunkX * 16 + x, chunkZ * 16 + z);
            const length = 3 + this.random.nextInt(9);
            const glowingTip = this.random.nextInt(3) === 0;

            let tipY = -1;
            for (let d = 1; d <= length; d++) {
                const y = roofBottom - d;

                const radius = d * 3 < length ? 1 : 0;

                for (let dz = -radius; dz <= radius; dz++) {
                    const blockZ = z + dz;
                    if (blockZ < 0 || blockZ > 15) continue;

                    for (let dx = -radius; dx <= radius; dx++) {
                        const blockX = x + dx;
                        if (blockX < 0 || blockX > 15) continue;
                        if (primer.get(blockX, y, blockZ) !== AIR_ID) continue;
                        primer.set(blockX, y, blockZ, this.HELLSTONE_ID);
                    }
                }

                tipY = y;
            }

            if (glowingTip && tipY > 0 && primer.get(x, tipY, z) === this.HELLSTONE_ID) {
                primer.set(x, tipY, z, this.GLOWSTONE_ID);
            }
        }
    }

    /** Glowstone clusters growing out of the underside of the roof. */
    generateCeilingGlowstone(chunkX, chunkZ, primer) {
        const clusters = 2 + this.random.nextInt(2);

        for (let i = 0; i < clusters; i++) {
            const x = 1 + this.random.nextInt(14);
            const z = 1 + this.random.nextInt(14);
            const centerY = this.getRoofBottomAt(chunkX * 16 + x, chunkZ * 16 + z);
            const radius = 1 + this.random.nextInt(2);

            for (let dy = -radius; dy <= radius; dy++) {
                const y = centerY + dy;

                for (let dz = -radius; dz <= radius; dz++) {
                    const blockZ = z + dz;
                    if (blockZ < 0 || blockZ > 15) continue;

                    for (let dx = -radius; dx <= radius; dx++) {
                        const blockX = x + dx;
                        if (blockX < 0 || blockX > 15) continue;
                        if (dx * dx + dy * dy + dz * dz > radius * radius + 0.5) continue;

                        const current = primer.get(blockX, y, blockZ);
                        // Only the roof itself (bedrock or its hellstone
                        // plating) and the open air under it, so a cluster
                        // never eats into a stalactite or the terrain.
                        if (current !== this.BEDROCK_ID && current !== this.HELLSTONE_ID && current !== AIR_ID) continue;
                        primer.set(blockX, y, blockZ, this.GLOWSTONE_ID);
                    }
                }
            }
        }
    }

    /** Glowstone embedded in the hellstone, mostly on cave and chunk surfaces. */
    generateGroundGlowstone(chunkX, chunkZ, primer) {
        const clusters = 2 + this.random.nextInt(2);

        for (let i = 0; i < clusters; i++) {
            const x = this.random.nextInt(16);
            const z = this.random.nextInt(16);

            // Find the top of this column's solid mass.
            let surface = -1;
            for (let y = HellWorldGenerator.SPAWN_SCAN_TOP + 30; y > this.lavaLevel; y--) {
                if (primer.get(x, y, z) === this.HELLSTONE_ID) {
                    surface = y;
                    break;
                }
            }
            if (surface < 0) continue;

            const radius = 1 + this.random.nextInt(2);
            const centerY = surface - this.random.nextInt(2);

            for (let dy = -radius; dy <= radius; dy++) {
                const y = centerY + dy;
                if (y <= this.lavaLevel) continue;

                for (let dz = -radius; dz <= radius; dz++) {
                    const blockZ = z + dz;
                    if (blockZ < 0 || blockZ > 15) continue;

                    for (let dx = -radius; dx <= radius; dx++) {
                        const blockX = x + dx;
                        if (blockX < 0 || blockX > 15) continue;
                        if (dx * dx + dy * dy + dz * dz > radius * radius + 0.5) continue;

                        const current = primer.get(blockX, y, blockZ);
                        if (current !== this.HELLSTONE_ID && current !== AIR_ID) continue;
                        primer.set(blockX, y, blockZ, this.GLOWSTONE_ID);
                    }
                }
            }
        }
    }

    // No structures: nothing to place after terrain generation.
    populateChunk(chunkX, chunkZ) {
        this.setChunkSeed(chunkX, chunkZ);
    }
}
