import { createVanillaKernel, parseSeed } from './runtime.mjs';
import { createNoiseTerrainSampler } from './chunk.mjs';
import { createChunkDecorationPipeline } from './chunk-decoration.mjs';
import { createNativeBlockTags, createNativeTreeRules } from './native-tree-rules.mjs';
import { carveVanillaChunk } from './carver-pipeline.mjs';
import { createProgressiveDecorationSession, generateDecorationDraft, generateDecorationDraftBatch,
    generateProgressiveDecorationDraft } from './decoration-stage.mjs';
import { readVanillaChunk } from './chunk-store.mjs';
import { biomeInfoNoise, createBiomeTemperatureSampler } from './biome-temperature.mjs';

const DEFAULT_PROPERTIES = {
    'minecraft:water': { level: '0' },
    'minecraft:lava': { level: '0' },
    'minecraft:grass_block': { snowy: 'false' },
    'minecraft:podzol': { snowy: 'false' },
    'minecraft:mycelium': { snowy: 'false' },
    'minecraft:deepslate': { axis: 'y' },
    'minecraft:basalt': { axis: 'y' },
    'minecraft:nether_wart': { age: '0' }
};

const EXCLUDED_WORLDGEN_BIOMES = new Set(['minecraft:pale_garden', 'minecraft:sulfur_caves']);

const now = () => globalThis.performance?.now?.() ?? Date.now();
const REGION_PROFILE_FIELDS = ['regionSetupMs', 'blockStateLookups', 'blockLightQueries', 'blockLightBuildMs',
    'blockLightVisitedBlocks', 'blockWrites', 'survivalChecks', 'crossChunkBlockWrites'];

export function terrainStateIds(registry) {
    const byName = new Map();
    for (const state of registry.states) {
        const list = byName.get(state.name) ?? [];
        list.push(state);
        byName.set(state.name, list);
    }
    const result = Object.create(null);
    for (const [name, states] of byName) {
        const properties = DEFAULT_PROPERTIES[name];
        const selected = states.length === 1 ? states[0] : properties && states.find(state =>
            Object.keys(state.properties).length === Object.keys(properties).length &&
            Object.entries(properties).every(([key, value]) => state.properties[key] === value));
        if (selected) result[name] = selected.id;
    }
    return result;
}

