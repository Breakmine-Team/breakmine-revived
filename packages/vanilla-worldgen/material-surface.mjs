import { createNoiseRegistry } from './noise-registry.mjs';
import { createBiomeTemperatureSampler } from './biome-temperature.mjs';

const INT_MIN = -0x80000000;

function javaInt(value, name) {
    if (!Number.isInteger(value) || value < INT_MIN || value > 0x7fffffff) throw new TypeError(`${name} must be a Java int`);
    return value;
}

function nextFloat(random) {
    const bits = BigInt.asUintN(64, random.nextLong()) >> 40n;
    return Math.fround(Number(bits) * 5.9604644775390625e-8);
}

function resolveAnchorY(anchor, { minY, maxY, seaLevel }) {
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) throw new TypeError('Malformed vertical anchor');
    const [[kind, value]] = Object.entries(anchor);
    javaInt(value, `vertical anchor ${kind}`);
    switch (kind) {
        case 'absolute': return value;
        case 'above_bottom': return (minY + value) | 0;
        case 'below_top': return (maxY - 1 - value) | 0;
        case 'above_sea_level': return (seaLevel + value) | 0;
        case 'below_sea_level': return (seaLevel - value) | 0;
        default: throw new Error(`Unsupported vertical anchor: ${kind}`);
    }
}

