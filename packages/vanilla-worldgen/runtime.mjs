import { compileDensityGraph } from './density.mjs';

export function excludeClimateBiomes(preset, excludedBiomes) {
    if (!preset || !Array.isArray(preset.nodes) || !Array.isArray(preset.biomes)) throw new TypeError('Invalid climate preset');
    const excluded = new Set(excludedBiomes ?? []);
    if ([...excluded].some(name => typeof name !== 'string' || !name.startsWith('minecraft:'))) throw new TypeError('Excluded biome IDs must be namespaced');
    if (!excluded.size || !preset.biomes.some(name => excluded.has(name))) return preset;
    const biomeIndex = new Map(preset.biomes.map((name, index) => [index, name]));
    const kept = new Uint8Array(preset.nodes.length);
    const visiting = new Uint8Array(preset.nodes.length);
    function retain(index) {
        if (!Number.isInteger(index) || index < 0 || index >= preset.nodes.length) throw new RangeError('Climate child index is outside its preset');
        if (kept[index]) return true;
        if (visiting[index]) throw new Error('Climate preset contains a cycle');
        visiting[index] = 1;
        const node = preset.nodes[index];
        if (!Number.isInteger(node.biome) || !Array.isArray(node.children)) throw new TypeError('Malformed climate node');
        let keep;
        if (node.biome >= 0) {
            const name = biomeIndex.get(node.biome);
            if (!name) throw new RangeError('Climate node refers to an unknown biome');
            keep = !excluded.has(name);
        } else {
            keep = false;
            for (const child of node.children) if (retain(child)) keep = true;
        }
        visiting[index] = 0;
        if (keep) kept[index] = 1;
        return keep;
    }
    if (!retain(0)) throw new Error('Climate exclusions removed every biome');
    const biomes = preset.biomes.filter(name => !excluded.has(name));
    const biomeRemap = new Map();
    let nextBiome = 0;
    for (let index = 0; index < preset.biomes.length; index++) {
        if (!excluded.has(preset.biomes[index])) biomeRemap.set(index, nextBiome++);
    }
    const oldIndexes = [];
    for (let index = 0; index < kept.length; index++) if (kept[index]) oldIndexes.push(index);
    const nodeRemap = new Map(oldIndexes.map((oldIndex, newIndex) => [oldIndex, newIndex]));
    const nodes = oldIndexes.map(oldIndex => {
        const node = preset.nodes[oldIndex];
        return { ...node, biome: node.biome >= 0 ? biomeRemap.get(node.biome) : -1,
            children: node.children.filter(index => kept[index]).map(index => nodeRemap.get(index)) };
    });
    if (nodeRemap.get(0) !== 0) throw new Error('Climate root was not retained at index zero');
    return { ...preset, biomes, nodes };
}

const SEED_MIN = -(1n << 63n);
const SEED_MAX = (1n << 63n) - 1n;

export function parseSeed(seed) {
    if (typeof seed === 'number' && !Number.isSafeInteger(seed)) throw new RangeError('Use a string or bigint for 64-bit seeds');
    if (typeof seed === 'string' && !/^-?\d+$/.test(seed)) throw new TypeError('Expected a signed decimal seed');
    if (!['string', 'number', 'bigint'].includes(typeof seed)) throw new TypeError('Expected a signed decimal seed');
    const value = BigInt(seed);
    if (value < SEED_MIN || value > SEED_MAX) throw new RangeError('Seed is outside signed 64-bit range');
    return value;
}

