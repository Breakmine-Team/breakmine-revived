import { parseSeed } from './runtime.mjs';
import { placeVanillaPlacedFeatureById } from './placed-features.mjs';

const BIOME_PATH = 'data/minecraft/worldgen/biome/';

function resourceId(value) {
    if (typeof value !== 'string' || value.length === 0) throw new TypeError('Expected a worldgen resource identifier');
    return value.includes(':') ? value : `minecraft:${value}`;
}

function biomeResource(data, id) {
    const name = resourceId(id);
    if (!name.startsWith('minecraft:')) throw new Error(`Unsupported biome namespace: ${name}`);
    const resource = data[`${BIOME_PATH}${name.slice('minecraft:'.length)}.json`];
    if (!resource || !Array.isArray(resource.features)) throw new Error(`Missing biome generation settings: ${name}`);
    return resource;
}

function compare(a, b) {
    return a.step - b.step || a.index - b.index;
}

function sortBiomeFeatures(data, biomeIds, allowCycles) {
    const featureIndices = new Map();
    const biomeStages = new Map();
    let nextIndex = 0;
    let stepCount = 0;

    for (const id of biomeIds) {
        const biome = biomeResource(data, id);
        const stages = biome.features.map((stage, step) => {
            if (!Array.isArray(stage)) throw new TypeError(`Malformed feature step ${step} in ${id}`);
            stepCount = Math.max(stepCount, step + 1);
            return stage.map(featureId => {
                const name = resourceId(featureId);
                if (!name.startsWith('minecraft:')) throw new Error(`Unsupported placed-feature namespace: ${name}`);
                const path = `data/minecraft/worldgen/placed_feature/${name.slice('minecraft:'.length)}.json`;
                if (!data[path]) throw new Error(`Missing vanilla placed feature: ${name}`);
                if (!featureIndices.has(name)) featureIndices.set(name, nextIndex++);
                return name;
            });
        });
        biomeStages.set(id, stages);
    }

    const verticesByStep = Array.from({ length: stepCount }, () => new Map());
    for (const stages of biomeStages.values()) {
        for (let step = 0; step < stages.length; step++) {
            const ordered = stages[step].map(name => {
                let vertex = verticesByStep[step].get(name);
                if (!vertex) {
                    vertex = { name, index: featureIndices.get(name), step };
                    verticesByStep[step].set(name, vertex);
                }
                return vertex;
            });
            for (let i = 0; i + 1 < ordered.length; i++) {
                const from = ordered[i], to = ordered[i + 1];
                (from.edges ||= new Set()).add(to);
            }
        }
    }

    const sort = () => {
        const graphVertices = verticesByStep.flatMap(stage => [...stage.values()]).sort(compare);
        const outgoing = new Map(graphVertices.map(vertex => [vertex, [...(vertex.edges || [])].sort(compare)]));
        const visited = new Set();
        const active = new Set();
        const finished = [];
        const visit = vertex => {
            if (visited.has(vertex)) return true;
            if (active.has(vertex)) return false;
            active.add(vertex);
            for (const neighbor of outgoing.get(vertex)) if (!visit(neighbor)) return false;
            active.delete(vertex);
            visited.add(vertex);
            finished.push(vertex);
            return true;
        };
        for (const vertex of graphVertices) if (!visit(vertex)) return null;
        finished.reverse();
        const stages = Array.from({ length: stepCount }, () => []);
        for (const vertex of finished) stages[vertex.step].push(vertex.name);
        return stages;
    };

    const sorted = sort();
    const droppedBiomes = [];
    if (!sorted) {
        if (!allowCycles) throw new Error('Feature order cycle found');
        const included = [...biomeIds];
        for (const biomeId of biomeIds) {
            included.splice(included.indexOf(biomeId), 1);
            let candidate;
            try { candidate = sortBiomeFeatures(data, [...new Set(included)], false); }
            catch (error) {
                if (error.message !== 'Feature order cycle found') throw error;
            }
            if (candidate) {
                droppedBiomes.push(biomeId);
                return { ...candidate, droppedBiomes: [...droppedBiomes, ...candidate.droppedBiomes] };
            }
            droppedBiomes.push(biomeId);
        }
        throw new Error(`Vanilla feature ordering has an unresolved cycle after dropping: ${droppedBiomes.join(', ')}`);
    }

    const indicesByStepAndBiome = new Map();
    for (const [biomeId, stages] of biomeStages) {
        for (let step = 0; step < stages.length; step++) {
            indicesByStepAndBiome.set(`${step}\0${biomeId}`, new Set(stages[step].map(name => name)));
        }
    }
    return { stages: sorted, biomeStages, indicesByStepAndBiome, droppedBiomes, featureCount: featureIndices.size };
}