export function createMaterialSurfaceSampler(kernel, seed, data, { blockStates } = {}) {
    const noises = createNoiseRegistry(kernel, seed, data);
    const biomeTemperatures = createBiomeTemperatureSampler(data);
    const rootRandom = kernel.random(seed);
    const rootFactory = rootRandom.forkPositional();
    rootRandom.dispose();
    const surfaceRandom = rootFactory.fromHashOf('surface');
    const surfaceFactory = surfaceRandom.forkPositional();
    surfaceRandom.dispose();
    const bandsRandom = rootFactory.fromHashOf('clay_bands');
    const namedFactories = new Map();
    let clayBands;
    let disposed = false;
    const check = () => { if (disposed) throw new Error('Material surface sampler has been disposed'); };

    function factory(name) {
        let value = namedFactories.get(name);
        if (!value) {
            const source = rootFactory.fromHashOf(name);
            try { value = source.forkPositional(); }
            finally { source.dispose(); }
            namedFactories.set(name, value);
        }
        return value;
    }

    function generateClayBands() {
        if (!blockStates) throw new Error('Badlands material sampling requires blockStates');
        const state = name => {
            const id = blockStates[`minecraft:${name}`];
            if (!Number.isInteger(id) || id < 0 || id > 0xffffffff) throw new Error(`Missing block-state mapping for minecraft:${name}`);
            return id >>> 0;
        };
        const bands = new Uint32Array(192).fill(state('terracotta'));
        const random = bandsRandom;
        for (let index = 0; index < bands.length;) {
            index += random.nextInt(5) + 1;
            if (index < bands.length) bands[index] = state('orange_terracotta');
            index++;
        }
        const makeBands = (start, block) => {
            const count = random.nextInt(10) + 6;
            for (let i = 0; i < count; i++) {
                const length = start + random.nextInt(3);
                const offset = random.nextInt(bands.length);
                for (let j = 0; j < length && offset + j < bands.length; j++) bands[offset + j] = block;
            }
        };
        makeBands(1, state('yellow_terracotta'));
        makeBands(2, state('brown_terracotta'));
        makeBands(1, state('red_terracotta'));
        const whiteCount = random.nextInt(7) + 9;
        for (let i = 0, index = 0; i < whiteCount && index < bands.length; i++) {
            bands[index] = state('white_terracotta');
            if (index > 0 && (random.nextLong() & 1n) !== 0n) bands[index - 1] = state('light_gray_terracotta');
            if (index + 1 < bands.length && (random.nextLong() & 1n) !== 0n) bands[index + 1] = state('light_gray_terracotta');
            index += random.nextInt(16) + 4;
        }
        return bands;
    }

    return {
        noiseAt(id, x, y, z) {
            check();
            const value = noises.sample(id, x, y, z);
            return Math.fround(value);
        },
        badlandsBandAt(x, y, z) {
            check(); javaInt(x, 'blockX'); javaInt(y, 'blockY'); javaInt(z, 'blockZ');
            clayBands ??= generateClayBands();
            const offset = Math.round(Math.fround(noises.sample('minecraft:clay_bands_offset', x, 0, z)) * 4);
            return clayBands[((y + offset + clayBands.length) % clayBands.length + clayBands.length) % clayBands.length];
        },
        surfaceAt(x, z) {
            check();
            javaInt(x, 'blockX'); javaInt(z, 'blockZ');
            const value = Math.fround(noises.sample('minecraft:surface', x, 0, z));
            const positional = surfaceFactory.at(x, 0, z);
            try {
                const depth = Math.trunc(value * 2.75 + 3 + positional.nextDouble() * 0.25);
                const secondary = Math.fround(noises.sample('minecraft:surface_secondary', x, 0, z));
                return { surfaceDepth: depth, surfaceSecondary: secondary };
            } finally { positional.dispose(); }
        },
        createColumn({ x, z, surfaceGradientX, surfaceGradientZ, preliminarySurfaceValue, seaLevel, minY, maxY, biome }) {
            check();
            javaInt(x, 'blockX'); javaInt(z, 'blockZ');
            javaInt(surfaceGradientX, 'surfaceGradientX'); javaInt(surfaceGradientZ, 'surfaceGradientZ');
            javaInt(seaLevel, 'seaLevel'); javaInt(minY, 'minY'); javaInt(maxY, 'maxY');
            if (maxY <= minY) throw new RangeError('maxY must be greater than minY');
            if (!Number.isFinite(preliminarySurfaceValue)) throw new TypeError('preliminarySurfaceValue must be finite');
            const { surfaceDepth, surfaceSecondary } = this.surfaceAt(x, z);
            const minSurfaceLevel = (Math.floor(Math.fround(preliminarySurfaceValue)) + surfaceDepth - 8) | 0;
            const base = {
                blockX: x, blockZ: z, surfaceGradientX, surfaceGradientZ,
                surfaceDepth, surfaceSecondary, minSurfaceLevel, seaLevel, biome,
                resolveAnchorY: anchor => resolveAnchorY(anchor, { minY, maxY, seaLevel })
            };
            const bandAt = (blockX, blockY, blockZ) => this.badlandsBandAt(blockX, blockY, blockZ);
            return {
                ...base,
                atY(y, { waterHeight = INT_MIN, stoneDepthAbove = 0, stoneDepthBelow = 0, biome = base.biome } = {}) {
                    check(); javaInt(y, 'blockY');
                    const context = { ...base, blockY: y, waterHeight, stoneDepthAbove, stoneDepthBelow, biome };
                    javaInt(waterHeight, 'waterHeight'); javaInt(stoneDepthAbove, 'stoneDepthAbove'); javaInt(stoneDepthBelow, 'stoneDepthBelow');
                    context.sampleNoise = (id, is3d = false) => noises.sample(id, x, is3d ? y : 0, z);
                    context.getBadlandsBand = bandAt;
                    context.isColdAt = (blockX, blockY, blockZ, level) => biomeTemperatures.isColdAt(context.biome, blockX, blockY, blockZ, level);
                    context.randomFloat = (name, drawIndex) => {
                        javaInt(drawIndex, 'random draw index');
                        if (drawIndex < 0 || drawIndex > 255) throw new RangeError('Random draw index out of range');
                        const positional = factory(name).at(x, y, z);
                        try {
                            let value = 0;
                            for (let i = 0; i <= drawIndex; i++) value = nextFloat(positional);
                            return value;
                        } finally { positional.dispose(); }
                    };
                    context.verticalGradient = condition => {
                        const lo = resolveAnchorY(condition.true_at_and_below, { minY, maxY, seaLevel });
                        const hi = resolveAnchorY(condition.false_at_and_above, { minY, maxY, seaLevel });
                        if (y <= lo) return true;
                        if (y >= hi) return false;
                        const probability = 1 + (0 - 1) * ((y - lo) / (hi - lo));
                        const positional = factory(condition.random_name).at(x, y, z);
                        try { return nextFloat(positional) < probability; }
                        finally { positional.dispose(); }
                    };
                    return context;
                }
            };
        },
        dispose() {
            if (disposed) return;
            for (const value of namedFactories.values()) value.dispose();
            namedFactories.clear();
            bandsRandom.dispose(); surfaceFactory.dispose(); rootFactory.dispose(); noises.dispose();
            disposed = true;
        }
    };
}