export async function createVanillaKernel(bytes, climateData) {
    if (climateData?.source?.version !== '26.3' || climateData?.source?.sha256 !== '4508d006323f24fa02876310c192d739af56516eb259000ac50f0909a68c9a2d') {
        throw new Error('Climate data does not match the reference JAR');
    }
    const result = await WebAssembly.instantiate(bytes);
    const wasm = (result.instance || result).exports;
    if (wasm.worldgen_abi_version() !== 1 || wasm.worldgen_capabilities() !== 63) throw new Error('Unsupported vanilla kernel');
    const noiseHandles = new WeakMap();
    const resources = new Set();
    let disposed = false;
    const check = () => { if (disposed) throw new Error('Kernel has been disposed'); };
    function owned(ptr, free) {
        let released = false;
        const handle = {
            get() { check(); if (released) throw new Error('Handle has been disposed'); return ptr; },
            dispose() { if (!released) { free(ptr); released = true; resources.delete(handle); } }
        };
        resources.add(handle);
        return handle;
    }
    function randomHandle(ptr) {
            const handle = owned(ptr, wasm.rng_free);
            let cachedGaussian = 0;
            let hasCachedGaussian = false;
            return {
                nextLong: () => wasm.rng_next_long(handle.get()),
                nextBoolean: () => (wasm.rng_next_long(handle.get()) & 1n) !== 0n,
                nextDouble: () => wasm.rng_next_double(handle.get()),
                nextFloat: () => Math.fround(Number(BigInt.asUintN(64, wasm.rng_next_long(handle.get())) >> 40n) * 5.9604644775390625e-8),
                nextGaussian() {
                    if (hasCachedGaussian) {
                        hasCachedGaussian = false;
                        return cachedGaussian;
                    }
                    let x, y, radius;
                    do {
                        x = 2 * wasm.rng_next_double(handle.get()) - 1;
                        y = 2 * wasm.rng_next_double(handle.get()) - 1;
                        radius = x * x + y * y;
                    } while (radius >= 1 || radius === 0);
                    const scale = Math.sqrt(-2 * Math.log(radius) / radius);
                    cachedGaussian = y * scale;
                    hasCachedGaussian = true;
                    return x * scale;
                },
                nextInt(bound) {
                    if (!Number.isInteger(bound) || bound <= 0 || bound > 2147483647) throw new RangeError('Bound must be a positive Java int');
                    return wasm.rng_next_int(handle.get(), bound);
                },
                forkPositional() {
                    const factory = owned(wasm.positional_fork(handle.get()), wasm.positional_free);
                    return {
                        at(x, y, z) {
                            if (![x,y,z].every(v => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)) throw new RangeError('Coordinates must be Java ints');
                            return randomHandle(wasm.positional_at(factory.get(), x,y,z));
                        },
                        fromSeed: seed => randomHandle(wasm.positional_seed(factory.get(), parseSeed(seed))),
                        fromHashOf(name) {
                            if (typeof name !== 'string' || !name.isWellFormed()) throw new TypeError('Expected a well-formed seed name');
                            const factoryPtr = factory.get();
                            const bytes = new TextEncoder().encode(name);
                            const length = Math.max(1, Math.ceil(bytes.length / 8));
                            const buffer = wasm.buffer_alloc(length);
                            try {
                                new Uint8Array(wasm.memory.buffer, buffer, bytes.length).set(bytes);
                                return randomHandle(wasm.positional_hash(factoryPtr, buffer, bytes.length));
                            } finally { wasm.buffer_free(buffer, length); }
                        },
                        dispose: factory.dispose
                    };
                },
                normalNoise(parameters, legacySeed, legacyPositional = false) {
                    if (typeof legacyPositional !== 'boolean') throw new TypeError('Legacy positional noise selection must be boolean');
                    const { base_octave: octave, base_amplitude: amplitude = 1, octave_count: count = 1, normalize = true, amplitude_modifiers: given = [] } = parameters;
                    if (!Number.isInteger(octave) || octave < -32 || octave > 32 || !Number.isInteger(count) || count < 1 || count > 32) throw new RangeError('Invalid noise octaves');
                    if (!Number.isFinite(amplitude) || amplitude < Math.fround(1e-5) || amplitude > 1e6) throw new RangeError('Invalid base amplitude');
                    if (![true, false, 'legacy'].includes(normalize)) throw new TypeError('Invalid normalization mode');
                    if (!Array.isArray(given) || (given.length !== 0 && given.length !== count) || !given.every(v => Number.isFinite(v) && v >= 0 && v <= 1e6)) throw new RangeError('Invalid amplitude modifiers');
                    const modifiers = given.length ? given : Array(count).fill(1);
                    const legacy = legacySeed !== undefined;
                    if (legacy && !legacyPositional && (octave > 0 || octave + count > 1)) throw new RangeError('Positive legacy octaves are not supported by the JAR');
                    if (legacyPositional && !legacy) throw new TypeError('Legacy positional noise requires an explicit world seed');
                    if (legacy) legacySeed = parseSeed(legacySeed);
                    const randomPtr = handle.get();
                    const buffer = wasm.buffer_alloc(count);
                    try {
                        new Float64Array(wasm.memory.buffer, buffer, count).set(modifiers);
                        const mode = normalize === 'legacy' ? 2 : +normalize;
                        const noise = owned(legacyPositional ? wasm.normal_legacy_positional_create(legacySeed, octave, amplitude, mode, buffer, count)
                            : legacy ? wasm.normal_legacy_create(legacySeed, octave, amplitude, mode, buffer, count) : wasm.normal_create(randomPtr, octave, amplitude, mode, buffer, count), wasm.normal_free);
                        const sampler = {
                            sample(x,y,z) {
                                if (![x,y,z].every(Number.isFinite)) throw new RangeError('Invalid noise coordinates');
                                return wasm.normal_sample(noise.get(), x,y,z);
                            },
                            dispose: noise.dispose
                        };
                        noiseHandles.set(sampler, noise);
                        return sampler;
                    } finally { wasm.buffer_free(buffer, count); }
                },
                dispose: handle.dispose
            };
    }
    return {
        capabilities: Object.freeze({ random: true, perlin: true, climate: true, positional: true, normalNoise: true, densitySubset: true, chunks: false }),
        density(seed, data, roots, { legacyRandom = false, beardifier, experimentalScalarMemoReuse = false,
            experimentalBatchDensityQueries = false, cacheWrapperPrototype = false, cacheWrapperProfile = false } = {}) {
            check();
            const random = randomHandle(wasm.rng_create(parseSeed(seed)));
            const factory = random.forkPositional();
            random.dispose();
            try {
                const graph = compileDensityGraph(wasm, owned, (graph, id, parameters) => {
                    const netherNoise = id === 'minecraft:nether/temperature' || id === 'minecraft:nether/vegetation';
                    if (legacyRandom && !netherNoise) throw new Error(`Legacy named noise is not ported: ${id}`);
                    const source = factory.fromHashOf(id);
                    let noise;
                    try {
                        const legacySeed = netherNoise ? BigInt.asIntN(64, parseSeed(seed) + (id.endsWith('/vegetation') ? 1n : 0n)) : undefined;
                        noise = source.normalNoise(parameters, legacySeed);
                        return wasm.density_add_noise(graph, noiseHandles.get(noise).get());
                    } finally { noise?.dispose(); source.dispose(); }
                }, data, roots, parseSeed(seed), legacyRandom, { experimentalScalarMemoReuse, experimentalBatchDensityQueries,
                    cacheWrapperPrototype, cacheWrapperProfile });
                try { if (beardifier !== undefined) graph.setBeardifier(beardifier); return graph; }
                catch (error) { graph.dispose(); throw error; }
            } finally { factory.dispose(); }
        },
        random(seed) {
            check();
            return randomHandle(wasm.rng_create(parseSeed(seed)));
        },
        perlin(seed) {
            check();
            const handle = owned(wasm.perlin_create(parseSeed(seed)), wasm.perlin_free);
            return {
                sample: (x,y,z) => wasm.perlin_sample(handle.get(), x,y,z),
                sampleSmeared: (x,y,z,scale) => wasm.smeared_perlin_sample(handle.get(), x,y,z,scale),
                dispose: handle.dispose
            };
        },
        climate(dimension, { excludeBiomes = [] } = {}) {
            check();
            const sourcePreset = climateData?.presets?.[dimension];
            if (!sourcePreset) throw new Error(`No multi-noise preset for ${dimension}`);
            const preset = excludeClimateBiomes(sourcePreset, excludeBiomes);
            const handle = owned(wasm.climate_create(preset.nodes.length), wasm.climate_free);
            for (const [index, node] of preset.nodes.entries()) {
                const address = wasm.climate_bounds(handle.get(), index);
                new BigInt64Array(wasm.memory.buffer, address, 14).set(node.bounds.flat().map(BigInt));
                wasm.climate_set_biome(handle.get(), index, node.biome);
                for (const child of node.children) wasm.climate_add_child(handle.get(), index, child);
            }
            return {
                biomes: Object.freeze([...preset.biomes]),
                sample(temperature, humidity, continentalness, erosion, depth, weirdness) {
                    const values = [temperature, humidity, continentalness, erosion, depth, weirdness];
                    if (!values.every(value => Number.isFinite(value) && Math.abs(value) <= 100)) throw new RangeError('Invalid climate coordinates');
                    return preset.biomes[wasm.climate_sample(handle.get(), ...values.map(value => wasm.climate_quantize(value)))];
                },
                dispose: handle.dispose
            };
        },
        generateChunk() { check(); throw new Error('Vanillith chunk generation is not implemented; no fallback terrain was generated.'); },
        dispose() { for (const handle of resources) handle.dispose(); disposed = true; }
    };
}
