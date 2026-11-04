import { applyCarvingMask, CarvingMask, createCarverOutput, createWorldgenCarvingMask } from './carving-mask.mjs';
import { carveBiomeCarvers } from './carvers.mjs';

const resourceCache = new WeakMap();

function resourceId(namespace, path) { return `${namespace}:${path}`; }

export function createVanillaCarverResources(vanillaData) {
    if (!vanillaData || typeof vanillaData !== 'object' || Array.isArray(vanillaData)) throw new TypeError('Expected imported vanilla data resources');
    const cached = resourceCache.get(vanillaData);
    if (cached) return cached;
    const carverConfigs = Object.create(null);
    const biomeData = Object.create(null);
    for (const [resourcePath, value] of Object.entries(vanillaData)) {
        let match = /^data\/([^/]+)\/worldgen\/carver\/(.+)\.json$/.exec(resourcePath);
        if (match) carverConfigs[resourceId(match[1], match[2])] = value;
        match = /^data\/([^/]+)\/worldgen\/biome\/(.+)\.json$/.exec(resourcePath);
        if (match) biomeData[resourceId(match[1], match[2])] = value;
    }
    if (Object.keys(carverConfigs).length === 0) throw new Error('Imported data has no worldgen carver resources');
    Object.freeze(carverConfigs);
    const resources = Object.freeze({
        carverConfigs,
        carversForBiome(biome) {
            const resource = biomeData[biome];
            if (!resource) throw new Error(`Missing vanilla biome resource: ${biome}`);
            if (Array.isArray(resource.carvers)) return resource.carvers;
            if (typeof resource.carvers === 'string' && carverConfigs[resource.carvers]) return [resource.carvers];
            throw new Error(`Biome ${biome} has no resolvable ordered carver list`);
        }
    });
    resourceCache.set(vanillaData, resources);
    return resources;
}

export function carveVanillaChunk(chunk, {
    seed, context, biomeAtQuart, vanillaData, carving,
    upgrading = false, filter
}) {
    if (!chunk || !Number.isInteger(chunk.chunkX) || !Number.isInteger(chunk.chunkZ)) throw new TypeError('Expected a chunk with integer coordinates');
    if (!context || context.minY !== chunk.minY || context.maxY !== chunk.minY + chunk.height) throw new RangeError('Generation bounds must match the target chunk');
    if (typeof biomeAtQuart !== 'function') throw new TypeError('Expected a quart-biome sampler');
    if (filter !== undefined && typeof filter !== 'function') throw new TypeError('Expected a carving filter callback');
    if (!carving || typeof carving !== 'object') throw new TypeError('Expected carving block-state adapters');
    for (const required of ['isUncarvable', 'computeSubstance', 'isFluidEmpty', 'isSurfaceCover', 'isDirt']) {
        if (typeof carving[required] !== 'function') throw new TypeError(`Missing carving adapter: ${required}`);
    }

    const resources = createVanillaCarverResources(vanillaData);
    const mask = createWorldgenCarvingMask(context, upgrading);
    const output = createCarverOutput(chunk, mask);
    const scheduled = carveBiomeCarvers(output, {
        seed, context, biomeAtQuart,
        carversForBiome: resources.carversForBiome,
        carverConfigs: resources.carverConfigs,
        carve: (x, y, z) => mask.carve(x, y, z)
    });
    const applied = applyCarvingMask(chunk, mask, { ...carving, ...(filter ? { filter } : {}) });
    return { mask, scheduled, applied };
}
