import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createVanillaKernel } from '../runtime.mjs';
import { createConfiguredFeaturePlacer, createBlockStateProviderSampler } from '../features.mjs';
import { placeGeode } from '../geode-feature.mjs';
import { placeMultifaceGrowth, createMultifaceSpreader } from '../multiface-growth-feature.mjs';
import { placeDungeonFeature, assignContainerLoot, reorientChest } from '../dungeon-features.mjs';
import { placeEndSpike, endSpikesForSeed } from '../end-spike-feature.mjs';
import { createJavaLegacyRandom, shuffled, worldSeed } from '../java-legacy-random.mjs';
import { STRUCTURE_FEATURE_MODES, structureFeature, runStructureFixture, createStructureFixtureWorld, structureDefaultState } from './structure-feature-fixtures.mjs';

const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
const reference = JSON.parse(await readFile(new URL('../generated/structure-oracle.json', import.meta.url), 'utf8'));
const origin = { x: 0, y: 20, z: 0 };
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
const noRandom = Object.fromEntries(['nextInt', 'nextFloat', 'nextDouble', 'nextLong'].map(name => [name, () => assert.fail(`Unexpected ${name}`)]));
async function withKernel(fn) {
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try { await fn(kernel); } finally { kernel.dispose(); }
}
async function fixture(mode, seed = '0', feature) {
    let result;
    await withKernel(kernel => { const random = kernel.random(seed); try { result = runStructureFixture(mode, random, seed, feature); } finally { random.dispose(); } });
    return result;
}
function geodeOptions(w, random) {
    return { ...w.options, sampleState: createBlockStateProviderSampler(data, { stateIdFor: () => 1, random, context: w.context }).sample };
}

test('world seeds preserve signed 64-bit values and reject lossy or absent seeds', () => {
    assert.equal(worldSeed('18446744073709551615'), -1n);
    assert.equal(worldSeed(-91), -91n);
    for (const value of [undefined, null, 1.5, Number.MAX_SAFE_INTEGER + 1, '1.2', {}, '']) assert.throws(() => worldSeed(value), TypeError);
});

test('Java legacy RNG follows signed-low-word longs and bounded rejection for six JAR seeds', () => {
    for (const entry of reference.cases) {
        const random = createJavaLegacyRandom(entry.seed);
        for (const draw of entry.draws) assert.deepEqual([String(random.nextLong()), random.nextInt(3), random.nextInt(1073741825), random.nextFloat(), random.nextDouble()], draw);
    }
    assert.equal(createJavaLegacyRandom('0').nextLong(), -4962768465676381896n);
    assert.throws(() => createJavaLegacyRandom('0').nextInt(0), RangeError);
});

test('shuffling copies its input and consumes descending Fisher-Yates bounds', () => {
    const bounds = [], values = [0, 1, 2, 3];
    assert.deepEqual(shuffled(values, { nextInt: n => { bounds.push(n); return 0; } }), [1, 2, 3, 0]);
    assert.deepEqual(bounds, [4, 3, 2]); assert.deepEqual(values, [0, 1, 2, 3]);
    assert.deepEqual(shuffled([], noRandom), []);
});

test('legacy positional WASM NormalNoise matches JAR float bits without consuming feature RNG', async () => {
    await withKernel(kernel => {
        const view = new DataView(new ArrayBuffer(4));
        for (const entry of reference.cases) {
            const random = kernel.random(entry.seed), control = kernel.random(entry.seed);
            try {
                for (const definition of entry.noise) {
                    const noise = random.normalNoise(definition.parameters, entry.seed, true);
                    try { for (const sample of definition.values) {
                        view.setFloat32(0, noise.sample(...sample.position)); assert.equal(view.getInt32(0), sample.bits);
                    } } finally { noise.dispose(); }
                }
                assert.equal(random.nextLong(), control.nextLong());
                assert.throws(() => random.normalNoise({ base_octave: -4 }, undefined, true), /seed/);
            } finally { random.dispose(); control.dispose(); }
        }
    });
});

test('all ten seeded End spikes match JAR layout, height, radius and guarded rank', () => {
    for (const entry of reference.cases) assert.deepEqual(endSpikesForSeed(entry.seed), entry.spikes);
    const spikes = endSpikesForSeed('0');
    assert.equal(new Set(spikes.map(s => s.height)).size, 10);
    assert.equal(spikes.filter(s => s.guarded).length, 2);
    assert.deepEqual(spikes.map(s => [s.centerX, s.centerZ]), [[42, 0], [33, 24], [12, 39], [-13, 39], [-34, 24], [-42, -1], [-34, -25], [-13, -40], [12, -40], [33, -25]]);
});

