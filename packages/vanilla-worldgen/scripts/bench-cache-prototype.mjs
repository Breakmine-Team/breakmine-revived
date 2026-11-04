import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel } from '../runtime.mjs';
import { createNoiseTerrainSampler } from '../chunk.mjs';

const dir = new URL('../generated/', import.meta.url);
const data = JSON.parse(await readFile(new URL('vanilla-data.json', dir), 'utf8'));
const climate = JSON.parse(await readFile(new URL('climate.json', dir), 'utf8'));
const prototypeBytes = await readFile(new URL('worldgen-cache-prototype.wasm', dir));
const biomeNames = [...new Set(Object.values(climate.presets).flatMap(preset => preset.biomes))];
const biomeIds = Object.fromEntries(biomeNames.map((name, index) => [name, index + 1]));
const seed = 6888349110149677383n;
const coords25 = Array.from({ length: 25 }, (_, i) => [i % 5 - 2, Math.floor(i / 5) - 2]);
const coords41 = [];
for (let z = -4; z <= 4; z++) for (let x = -4; x <= 4; x++) if (Math.abs(x) + Math.abs(z) <= 4) coords41.push([x, z]);
const hashChunk = chunk => {
    const hash = createHash('sha256');
    for (const key of ['blocks', 'biomes', 'heightmap', 'fluidUpdates']) {
        const value = chunk[key];
        hash.update(key);
        if (value) hash.update(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
        else hash.update('absent');
    }
    return hash.digest('hex');
};
const percentile = (values, fraction) => {
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * fraction;
    const low = Math.floor(index), high = Math.ceil(index);
    return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
};
async function create(mode, { profile = false } = {}) {
    const kernel = await createVanillaKernel(prototypeBytes, climate);
    const sampler = createNoiseTerrainSampler(kernel, seed, data, {
        settings: 'overworld', solidState: 1, airState: 0, waterState: 2, lavaState: 3, biomeIds,
        cacheWrapperPrototype: mode === 'prototype', cacheWrapperProfile: profile
    });
    return { sampler, dispose() { sampler.dispose(); kernel.dispose(); } };
}

const results = {};
for (const mode of ['baseline', 'prototype']) results[mode] = { chunkTimes: [], total41Ms: [], hashes25: {}, hashes41: {} };
for (let round = 0; round < 3; round++) {
    const order = round % 2 ? ['prototype', 'baseline'] : ['baseline', 'prototype'];
    for (const mode of order) {
        const instance = await create(mode);
        try {
            for (const [x, z] of [[0, 0], [1, 0]]) instance.sampler.sampleChunk(x, z);
            for (const [x, z] of coords25) {
                const start = performance.now();
                const chunk = instance.sampler.sampleChunk(x, z);
                results[mode].chunkTimes.push(performance.now() - start);
                results[mode].hashes25[`${x},${z}`] = hashChunk(chunk);
            }
            const totalStart = performance.now();
            for (const [x, z] of coords41) results[mode].hashes41[`${x},${z}`] = hashChunk(instance.sampler.sampleChunk(x, z));
            results[mode].total41Ms.push(performance.now() - totalStart);
        } finally { instance.dispose(); }
    }
}
for (const mode of ['baseline', 'prototype']) {
    const record = results[mode];
    record.chunkMs = { p10: percentile(record.chunkTimes, .1), median: percentile(record.chunkTimes, .5), p90: percentile(record.chunkTimes, .9) };
    record.total41MedianMs = percentile(record.total41Ms, .5);
    delete record.chunkTimes;
}
async function profile(mode) {
    const instance = await create(mode, { profile: true });
    try {
        const materialRoots = [...new Set(instance.sampler.profileSnapshot().densityCache.wrappers
            .filter(wrapper => wrapper.root.startsWith('material:')).map(wrapper => wrapper.root.slice('material:'.length)))];
        instance.sampler.cacheResetStats();
        for (const [x, z] of coords25) {
            instance.sampler.sampleChunk(x, z);
            for (const root of materialRoots) instance.sampler.sampleMaterialDensity(root, x * 16 + 8, 40, z * 16 + 8);
        }
        const profile25 = instance.sampler.profileSnapshot();
        instance.sampler.cacheResetStats();
        for (const [x, z] of coords41) {
            instance.sampler.sampleChunk(x, z);
            for (const root of materialRoots) instance.sampler.sampleMaterialDensity(root, x * 16 + 8, 40, z * 16 + 8);
        }
        return { profile25, profile41: instance.sampler.profileSnapshot() };
    } finally { instance.dispose(); }
}
const simulated = await profile('simulate');
const enabled = await profile('prototype');
const statShape = snapshot => ['densityCache', 'climateCache'].map(key => snapshot[key].wrappers.map(({ valueAccesses, valueHits, volumeAccesses, volumeHits, avoidedNodeEvaluations }) =>
    [valueAccesses, valueHits, volumeAccesses, volumeHits, avoidedNodeEvaluations]));
const simulationParity = JSON.stringify([statShape(simulated.profile25), statShape(simulated.profile41)]) ===
    JSON.stringify([statShape(enabled.profile25), statShape(enabled.profile41)]);
const mismatch = (left, right) => Object.keys(left).filter(key => left[key] !== right[key]);
const hash25Mismatch = mismatch(results.baseline.hashes25, results.prototype.hashes25);
const hash41Mismatch = mismatch(results.baseline.hashes41, results.prototype.hashes41);
if (hash25Mismatch.length || hash41Mismatch.length) throw new Error(`Cache prototype parity failed: 25=${hash25Mismatch.join(' ')}; 41=${hash41Mismatch.join(' ')}`);
if (!simulationParity) throw new Error('Cache shadow simulation counters differ from enabled cache prototype');
console.log(JSON.stringify({ seed: seed.toString(), chunks25: coords25.length, dependencies41: coords41.length,
    timingRuns: 3,
    result25: { baseline: results.baseline.chunkMs, prototype: results.prototype.chunkMs },
    total41Ms: { baseline: results.baseline.total41MedianMs, prototype: results.prototype.total41MedianMs,
        baselineRuns: results.baseline.total41Ms, prototypeRuns: results.prototype.total41Ms },
    parity: { chunks25: hash25Mismatch, chunks41: hash41Mismatch, exact: hash25Mismatch.length === 0 && hash41Mismatch.length === 0 },
    cacheSimulationMatchesEnabledPrototype: simulationParity,
    profile25: simulated.profile25, profile41: simulated.profile41 }, null, 2));
