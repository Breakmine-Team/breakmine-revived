import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel } from '../runtime.mjs';

const root = new URL('../generated/', import.meta.url);
const [wasmBytes, climate] = await Promise.all([
    readFile(new URL('worldgen-cache-prototype.wasm', root)),
    readFile(new URL('climate.json', root)).then(bytes => JSON.parse(bytes))
]);
const kernel = await createVanillaKernel(wasmBytes, climate);
const gradient = { type: 'minecraft:gradient', axis: 'x', from_coordinate: 0, to_coordinate: 8, from_value: 0, to_value: 8 };
const graph = kernel.density(123n, {}, { value: { type: 'minecraft:cache', input: gradient } },
    { cacheWrapperPrototype: true, cacheWrapperProfile: true });
try {
    graph.cacheBeginContext(); graph.cacheResetStats();
    const scalar = [graph.sample('value', 1, 0, 0), graph.sample('value', 1, 0, 0), graph.sample('value', 1, 0, 0)];
    assert.deepEqual(scalar, [1, 1, 1]);
    assert.equal(graph.cacheStats().wrappers[0].hits, 2, 'fresh scalar memo, retained sampler cache cell');

    graph.cacheBeginContext(); graph.cacheResetStats();
    const firstVolume = graph.sampleVolume('value', 0, 0, 0, 3, 1, 1);
    const repeatedVolume = graph.sampleVolume('value', 0, 0, 0, 3, 1, 1);
    assert.deepEqual(firstVolume, repeatedVolume);
    assert.equal(graph.cacheStats().wrappers[0].hits, 1, 'same DensityVolume reuses one stored volume');
    assert.equal(graph.sample('value', 1, 0, 0), 1, 'scalar sample reads an entry in the saved volume');
    assert.equal(graph.cacheStats().wrappers[0].hits, 2);

    const interpolated = kernel.density(123n, {}, { value: { type: 'minecraft:interpolated', cell_size_xz: 4, cell_size_y: 4,
        input: { type: 'minecraft:cache', input: gradient } } }, { cacheWrapperPrototype: true, cacheWrapperProfile: true });
    try {
        const a = interpolated.sampleVolume('value', 0, 0, 0, 5, 5, 5);
        const b = interpolated.sampleVolume('value', 0, 0, 0, 5, 5, 5);
        assert.deepEqual(a, b);
        assert.ok(interpolated.cacheStats().wrappers[0].accesses >= 2);
        assert.ok(interpolated.cacheStats().wrappers[0].hits >= 1, 'interpolation reuses exact matching coarse volume');
    } finally { interpolated.dispose(); }
    graph.cacheBeginContext(); graph.cacheResetStats();
    graph.sample('value', 1, 0, 0);
    assert.equal(graph.cacheStats().wrappers[0].hits, 0, 'new sampler context starts empty');
    console.log(JSON.stringify({ scalarFreshMemoHits: 2, volumeRepeatedRequestHit: true,
        scalarReadFromVolumeHit: true, interpolationVolumeReuse: true, contextResetMiss: true }));
} finally { graph.dispose(); kernel.dispose(); }