export function applyMaterialRulesToChunk(chunk, {
    evaluator, ruleId, materialSampler, airState, fluidStates,
    samplePreliminarySurface, sampleDensity, seaLevel, biomeAt, isStoneState
} = {}) {
    if (!chunk || !(chunk.blocks instanceof Uint32Array) || !(chunk.heightmap instanceof Int32Array)) throw new TypeError('Expected a mutable VanillaChunk');
    if (!evaluator || typeof evaluator.evaluate !== 'function') throw new TypeError('Expected material-rule evaluator');
    if (!materialSampler || typeof materialSampler.createColumn !== 'function') throw new TypeError('Expected material surface sampler');
    if (!Number.isInteger(airState) || !Number.isInteger(seaLevel)) throw new TypeError('Expected airState and seaLevel IDs');
    if (!(fluidStates instanceof Set) || ![...fluidStates].every(id => Number.isInteger(id) && id >= 0 && id <= 0xffffffff)) throw new TypeError('fluidStates must be a Set of state IDs');
    if (typeof samplePreliminarySurface !== 'function' || typeof biomeAt !== 'function') throw new TypeError('Expected preliminary-surface and biome samplers');
    if (sampleDensity !== undefined && typeof sampleDensity !== 'function') throw new TypeError('sampleDensity must be a function');
    const minY = chunk.minY, maxY = minY + chunk.height;
    const getState = (x, y, z) => y < minY || y >= maxY ? airState : chunk.blocks[(y - minY) * 256 + z * 16 + x];
    const isStone = isStoneState || (id => id !== airState && !fluidStates.has(id));
    let changedBlocks = 0;

    for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
        const columnIndex = z * 16 + x;
        const left = Math.max(0, x - 1), right = Math.min(15, x + 1);
        const north = Math.max(0, z - 1), south = Math.min(15, z + 1);
        const surfaceGradientX = chunk.heightmap[z * 16 + right] - chunk.heightmap[z * 16 + left];
        const surfaceGradientZ = chunk.heightmap[south * 16 + x] - chunk.heightmap[north * 16 + x];
        const worldX = chunk.chunkX * 16 + x, worldZ = chunk.chunkZ * 16 + z;
        const column = materialSampler.createColumn({
            x: worldX, z: worldZ, surfaceGradientX, surfaceGradientZ,
            preliminarySurfaceValue: samplePreliminarySurface(worldX, worldZ),
            seaLevel, minY, maxY, biome: biomeAt(worldX, Math.min(maxY - 1, chunk.heightmap[columnIndex]), worldZ)
        });
        let stoneDepthAbove = 0;
        let waterHeight = INT_MIN;
        let stoneFloorY = 0x7fffffff;
        const firstY = Math.min(maxY, chunk.heightmap[columnIndex] + 1);

        for (let y = firstY; y >= minY; y--) {
            const index = (y - minY) * 256 + z * 16 + x;
            const state = getState(x, y, z);
            if (state === airState) {
                stoneDepthAbove = 0;
                waterHeight = INT_MIN;
                stoneFloorY = 0x7fffffff;
                continue;
            }
            if (fluidStates.has(state)) {
                if (waterHeight === INT_MIN) waterHeight = (y + 1) | 0;
                continue;
            }

            if (stoneFloorY >= y) {
                stoneFloorY = minY;
                for (let probeY = y - 1; probeY >= minY - 1; probeY--) {
                    if (!isStone(getState(x, probeY, z))) {
                        stoneFloorY = probeY + 1;
                        break;
                    }
                }
            }
            stoneDepthAbove++;
            const stoneDepthBelow = (y - stoneFloorY + 1) | 0;
            const biome = biomeAt(worldX, y, worldZ);
            const context = column.atY(y, { waterHeight, stoneDepthAbove, stoneDepthBelow, biome });
            if (sampleDensity) context.sampleDensity = id => sampleDensity(id, worldX, y, worldZ);
            const replacement = evaluator.evaluate(ruleId, context);
            if (replacement !== null && replacement !== undefined && replacement !== state) {
                if (!Number.isInteger(replacement) || replacement < 0 || replacement > 0xffffffff) throw new TypeError('Material rule returned an invalid block-state ID');
                chunk.blocks[index] = replacement >>> 0;
                changedBlocks++;
            }
        }
    }
    return { changedBlocks };
}