test('geodes generate all four shell materials and use flag-2 safe writes', async () => {
    const result = await fixture('geode');
    const names = new Set(result.writes.map(v => v.name));
    for (const name of ['air', 'amethyst_block', 'budding_amethyst', 'calcite', 'smooth_basalt']) {
        assert.ok(names.has(`minecraft:${name}`), name);
    }
    assert.ok(result.writes.every(v => v.flags === 2));
    assert.ok(result.writes.some(v => v.name.endsWith('_amethyst_bud') || v.name.endsWith('amethyst_cluster')));
});

test('geode invalid-point rejection consumes no point offset after the failing point and disposes noise', () => {
    const w = createStructureFixtureWorld('geode_air'), calls = [];
    const random = { nextInt: n => { calls.push(n); return 0; }, nextDouble: () => 0, nextFloat: () => 0,
        normalNoise: (parameters, seed, positional) => { assert.equal(seed, 0n); assert.equal(positional, true); return { sample: () => assert.fail('Rejected geode sampled noise'), dispose: () => calls.push('dispose') }; } };
    const config = { ...structureFeature('geode_air'), distribution_points: 3, point_offset: { type: 'minecraft:uniform', min_inclusive: 1, max_inclusive: 7 } };
    assert.equal(placeGeode(config, origin, random, geodeOptions(w, random)), false);
    assert.deepEqual(calls, [3, 3, 3, 7, 3, 3, 3, 'dispose']); assert.equal(w.writes.length, 0);
});

test('geode seed and legacy-noise adapter requirements fail explicitly', () => {
    const w = createStructureFixtureWorld('geode'); delete w.context.seed;
    assert.throws(() => placeGeode(structureFeature('geode'), origin, noRandom, geodeOptions(w, noRandom)), /seed/);
    w.context.seed = '0';
    assert.throws(() => placeGeode(structureFeature('geode'), origin, noRandom, geodeOptions(w, noRandom)), /NormalNoise/);
    assert.throws(() => placeGeode({ ...structureFeature('geode'), inner_placements: [], blocks: {} }, origin, noRandom, w.options), /inner_placements/);
});

test('protected geode blocks survive but protection does not suppress shell RNG draws', async () => {
    const normal = await fixture('geode'), protectedResult = await fixture('geode_protected');
    assert.equal(normal.nextLong, protectedResult.nextLong);
    assert.ok(protectedResult.writes.length < normal.writes.length);
    assert.ok(protectedResult.writes.every(v => (v.x + v.z) % 3 !== 0));
});

test('geode buds inherit default facing/waterlogging and source-water buds remain submerged', async () => {
    const result = await fixture('geode_flooded');
    const buds = result.writes.filter(v => /amethyst_(bud|cluster)$/.test(v.name));
    assert.ok(buds.length > 0); assert.ok(buds.some(v => v.properties.waterlogged === 'true'));
    assert.ok(buds.every(v => ['down', 'up', 'north', 'south', 'west', 'east'].includes(v.properties.facing)));
});

test('geode cracks schedule actual neighboring water/lava fluid ticks at delay zero', async () => {
    for (const [mode, fluid] of [['geode_water', 'minecraft:water'], ['geode_lava', 'minecraft:lava']]) {
        const result = await fixture(mode);
        assert.ok(result.ticks.length > 0, mode); assert.ok(result.ticks.every(v => v.name === fluid && v.delay === 0));
    }
});

test('geode custom water filling resolves the default level property', async () => {
    const result = await fixture('geode_custom');
    const water = result.writes.filter(v => v.name === 'minecraft:water');
    assert.ok(water.length > 0); assert.ok(water.every(v => v.properties.level === '0'));
});

test('geode layer providers share placement RNG and sample before protected-write rejection', async () => {
    const config = structureFeature('geode_weighted');
    const result = await fixture('geode_weighted', '0', config);
    assert.ok(result.writes.some(v => v.name === 'minecraft:andesite'));
    const protectedResult = await fixture('geode_protected', '0', config);
    assert.equal(result.nextLong, protectedResult.nextLong);
    assert.ok(protectedResult.writes.length < result.writes.length);
});