export function createBiomeFeatureSorter(data, biomeOrder, { allowCycles = true } = {}) {
    if (!Array.isArray(biomeOrder) || biomeOrder.length === 0) throw new TypeError('Expected the biome source possible-biome order');
    const ids = [...new Set(biomeOrder.map(resourceId))];
    const result = sortBiomeFeatures(data, ids, allowCycles);
    return Object.freeze({
        biomeOrder: Object.freeze(ids),
        stages: Object.freeze(result.stages.map(stage => Object.freeze(stage))),
        biomeStages: result.biomeStages,
        featureCount: result.featureCount,
        droppedBiomes: Object.freeze(result.droppedBiomes),
        featuresForBiomeStep(biome, step) { return result.indicesByStepAndBiome.get(`${step}\0${resourceId(biome)}`) || new Set(); }
    });
}

export function getDecorationSeed(kernel, worldSeed, blockX, blockZ) {
    const seed = parseSeed(worldSeed);
    if (![blockX, blockZ].every(Number.isInteger)) throw new TypeError('Decoration origin must use integer block coordinates');
    const random = kernel.random(seed);
    try {
        const xMultiplier = random.nextLong() | 1n;
        const zMultiplier = random.nextLong() | 1n;
        return BigInt.asIntN(64, (BigInt(blockX) * xMultiplier + BigInt(blockZ) * zMultiplier) ^ seed);
    } finally { random.dispose(); }
}

export function collectDecorationBiomes(chunkX, chunkZ, biomesInChunk) {
    if (![chunkX, chunkZ].every(Number.isInteger)) throw new TypeError('Chunk coordinates must be integers');
    if (typeof biomesInChunk !== 'function') throw new TypeError('Expected biomesInChunk(chunkX, chunkZ)');
    const unique = new Set();
    for (let z = chunkZ - 1; z <= chunkZ + 1; z++) {
        for (let x = chunkX - 1; x <= chunkX + 1; x++) {
            const biomes = biomesInChunk(x, z);
            if (!biomes || typeof biomes[Symbol.iterator] !== 'function') throw new TypeError(`Chunk ${x},${z} must provide its biome palette`);
            for (const biome of biomes) unique.add(resourceId(biome));
        }
    }
    return [...unique];
}

export function decorateVanillaChunk({
    kernel,
    worldSeed,
    chunkX,
    chunkZ,
    neighborBiomeIds,
    sorter,
    featureRegistry,
    context,
    placeFeature,
    biomeAtBlock
}) {
    if (!kernel || typeof kernel.random !== 'function') throw new TypeError('Chunk decoration requires the vanilla random kernel');
    if (![chunkX, chunkZ].every(Number.isInteger)) throw new TypeError('Chunk coordinates must be integers');
    if (!Array.isArray(neighborBiomeIds) || !neighborBiomeIds.length) throw new TypeError('Expected biome IDs gathered from the 3×3 neighboring chunks');
    if (!sorter || !Array.isArray(sorter.stages)) throw new TypeError('Expected a vanilla biome feature sorter');
    if (typeof biomeAtBlock !== 'function') throw new TypeError('Chunk decoration requires biomeAtBlock(position) for the placed-feature biome check');
    if (typeof placeFeature !== 'function') throw new TypeError('Chunk decoration requires the configured-feature placer');
    const visibleBiomes = new Set(neighborBiomeIds.map(resourceId));
    for (const id of visibleBiomes) if (!sorter.biomeOrder.includes(id)) throw new Error(`Biome is absent from the sorter possible-biome order: ${id}`);

    const origin = { x: chunkX * 16, y: context?.minY, z: chunkZ * 16 };
    if (!Number.isInteger(origin.y)) throw new TypeError('Chunk decoration context requires minY');
    const decorationSeed = getDecorationSeed(kernel, worldSeed, origin.x, origin.z);
    const results = [];
    for (let step = 0; step < sorter.stages.length; step++) {
        const selected = new Set();
        for (const biome of visibleBiomes) for (const feature of sorter.featuresForBiomeStep(biome, step)) selected.add(feature);
        for (let index = 0; index < sorter.stages[step].length; index++) {
            const id = sorter.stages[step][index];
            if (!selected.has(id)) continue;
            const featureSeed = BigInt.asIntN(64, decorationSeed + BigInt(index) + BigInt(Math.imul(step, 10000)));
            const random = kernel.random(featureSeed);
            try {
                const biomeContext = {
                    ...context,
                    isBiomeFeature(placedFeature, position) {
                        const biomeId = resourceId(biomeAtBlock(position));
                        return sorter.biomeStages.get(biomeId)?.some(stage => stage.includes(placedFeature.name)) || false;
                    }
                };
                results.push({ step, index, id, result: placeVanillaPlacedFeatureById(featureRegistry, id, origin, {
                    random, context: biomeContext, placeFeature, biomeCheck: true
                }) });
            } catch (error) {
                throw new Error(`Feature ${id} (step ${step}, index ${index}): ${error.message}`, { cause: error });
            } finally { random.dispose(); }
        }
    }
    return { decorationSeed, origin, results };
}
