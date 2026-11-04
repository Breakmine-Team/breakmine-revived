import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createWorldgenFeatureRegistry } from '../feature-resources.mjs';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { VanillaChunk } from '../chunk.mjs';
import { placeVanillaPlacedFeature, placeVanillaPlacedFeatureById, SUPPORTED_PLACEMENT_MODIFIERS } from '../placed-features.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));

function queuedRandom(values) {
    const draws = [];
    return {
        draws,
        nextInt(bound) {
            draws.push(bound);
            const value = values.shift();
            if (!Number.isInteger(value) || value < 0 || value >= bound) throw new RangeError(`Invalid test draw for bound ${bound}`);
            return value;
        },
        nextFloat() { return 0; },
        nextGaussian() { return 0; }
    };
}

test('all placement modifier types in the pinned JAR have an execution path', () => {
    const actual = new Set();
    const visit = value => {
        if (!value || typeof value !== 'object') return;
        for (const [key, child] of Object.entries(value)) {
            if (key === 'placement' || key === 'placements') for (const modifier of child) actual.add(modifier.type);
            visit(child);
        }
    };
    for (const [path, value] of Object.entries(data)) if (/worldgen\/(placed_feature|feature)\//.test(path)) visit(value);
    assert.deepEqual([...actual].sort(), [...SUPPORTED_PLACEMENT_MODIFIERS].sort());
});

test('placed feature traversal preserves JAR depth-first modifier order and shared RNG stream', () => {
    const random = queuedRandom([0, 1, 1, 0, 1]);
    const seen = [];
    const result = placeVanillaPlacedFeature({
        name: 'minecraft:test', featureName: 'minecraft:test_configured', feature: { type: 'minecraft:test' },
        placement: [
            { type: 'minecraft:fixed_placement', positions: [[1, 10, 1], [2, 10, 2]] },
            { type: 'minecraft:count', count: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 2 } },
            { type: 'minecraft:offset', x: { type: 'minecraft:uniform', min_inclusive: 0, max_inclusive: 1 }, y: 0, z: 0 }
        ]
    }, { x: 0, y: 0, z: 0 }, {
        random,
        placeFeature: (_id, _feature, pos) => { seen.push(pos); return true; }
    });
    assert.deepEqual(random.draws, [2, 2, 2, 2, 2]);
    assert.deepEqual(seen, [
        { x: 2, y: 10, z: 1 },
        { x: 2, y: 10, z: 2 },
        { x: 3, y: 10, z: 2 }
    ]);
    assert.deepEqual(result, { name: 'minecraft:test', attempted: 3, succeeded: true });
});

test('environment scans stop at build-height bounds and inspect at most max_steps positions', () => {
    const placedFeature = {
        feature: { type: 'minecraft:test' },
        placement: [{
            type: 'minecraft:environment_scan', direction_of_search: 'up', max_steps: 3,
            allowed_search_condition: { type: 'minecraft:matching_block_tag', tag: 'minecraft:air' },
            target_condition: { type: 'minecraft:matching_block_tag', tag: 'minecraft:stone' }
        }]
    };
    const checkedTargets = [];
    const scan = startY => placeVanillaPlacedFeature(placedFeature, { x: 0, y: startY, z: 0 }, {
        random: queuedRandom([]),
        context: {
            minY: 0,
            maxY: 320,
            testBlockPredicate(predicate, pos) {
                assert.ok(pos.y >= 0 && pos.y < 320, `predicate checked out-of-range y=${pos.y}`);
                if (predicate.tag === 'minecraft:stone') {
                    checkedTargets.push(pos.y);
                    return pos.y === 12;
                }
                return true;
            }
        },
        placeFeature: () => true
    });

    assert.deepEqual(scan(10), { name: '<inline-feature>', attempted: 1, succeeded: true });
    assert.deepEqual(checkedTargets, [10, 11, 12]);
    checkedTargets.length = 0;
    assert.deepEqual(scan(319), { name: '<inline-feature>', attempted: 0, succeeded: false });
    assert.deepEqual(checkedTargets, [319]);
});

test('actual 26.3 flower runs placement, weighted state provider, survival and chunk writes', () => {
    const registry = createWorldgenFeatureRegistry(data);
    const chunk = new VanillaChunk(0, 0);
    let writes = 0;
    const configuredFeaturePlacer = createConfiguredFeaturePlacer(data, {
        stateIdFor: () => 812,
        canSurvive: () => true,
        setBlock: (state, pos, flags) => {
            assert.equal(flags, 2);
            chunk.setBlock(pos.x, pos.y, pos.z, state.stateId);
            writes++;
        }
    });
    const result = placeVanillaPlacedFeatureById(registry, 'minecraft:flower_default', { x: 4, y: 0, z: 8 }, {
        random: queuedRandom(Array(1024).fill(0)),
        context: {
            minY: -64,
            maxY: 320,
            getHeight: (_type, x, z) => { assert.ok(Number.isInteger(x) && Number.isInteger(z)); return 70; },
            isBiomeFeature: placed => placed.name === 'minecraft:flower_default',
            testBlockPredicate: predicate => predicate.type === 'minecraft:matching_block_tag'
        },
        placeFeature: configuredFeaturePlacer
    });
    assert.equal(result.attempted, 64);
    assert.equal(result.succeeded, true);
    assert.equal(writes, 64);
    assert.equal(chunk.getBlock(4, 70, 8), 812);
});

test('placed features fail closed on missing adapters and unsupported modifiers', () => {
    const feature = { feature: { type: 'minecraft:test' }, placement: [{ type: 'minecraft:biome' }] };
    assert.throws(() => placeVanillaPlacedFeature(feature, { x: 0, y: 0, z: 0 }, {
        random: queuedRandom([]), placeFeature() {}
    }), /isBiomeFeature/);
    assert.throws(() => placeVanillaPlacedFeature({ ...feature, placement: [{ type: 'minecraft:made_up' }] }, { x: 0, y: 0, z: 0 }, {
        random: queuedRandom([]), placeFeature() {}
    }), /Unsupported vanilla placement modifier/);
});