test('explicit inner-placement objects inherit default bud properties before direction updates', async () => {
    const config = { ...structureFeature('geode_flooded'), blocks: { ...structureFeature('geode_flooded').blocks, inner_placements: [{ id: 'minecraft:amethyst_cluster' }] } };
    const result = await fixture('geode_flooded', '0', config);
    const clusters = result.writes.filter(v => v.name === 'minecraft:amethyst_cluster');
    assert.ok(clusters.length > 0); assert.ok(clusters.some(v => v.properties.waterlogged === 'true'));
    assert.ok(clusters.every(v => v.properties.facing));
});

test('multiface origin rejection precedes all RNG draws', () => {
    const w = createStructureFixtureWorld('lichen_blocked');
    assert.equal(placeMultifaceGrowth(structureFeature('lichen_blocked'), origin, noRandom, w.options), false);
    assert.equal(w.writes.length, 0);
});

test('multiface attachment requires a complete support or collision face, not merely a solid block', async () => {
    assert.equal((await fixture('lichen_slab')).succeeded, false);
    const w = createStructureFixtureWorld('lichen_floor'); delete w.context.isBlockSupportFaceFull;
    assert.throws(() => placeMultifaceGrowth(structureFeature('lichen_floor'), origin, { nextInt: () => 0 }, w.options), /isBlockSupportFaceFull/);
});

test('multiface placement preserves existing faces and source waterlogging', () => {
    const w = createStructureFixtureWorld('lichen_water');
    const growth = createMultifaceSpreader('minecraft:glow_lichen', w.options);
    const initial = growth.placementState(w.context.getBlockState(origin), origin, 'down');
    assert.equal(initial.properties.waterlogged, 'true'); assert.equal(initial.properties.down, 'true');
    w.write(initial, origin, 3);
    assert.equal(growth.placementState(initial, origin, 'down'), null);
    const wall = createStructureFixtureWorld('lichen_wall');
    const spreader = createMultifaceSpreader('minecraft:glow_lichen', wall.options);
    const existing = state('glow_lichen', { ...structureDefaultState('minecraft:glow_lichen').properties, down: 'true', waterlogged: 'true' });
    assert.equal(spreader.placementState(existing, origin, 'east').properties.down, 'true');
    assert.equal(spreader.placementState(existing, origin, 'east').properties.waterlogged, 'true');
});

test('flowing-water origin can grow lichen but does not create a waterlogged face', async () => {
    const result = await fixture('lichen_flowing');
    assert.equal(result.writes[0].properties.waterlogged, 'false');
});

test('multiface growth marks the origin after flag-3 write and spread cells before flag-2 write', () => {
    const w = createStructureFixtureWorld('lichen_floor'), order = [];
    const options = { ...w.options, setBlock: (s, p, flags) => { order.push(`write:${flags}`); return w.write(s, p, flags); } };
    w.context.markPosForPostProcessing = p => { order.push('mark'); w.marks.push([p.x, p.y, p.z]); };
    assert.equal(placeMultifaceGrowth(structureFeature('lichen_floor'), origin, { nextInt: () => 0, nextFloat: () => 0 }, options), true);
    assert.deepEqual(order, ['write:3', 'mark', 'mark', 'write:2']);
});

test('wrap-around spread can move diagonally around a single support cube', async () => {
    for (const mode of ['lichen_wrap', 'vein_wrap']) {
        const result = await fixture(mode);
        assert.equal(result.writes.length, 2);
        assert.equal(result.writes[1].y, 19);
        assert.equal(Math.abs(result.writes[1].x) + Math.abs(result.writes[1].z), 1);
        assert.equal(result.writes[1].flags, 2);
    }
});

test('sculk vein spread accepts replaceable grass but rejects fire and sculk surfaces', async () => {
    assert.equal((await fixture('vein_replace')).writes.length, 2);
    assert.equal((await fixture('vein_fire')).writes.length, 1);
    assert.equal((await fixture('vein_reject')).writes.length, 1);
});

test('sculk spread can use another block as its source, while lichen requires an existing source face', () => {
    const w = createStructureFixtureWorld('vein_floor');
    assert.ok(createMultifaceSpreader('minecraft:sculk_vein', w.options).spread(state('stone'), origin, 'down', { nextInt: () => 0 }));
    const lichen = createStructureFixtureWorld('lichen_floor');
    assert.equal(createMultifaceSpreader('minecraft:glow_lichen', lichen.options).spread(state('stone'), origin, 'down', { nextInt: () => 0 }), null);
});