export async function createChunkService({ bytes, climate, data, registry, stateRules, maxCachedChunks = 49, maxCachedDecorationBytes = 32 * 1024 * 1024,
    batchMaterialDensitySampling = false, cacheSurfaceBiomeSamples = true,
    experimentalScalarMemoReuse = false, experimentalBatchDensityQueries = false,
    experimentalProgressiveDecorationReuse = false, enableCarvers = false }) {
    if (!Number.isInteger(maxCachedChunks) || maxCachedChunks < 0 || maxCachedChunks > 64) throw new RangeError('Invalid chunk cache limit');
    if (!Number.isSafeInteger(maxCachedDecorationBytes) || maxCachedDecorationBytes < 0 || maxCachedDecorationBytes > 128 * 1024 * 1024) throw new RangeError('Invalid decoration result cache limit');
    if (registry?.source?.sha256 !== climate?.source?.sha256 || registry?.source?.version !== '26.3' || !Array.isArray(registry.states)) throw new Error('Block registry does not match pinned climate data');
    const kernel = await createVanillaKernel(bytes, climate);
    const blockStates = terrainStateIds(registry);
    const biomeNames = Object.keys(data).filter(key => key.startsWith('data/minecraft/worldgen/biome/') && key.endsWith('.json'))
        .map(key => 'minecraft:' + key.slice('data/minecraft/worldgen/biome/'.length, -5))
        .filter(name => !EXCLUDED_WORLDGEN_BIOMES.has(name)).sort();
    const biomeIds = Object.fromEntries(biomeNames.map((name, index) => [name, index]));
    const nativeTags = createNativeBlockTags(data, registry);
    const cache = new Map();
    const carvedCacheKeys = new Set();
    const decorationCache = new Map();
    let decorationCacheBytes = 0;
    const blockStateNoises = new Map();
    let decorationPipeline;
    function sampleNoiseProvider(provider, pos) {
        const seed = parseSeed(provider.seed ?? 0).toString();
        const parameters = provider.noise;
        if (!parameters || !Number.isInteger(parameters.base_octave)) throw new TypeError('Noise-threshold provider needs native noise parameters');
        const key = JSON.stringify([seed, parameters]);
        let noise = blockStateNoises.get(key);
        if (!noise) {
            const source = kernel.random(0n);
            try {
                noise = source.normalNoise(parameters, seed, true);
            } finally { source.dispose(); }
            blockStateNoises.set(key, noise);
        }
        const scale = Math.fround(provider.scale);
        return noise.sample(pos.x * scale, pos.y * scale, pos.z * scale);
    }
    function sampleDualNoiseProvider(provider, pos, channel) {
        const parameters = channel === 'slow' ? provider.slow_noise : provider.noise;
        const scale = channel === 'slow' ? provider.slow_scale : provider.scale;
        const seed = parseSeed(provider.seed).toString();
        if (!parameters || !Number.isInteger(parameters.base_octave) || !Number.isFinite(scale) || scale <= 0) {
            throw new TypeError('Dual-noise provider needs valid native noise parameters and scale');
        }
        const key = JSON.stringify(['dual_noise', seed, channel, parameters]);
        let noise = blockStateNoises.get(key);
        if (!noise) {
            const source = kernel.random(0n);
            try { noise = source.normalNoise(parameters, seed, true); }
            finally { source.dispose(); }
            blockStateNoises.set(key, noise);
        }
        if (channel === 'slow') {
            const floatScale = Math.fround(scale);
            return noise.sample(
                Math.fround(Math.fround(pos.x) * floatScale),
                Math.fround(Math.fround(pos.y) * floatScale),
                Math.fround(Math.fround(pos.z) * floatScale));
        }
        return noise.sample(pos.x * Math.fround(scale), pos.y * Math.fround(scale), pos.z * Math.fround(scale));
    }
    function sampleChunk(x, z) {
        const key = `${x},${z}`;
        const payload = cache.get(key);
        const chunk = payload ? readVanillaChunk(payload) : sampler.sampleChunk(x, z);
        const settings = context.slice(0, context.indexOf(':'));
        if (enableCarvers && settings !== 'end' && sampler.sampleCarvingAquiferVolume && !carvedCacheKeys.has(key)) {
            applyCarvers(chunk);
            if (maxCachedChunks) carvedCacheKeys.add(key);
        }
        const serialized = chunk.serialize();
        cache.delete(key);
        if (maxCachedChunks) cache.set(key, serialized);
        while (cache.size > maxCachedChunks) {
            const oldest = cache.keys().next().value;
            cache.delete(oldest);
            carvedCacheKeys.delete(oldest);
        }
        return serialized;
    }
    function applyCarvers(chunk) {
        const definition = data[`data/minecraft/worldgen/noise_settings/${context.split(':')[0]}.json`];
        const stateName = id => registry.states[id]?.name;
        const carving = sampler.sampleCarvingAquiferVolume(chunk.chunkX, chunk.chunkZ);
        const minY = chunk.minY, height = chunk.height;
        const air = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);
        const biomeNameAtQuart = (x, y, z) => sampler.sampleBiomeAtQuart(x, y, z);
        carveVanillaChunk(chunk, {
            seed: context.slice(context.indexOf(':') + 1),
            context: { minY, maxY: minY + height, seaLevel: definition.sea_level },
            biomeAtQuart: biomeNameAtQuart,
            vanillaData: data,
            carving: {
                isUncarvable(state) {
                    const name = stateName(state);
                    return name ? nativeTags.isBlockInTag(name, 'minecraft:uncarvable') : false;
                },
                computeSubstance(x, y, z) {
                    const lx = x - chunk.chunkX * 16, lz = z - chunk.chunkZ * 16;
                    const value = carving[(lz * 16 + lx) * height + y - minY];
                    const type = value & 15;
                    if (type === 0) return null;
                    const state = type === 1 ? blockStates['minecraft:air']
                        : type === 2 ? blockStates['minecraft:water'] : blockStates['minecraft:lava'];
                    return { state, scheduleFluidUpdate: (value & 16) !== 0 };
                },
                isFluidEmpty(state) { return stateRules.states[state]?.fluidEmpty === true; },
                isSurfaceCover(state) { return ['minecraft:grass_block', 'minecraft:mycelium'].includes(stateName(state)); },
                isDirt(state) { return stateName(state) === 'minecraft:dirt'; },
                markFluidUpdate(x, y, z) { chunk.fluidUpdates[chunk.index(x, y, z)] = 1; },
                topMaterial: ({ x, y, z, fluid }) => sampler.topMaterialAt(chunk, x, y, z, fluid),
                setBlock(x, y, z, state) {
                    chunk.setBlock(x, y, z, state);
                    if (!air.has(stateName(state)) || chunk.heightmap[z * 16 + x] !== y + 1) return;
                    let nextY = y - 1;
                    while (nextY >= minY && air.has(stateName(chunk.getBlock(x, nextY, z)))) nextY--;
                    chunk.heightmap[z * 16 + x] = nextY + 1;
                }
            }
        });
    }
    function ensureContext(parsedSeed, settings) {
        const nextContext = `${settings}:${parsedSeed}`;
        if (context === nextContext) return;
        sampler?.dispose();
        sampler = null;
        cache.clear();
        carvedCacheKeys.clear();
        decorationCache.clear();
        decorationCacheBytes = 0;
        decorationPipeline = null;
        progressiveDecorationSession = null;
        progressiveDecorationCenter = null;
        progressiveDecorationExpanded = false;
        context = null;
        const definition = data[`data/minecraft/worldgen/noise_settings/${settings}.json`];
        sampler = createNoiseTerrainSampler(kernel, parsedSeed, data, {
            settings, solidState: blockStates[definition.default_block], airState: blockStates['minecraft:air'],
            waterState: blockStates['minecraft:water'], lavaState: blockStates['minecraft:lava'],
            biomeIds, blockStates, applySurfaceRules: true, batchMaterialDensitySampling, cacheSurfaceBiomeSamples,
            experimentalScalarMemoReuse, experimentalBatchDensityQueries, excludedBiomes: EXCLUDED_WORLDGEN_BIOMES
        });
        context = nextContext;
    }
    function rememberDecoration(key, result) {
        if (!maxCachedDecorationBytes) return;
        const saved = structuredClone(result);
        const bytes = saved.chunks.reduce((size, chunk) => size + chunk.blocks.byteLength + chunk.biomes.byteLength + chunk.heightmap.byteLength + (chunk.fluidUpdates?.byteLength ?? 0), 0);
        if (bytes > maxCachedDecorationBytes) return;
        if (decorationCache.has(key)) {
            decorationCacheBytes -= decorationCache.get(key).bytes;
            decorationCache.delete(key);
        }
        decorationCache.set(key, { result: saved, bytes });
        decorationCacheBytes += bytes;
        while (decorationCacheBytes > maxCachedDecorationBytes) {
            const oldest = decorationCache.keys().next().value;
            decorationCacheBytes -= decorationCache.get(oldest).bytes;
            decorationCache.delete(oldest);
        }
    }
    let sampler, context, disposed = false;
    let progressiveDecorationSession = null, progressiveDecorationCenter = null, progressiveDecorationExpanded = false;
    return {
        biomeNames,
        generate({ seed, settings = 'overworld', coords, mode = 'terrain', profile: profiling = false }, hooks = {}) {
            const startedAt = now();
            if (disposed) throw new Error('Chunk service has been disposed');
            if (!['terrain', 'decoration_draft'].includes(mode)) throw new RangeError('Unknown vanilla generation mode');
            const parsedSeed = parseSeed(seed).toString();
            if (!['overworld', 'large_biomes', 'amplified', 'nether', 'end'].includes(settings)) throw new RangeError('Unknown vanilla noise settings');
            const maxCoordinates = mode === 'decoration_draft' ? 9 : 4;
            if (!Array.isArray(coords) || coords.length < 1 || coords.length > maxCoordinates || !coords.every(pair =>
                Array.isArray(pair) && pair.length === 2 && pair.every(value => Number.isInteger(value) && value >= -134217728 && value <= 134217726))) throw new RangeError(`Expected 1..${maxCoordinates} valid chunk coordinates`);
            const nextContext = `${settings}:${parsedSeed}`;
            ensureContext(parsedSeed, settings);
            if (mode === 'decoration_draft' && coords.some(pair => pair.some(value => value < -134217726 || value > 134217724))) throw new RangeError('Decoration neighborhood exceeds Java block coordinates');
            const decorationKey = mode === 'decoration_draft'
                ? `${nextContext}:${coords.map(pair => pair.join(',')).join(';')}` : null;
            if (decorationKey && !profiling && decorationCache.has(decorationKey)) {
                const cached = decorationCache.get(decorationKey);
                decorationCache.delete(decorationKey);
                decorationCache.set(decorationKey, cached);
                if (typeof hooks.onChunkReady === 'function') {
                    for (const chunk of cached.result.chunks) hooks.onChunkReady(structuredClone(chunk));
                }
                return { ...structuredClone(cached.result), streamingStats: { totalMs: now() - startedAt,
                    terrainHits: 0, terrainMisses: 0, terrainMs: 0, sourceExecutions: 0, sourceKeys: [], sourceMs: 0, decorationResultHit: true } };
            }
            if (mode === 'decoration_draft' && !decorationPipeline) {
                decorationPipeline = createChunkDecorationPipeline({ kernel, data, registry, biomeNames,
                    possibleBiomeOrder: biomeNames, rules: reader => {
                        const rules = createNativeTreeRules(data, registry, reader, stateRules);
                        const temperature = createBiomeTemperatureSampler(data);
                        const seaLevel = data[`data/minecraft/worldgen/noise_settings/${settings}.json`].sea_level;
                        const cold = (pos, biomePos = pos) => temperature.isColdAt(reader.biomeAtBlock(biomePos), pos.x, pos.y, pos.z, seaLevel);
                        return { ...rules, biomeInfoNoise, seaLevel, sampleNoiseProvider, sampleDualNoiseProvider,
                            shouldFreeze(pos, checkNeighbors = true, biomePos = pos) {
                                if (!cold(pos, biomePos) || pos.y < reader.minY || pos.y >= reader.maxY) return false;
                                if (reader.getBlockLight(pos) >= 10) return false;
                                const state = reader.getBlockState(pos);
                                if (state.name !== 'minecraft:water' || !rules.isFluidInTag(rules.getFluidState(pos), 'minecraft:water')) return false;
                                if (!checkNeighbors) return true;
                                return ![[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]].every(([x, z]) => {
                                    const neighbor = reader.getBlockState({ x: pos.x + x, y: pos.y, z: pos.z + z });
                                    return neighbor.name === 'minecraft:water';
                                });
                            },
                            shouldSnow(pos) {
                                const biome = data[`data/minecraft/worldgen/biome/${reader.biomeAtBlock(pos).slice(10)}.json`];
                                if (biome.has_precipitation !== true || !cold(pos) || pos.y < reader.minY || pos.y >= reader.maxY) return false;
                                if (reader.getBlockLight(pos) >= 10) return false;
                                const state = reader.getBlockState(pos);
                                if (!['minecraft:air', 'minecraft:snow'].includes(state.name)) return false;
                                return rules.canSnowSurvive(pos);
                            }
                        };
                    } });
            }
            let drafts = [];
            let chunks;
            const streamingStats = { terrainHits: 0, terrainMisses: 0, terrainMs: 0, sourceExecutions: 0, sourceKeys: [], sourceMs: 0, decorationResultHit: false };
            const trackedSample = (x, z) => {
                const hit = cache.has(`${x},${z}`), start = now(), chunk = sampleChunk(x, z);
                streamingStats[hit ? 'terrainHits' : 'terrainMisses']++;
                if (!hit) streamingStats.terrainMs += now() - start;
                return chunk;
            };
            const profile = profiling ? { terrainCacheHits: 0, terrainCacheMisses: 0, terrainGenerationMs: 0,
                terrainReadMs: 0, decorationFeatureMs: 0, decorationStages: [], regionSetupMs: 0,
                blockStateLookups: 0, blockLightQueries: 0, blockLightBuildMs: 0, blockLightVisitedBlocks: 0,
                blockWrites: 0, crossChunkBlockWrites: 0, survivalChecks: 0, surfaceBiomeQueries: 0, surfaceBiomeCacheHits: 0,
                surfaceBiomeRouterCalls: 0, experimentalSourceExecutions: 0, experimentalSourceReuses: 0,
                experimentalSourceExecutionsDeferred: 0 } : null;
            const samplerProfileStart = profile ? sampler.profileSnapshot() : null;
            if (mode === 'decoration_draft') {
                try {
                    const measuredSample = profile ? (x, z) => {
                        const hit = cache.has(`${x},${z}`), start = now();
                        const chunk = trackedSample(x, z);
                        if (hit) profile.terrainCacheHits++;
                        else {
                            profile.terrainCacheMisses++;
                            profile.terrainGenerationMs += now() - start;
                        }
                        return chunk;
                    } : trackedSample;
                    const options = {
                        sampleChunk: measuredSample,
                        onChunkReady: hooks.onChunkReady,
                        onTerrainRead: profile ? ms => { profile.terrainReadMs += ms; } : undefined,
                        decorateChunk: request => {
                            streamingStats.sourceExecutions++;
                            streamingStats.sourceKeys.push(`${request.chunkX},${request.chunkZ}`);
                            if (!profile) {
                                const start = now();
                                const result = decorationPipeline.decorate({ ...request, worldSeed: parsedSeed });
                                streamingStats.sourceMs += now() - start;
                                return result;
                            }
                            const stageProfile = { regionSetupMs: 0, blockStateLookups: 0, blockLightQueries: 0,
                                blockLightBuildMs: 0, blockLightVisitedBlocks: 0, blockWrites: 0, survivalChecks: 0,
                                crossChunkBlockWrites: 0 };
                            const start = now();
                            const report = decorationPipeline.decorate({ ...request, worldSeed: parsedSeed, profile: stageProfile });
                            const elapsed = now() - start;
                            streamingStats.sourceMs += elapsed;
                            profile.decorationFeatureMs += elapsed;
                            for (const field of REGION_PROFILE_FIELDS) profile[field] += stageProfile[field];
                            const terrainDependencies = [...(stageProfile.terrainDependencies ?? [])]
                                .map(([key, layers]) => ({ chunk: key, layers: [...layers].sort() }))
                                .sort((a, b) => a.chunk.localeCompare(b.chunk, undefined, { numeric: true }));
                            profile.decorationStages.push({ chunkX: request.chunkX, chunkZ: request.chunkZ, elapsedMs: elapsed,
                                ...stageProfile, terrainDependencies });
                            return report;
                        }
                    };
                    const isCenterExpansion = experimentalProgressiveDecorationReuse && progressiveDecorationSession &&
                        !progressiveDecorationExpanded && coords.length === 8 && coords.every(([x, z]) =>
                            Math.abs(x - progressiveDecorationCenter[0]) <= 1 && Math.abs(z - progressiveDecorationCenter[1]) <= 1 &&
                            (x !== progressiveDecorationCenter[0] || z !== progressiveDecorationCenter[1])) &&
                        new Set(coords.map(([x, z]) => `${x},${z}`)).size === 8;
                    let results;
                    if (experimentalProgressiveDecorationReuse && coords.length === 1) {
                        progressiveDecorationSession = createProgressiveDecorationSession();
                        progressiveDecorationCenter = [...coords[0]];
                        progressiveDecorationExpanded = false;
                        const [centerX, centerZ] = progressiveDecorationCenter;
                        const sourcePlanCoords = [];
                        for (let x = centerX - 1; x <= centerX + 1; x++) for (let z = centerZ - 1; z <= centerZ + 1; z++) sourcePlanCoords.push([x, z]);
                        results = generateProgressiveDecorationDraft({ ...options, coords, sourcePlanCoords,
                            executeThroughCenter: progressiveDecorationCenter, session: progressiveDecorationSession });
                        if (profile) {
                            profile.experimentalSourceExecutions = results[0].sourceExecutionsThisRequest;
                            profile.experimentalSourceExecutionsDeferred = results[0].sourceExecutionsDeferred;
                        }
                    } else if (isCenterExpansion) {
                        const [centerX, centerZ] = progressiveDecorationCenter;
                        const sourcePlanCoords = [];
                        for (let x = centerX - 1; x <= centerX + 1; x++) for (let z = centerZ - 1; z <= centerZ + 1; z++) sourcePlanCoords.push([x, z]);
                        results = generateProgressiveDecorationDraft({ ...options, coords, sourcePlanCoords, session: progressiveDecorationSession });
                        progressiveDecorationExpanded = true;
                        if (profile) {
                            profile.experimentalSourceExecutions = results[0].sourceExecutionsThisRequest;
                            profile.experimentalSourceReuses = results[0].sourceReusesThisRequest;
                            profile.experimentalSourceExecutionsDeferred = results[0].sourceExecutionsDeferred;
                        }
                    } else {
                        if (experimentalProgressiveDecorationReuse) {
                            progressiveDecorationSession = null;
                            progressiveDecorationCenter = null;
                            progressiveDecorationExpanded = false;
                        }
                        const span = axis => Math.max(...coords.map(pair => pair[axis])) - Math.min(...coords.map(pair => pair[axis]));
                        results = coords.length > 1 && span(0) <= 2 && span(1) <= 2
                            ? generateDecorationDraftBatch({ ...options, coords })
                            : coords.map(([chunkX, chunkZ]) => generateDecorationDraft({ ...options, chunkX, chunkZ }));
                    }
                    chunks = results.map(result => result.chunk);
                    drafts = results.map((result, index) => ({ chunkX: coords[index][0], chunkZ: coords[index][1], reports: result.reports,
                        publication: result.publication, order: result.order, nativeOrderVerified: result.nativeOrderVerified }));
                } catch (error) {
                    throw new Error(`Decoration draft ${coords.map(pair => pair.join(',')).join(';')}: ${error.message}`, { cause: error });
                }
            } else {
                chunks = coords.map(([x, z]) => structuredClone(trackedSample(x, z)));
            }
            if (profile) {
                const current = sampler.profileSnapshot();
                for (const field of ['surfaceBiomeQueries', 'surfaceBiomeCacheHits', 'surfaceBiomeRouterCalls']) {
                    profile[field] = current[field] - samplerProfileStart[field];
                }
            }
            const result = {
                format: 'breakmine:vanilla-generation-v1', seed: parsedSeed, settings,
                stages: ['noise', 'aquifer', 'biomes', 'material_rules', ...(enableCarvers && settings !== 'end' ? ['carvers'] : [])],
                pendingStages: [...(enableCarvers || settings === 'end' ? [] : ['carvers']), 'decoration', 'structures', 'lighting'],
                playable: false, biomeNames, chunks,
                streamingStats: { ...streamingStats, totalMs: now() - startedAt },
                ...(mode === 'decoration_draft' ? { terrainCacheKeys: [...cache.keys()] } : {}),
                ...(mode === 'decoration_draft' ? { decorationDraft: drafts } : {}),
                ...(profile ? { profile: { ...profile, totalMs: now() - startedAt } } : {})
            };
            if (decorationKey && !profiling) rememberDecoration(decorationKey, result);
            return result;
        },
        preloadTerrainChunks({ seed, settings = 'overworld', chunks }) {
            if (disposed) throw new Error('Chunk service has been disposed');
            const parsedSeed = parseSeed(seed).toString();
            if (!['overworld', 'large_biomes', 'amplified', 'nether', 'end'].includes(settings)) throw new RangeError('Unknown vanilla noise settings');
            if (!Array.isArray(chunks) || chunks.length < 1 || chunks.length > 49) throw new RangeError('Expected 1..49 terrain chunks');
            ensureContext(parsedSeed, settings);
            const definition = data[`data/minecraft/worldgen/noise_settings/${settings}.json`];
            for (const payload of chunks) {
                const chunk = readVanillaChunk(payload);
                if (chunk.minY !== definition.noise.min_y || chunk.height !== definition.noise.height) throw new Error('Preloaded terrain chunk has incompatible dimension bounds');
                const key = `${chunk.chunkX},${chunk.chunkZ}`;
                cache.delete(key);
                carvedCacheKeys.delete(key);
                if (maxCachedChunks) cache.set(key, chunk.serialize());
            }
            while (cache.size > maxCachedChunks) {
                const oldest = cache.keys().next().value;
                cache.delete(oldest);
                carvedCacheKeys.delete(oldest);
            }
            return chunks.length;
        },
        experimentalDecorationSnapshot(coords) {
            if (!experimentalProgressiveDecorationReuse || !progressiveDecorationSession || !progressiveDecorationExpanded) {
                throw new Error('No completed experimental progressive decoration session');
            }
            return coords.map(([x, z]) => {
                const chunk = progressiveDecorationSession.chunks.get(`${x},${z}`);
                if (!chunk) throw new Error(`Experimental decoration session does not contain ${x},${z}`);
                return chunk.serialize();
            });
        },
        terrainCacheKeys() { return [...cache.keys()]; },
        dispose() {
            if (disposed) return;
            disposed = true;
            sampler?.dispose();
            cache.clear();
            decorationCache.clear();
            decorationCacheBytes = 0;
            for (const noise of blockStateNoises.values()) noise.dispose();
            blockStateNoises.clear();
            kernel.dispose();
        }
    };
}

export function chunkTransferList(result) {
    return [...new Set(result.chunks.flatMap(chunk =>
        [chunk.blocks.buffer, chunk.biomes.buffer, chunk.heightmap.buffer, ...(chunk.fluidUpdates ? [chunk.fluidUpdates.buffer] : [])]))];
}