test('multiface spread refuses a write adapter without the actual success result', () => {
    const w = createStructureFixtureWorld('lichen_floor');
    const spreader = createMultifaceSpreader('minecraft:glow_lichen', { ...w.options, setBlock: () => undefined });
    const growth = state('glow_lichen', { ...structureDefaultState('minecraft:glow_lichen').properties, down: 'true' });
    assert.throws(() => spreader.spread(growth, origin, 'down', { nextInt: () => 0 }), /success boolean/);
});

test('a zero spread chance still consumes the initial probability draw', () => {
    const w = createStructureFixtureWorld('lichen_floor'), draws = [];
    assert.equal(placeMultifaceGrowth({ ...structureFeature('lichen_floor'), chance_of_spreading: 0 }, origin,
        { nextInt: n => { draws.push(n); return 0; }, nextFloat: () => { draws.push('float'); return 0; } }, w.options), true);
    assert.deepEqual(draws, [6, 5, 4, 3, 2, 'float']); assert.equal(w.writes.length, 1);
});

test('multiface search retains the JAR one-step reset and excludes the reverse travel face', async () => {
    const result = await fixture('lichen_search');
    assert.equal(result.succeeded, true); assert.equal(result.writes[0].x, 1); assert.equal(result.writes[0].properties.east, 'true');
    const w = createStructureFixtureWorld('lichen_search', '0', p => state(p.x >= 3 ? 'stone' : 'air'));
    assert.equal(placeMultifaceGrowth(structureFeature('lichen_search'), origin, { nextInt: () => 0, nextFloat: () => 0 }, w.options), false);
});

test('unknown multiface blocks and invalid search ranges fail explicitly', () => {
    const w = createStructureFixtureWorld('lichen_floor');
    assert.throws(() => createMultifaceSpreader('minecraft:vine', w.options), /Unsupported/);
    assert.throws(() => placeMultifaceGrowth({ ...structureFeature('lichen_floor'), search_range: 0 }, origin, noRandom, w.options), /search_range/);
});

test('bonus chests use shuffled chunk coordinates, not origin Y, and set loot before torches', async () => {
    const result = await fixture('bonus');
    assert.equal(result.writes.length, 5); assert.equal(result.writes[0].y, 32);
    assert.equal(result.writes[0].name, 'minecraft:chest'); assert.deepEqual(result.writes[0].properties, { facing: 'north', type: 'single', waterlogged: 'false' });
    assert.equal(result.effects[0].afterWrites, 1); assert.equal(result.effects[0].table, 'minecraft:chests/spawn_bonus_chest');
    assert.ok(result.writes.every(v => v.flags === 2));
});

test('bonus placement accepts non-air empty collision shapes and skips unsupported torches', async () => {
    assert.equal((await fixture('bonus_collision')).succeeded, true);
    assert.ok((await fixture('bonus_torches')).writes.length < 5);
    assert.equal((await fixture('bonus_blocked')).succeeded, false);
});

test('missing loot block entities do not consume a seed draw or fabricate container contents', () => {
    const w = createStructureFixtureWorld('bonus_missing');
    assignContainerLoot(w.context, noRandom, origin, 'minecraft:chests/spawn_bonus_chest');
    assert.deepEqual(w.effects, []);
    delete w.context.hasLootContainer;
    assert.throws(() => assignContainerLoot(w.context, noRandom, origin, 'x'), /hasLootContainer/);
});

test('monster rooms reject invalid floor/ceiling and the zero/too-many-door boundaries', async () => {
    for (const mode of ['room_no_doors', 'room_many_doors', 'room_floor', 'room_ceiling']) {
        const result = await fixture(mode); assert.equal(result.succeeded, false, mode); assert.equal(result.writes.length, 0);
    }
});

test('monster rooms retain cave-air clearing, mossy floors, oriented chests and mob spawner', async () => {
    const result = await fixture('room', '-91');
    assert.ok(result.writes.some(v => v.name === 'minecraft:cave_air'));
    assert.ok(result.writes.some(v => v.name === 'minecraft:mossy_cobblestone' && v.y === 19));
    assert.equal(result.writes.at(-1).name, 'minecraft:spawner');
    assert.equal(result.effects.at(-1).entity, 'minecraft:spider');
    assert.equal(result.effects.filter(v => v.kind === 'loot').length, 2);
    assert.ok(result.writes.every(v => v.flags === 2));
});

test('monster rooms protect safe writes and preserve preexisting chest/spawner states during clearing', async () => {
    const result = await fixture('room_protected'); assert.ok(result.writes.filter(v => v.name !== 'minecraft:cave_air').every(v => (v.x + v.y + v.z) % 5 !== 0));
    const existing = await fixture('room_existing');
    assert.ok(existing.writes.every(v => !(v.y === 20 && v.z === 1 && (v.x === 0 || v.x === 1))));
});

test('monster rooms with missing chest/spawner entities still succeed without invented effects', async () => {
    const result = await fixture('room_missing');
    assert.equal(result.succeeded, true); assert.deepEqual(result.effects, []);
});

test('chest reorientation preserves default facing beside another chest', () => {
    const w = createStructureFixtureWorld('room', '0', p => state(p.x === 1 ? 'chest' : p.z === -1 ? 'stone' : 'air'));
    const chest = structureDefaultState('minecraft:chest');
    assert.equal(reorientChest(origin, chest, w.context, w.options.directState), chest);
});

test('End spikes gate placement by floor-divided chunks including negative centers', async () => {
    const negative = await fixture('end_spike_negative'); assert.ok(negative.writes.length > 0); assert.equal(negative.effects[0].x, -0.5);
    const far = await fixture('end_spike_far'); assert.equal(far.succeeded, true); assert.equal(far.writes.length, 0);
    const multi = await fixture('end_spike_multi'); assert.equal(multi.effects.length, 2); assert.ok(multi.effects.every(v => v.x < 16));
});

test('guarded End spikes build all 73 fence cells with connection properties', async () => {
    const result = await fixture('end_spike_guard'), bars = result.writes.filter(v => v.name === 'minecraft:iron_bars');
    assert.equal(bars.length, 73); assert.ok(bars.every(v => v.properties.waterlogged === 'false'));
    assert.deepEqual(bars.find(v => v.x === 0 && v.y === 73 && v.z === 0).properties,
        { north: 'true', south: 'true', west: 'true', east: 'true', waterlogged: 'false' });
});

test('End crystals receive beam/invulnerability/yaw before bedrock and fire cap writes', async () => {
    const result = await fixture('end_spike_beam'), crystal = result.effects[0];
    assert.deepEqual(crystal.beamTarget, [12, 30, -5]); assert.equal(crystal.invulnerable, true);
    assert.equal(crystal.yaw, Math.fround(crystal.yaw)); assert.equal(crystal.afterWrites, result.writes.length - 2);
    assert.equal(result.writes.at(-2).name, 'minecraft:bedrock'); assert.equal(result.writes.at(-1).name, 'minecraft:fire');
});

test('failed End crystal creation consumes no yaw draw and writes no bedrock/fire cap', async () => {
    const result = await fixture('end_spike_missing');
    assert.deepEqual(result.effects, []); assert.ok(result.writes.every(v => !['minecraft:bedrock', 'minecraft:fire'].includes(v.name)));
    assert.equal(result.nextLong, '3038984756725240190');
});

test('End spikes require actual entity and fire-state adapters on their active branches', () => {
    const w = createStructureFixtureWorld('end_spike'); delete w.context.canCreateEndCrystal;
    assert.throws(() => placeEndSpike(structureFeature('end_spike'), origin, noRandom, w.options), /canCreateEndCrystal/);
    assert.throws(() => placeEndSpike({ type: 'minecraft:end_spike', spikes: [] }, origin, noRandom, { ...w.options, context: { minY: 0 } }), /seed/);
});

for (const [name, mode] of [['amethyst_geode', 'geode'], ['glow_lichen', 'lichen_ceiling'], ['sculk_vein', 'vein_floor'], ['bonus_chest', 'bonus'], ['monster_room', 'room'], ['end_spike', 'end_spike_default']]) {
    test(`imported ${name} reaches its built-in executor using real WASM RNG`, async () => {
        const config = data[`data/minecraft/worldgen/feature/${name}.json`]; assert.ok(config);
        const result = await fixture(mode, '0', config);
        assert.equal(result.succeeded, true); assert.ok(result.writes.length > 0);
    });
}

test('original geode/dungeon batch retains its 53 oracle worlds alongside the fossil expansion', () => {
    assert.equal(STRUCTURE_FEATURE_MODES.filter(mode => !mode.startsWith('fossil_')).length, 53);
    const types = new Set(['minecraft:geode', 'minecraft:multiface_growth', 'minecraft:bonus_chest', 'minecraft:monster_room', 'minecraft:end_spike']);
    assert.equal(Object.entries(data).filter(([key, value]) => key.startsWith('data/minecraft/worldgen/feature/') && types.has(value.type)).length, 6);
});
