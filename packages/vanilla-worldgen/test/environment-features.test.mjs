import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { placeEnvironmentFeature } from '../environment-features.mjs';
import { sameBlockState, javaPositionSetOrder } from '../feature-world.mjs';
import { placeAttachedToLogsDecorator } from '../tree-decorators.mjs';
import { oracleFeature } from './feature-fixtures.mjs';

const origin = { x: 0, y: 20, z: 0 };
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
const noRandom = { nextInt: () => assert.fail('Unexpected RNG'), nextFloat: () => assert.fail('Unexpected RNG') };
const zeroRandom = { nextInt: () => 0, nextFloat: () => 0, nextDouble: () => 0 };
function world(base = p => state(p.y < 20 ? 'dirt' : 'air')) {
    const writes = [], marks = [], blocks = new Map();
    const key = p => `${p.x},${p.y},${p.z}`;
    const context = {
        minY: 0, maxY: 64, seaLevel: 32, getHeight: () => 32,
        getBlockState: p => blocks.get(key(p)) ?? base(p),
        isAir: p => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(context.getBlockState(p).name),
        isLiquid: p => ['minecraft:water', 'minecraft:lava'].includes(context.getBlockState(p).name),
        isSolid: p => !context.isAir(p) && !context.isLiquid(p),
        isBlockInTag: () => false, isFaceSturdy: p => context.isSolid(p),
        isFaceOcclusionFull: p => context.isSolid(p), blockFluidIsInTag: (s, tag) => s.name === tag,
        markPosForPostProcessing: p => marks.push(p),
        isReplaceable: p => context.isAir(p), isWaterOrWaterNearby: () => false,
        hasShelfMushroomAt: p => context.getBlockState(p).name === 'minecraft:shelf_mushroom'
    };
    const setBlock = (s, p, flags) => { blocks.set(key(p), s); writes.push({ state: s, pos: { ...p }, flags }); };
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock });
    return { context, writes, marks, setBlock, place: (feature, random = zeroRandom, pos = origin) => place('<test>', feature, pos, random, context) };
}

test('bamboo survival rejection succeeds without sampling height or modifying blocks', () => {
    assert.equal(placeEnvironmentFeature(oracleFeature('bamboo'), origin, noRandom, {
        context: { isAir: () => true }, directState: value => state(value.id.slice(10), value.properties),
        canSurvive: () => false, setBlock: () => assert.fail('No writes')
    }), true);
});

test('bamboo podzol circle uses WORLD_SURFACE and retains blocked-tip writes', () => {
    const w = world(p => state(p.y < 20 ? 'dirt' : p.y === 24 ? 'stone' : 'air'));
    w.context.getHeight = type => { assert.equal(type, 'WORLD_SURFACE'); return 20; };
    w.context.isBlockInTag = (_, tag) => tag === 'minecraft:beneath_bamboo_podzol_replaceable';
    assert.equal(w.place(oracleFeature('bamboo')), true);
    assert.equal(w.writes.filter(v => v.state.name === 'minecraft:podzol').length, 5);
    assert.deepEqual(w.writes.at(-3), { state: { stateId: 1, ...state('bamboo', { age: '1', leaves: 'large', stage: '1' }) }, pos: { ...origin, y: 24 }, flags: 2 });
});

test('blue ice rejects high origins and ignores packed ice only underneath', () => {
    const high = world();
    assert.equal(high.place(oracleFeature('blue_ice'), noRandom, { ...origin, y: 32 }), false);
    const below = world(p => state(p.y === 19 ? 'packed_ice' : 'water'));
    assert.equal(below.place(oracleFeature('blue_ice'), noRandom), false);
    assert.equal(below.writes.length, 0);
});

test('underwater magma samples probability before face checks, and requires real occlusion', () => {
    const w = world(p => state(p.y <= 18 ? 'stone' : 'water'));
    const feature = { ...oracleFeature('magma'), placement_probability_per_valid_position: 0 };
    delete w.context.isFaceOcclusionFull;
    let draws = 0;
    assert.equal(w.place(feature, { ...zeroRandom, nextFloat: () => { draws++; return 0; } }), false);
    assert.equal(draws, 27);
    assert.throws(() => w.place(oracleFeature('magma')), /context.isFaceOcclusionFull/);
});

test('End platform skips an existing floor but clears three layers with update flag 3', () => {
    const w = world(() => state('obsidian'));
    assert.equal(w.place(oracleFeature('end_platform'), noRandom), true);
    assert.equal(w.writes.length, 75);
    assert.ok(w.writes.every(v => v.flags === 3 && v.state.name === 'minecraft:air'));
});

test('Void platform clips negative chunk coordinates without consuming RNG', () => {
    const w = world();
    assert.equal(w.place(oracleFeature('void_platform'), noRandom, { ...origin, x: -1 }), true);
    assert.equal(w.writes.length, 128);
    assert.ok(w.writes.every(v => v.pos.x >= -8 && v.pos.x < 0 && v.pos.y === 23));
    const far = world();
    assert.equal(far.place(oracleFeature('void_platform'), noRandom, { ...origin, x: -17 }), true);
    assert.equal(far.writes.length, 0);
});

test('mushrooms sample cap/stem providers at the original origin and place cap first', () => {
    const w = world();
    const samples = [];
    assert.equal(placeEnvironmentFeature(oracleFeature('brown'), origin, { nextInt: bound => bound === 12 ? 1 : 0 }, {
        context: w.context, sampleState: (provider, p) => { samples.push(p); return state(provider.id.slice(10), provider.properties); },
        directState: value => state(value.id.slice(10), value.properties), setBlock: w.setBlock
    }), true);
    assert.ok(samples.every(p => p === origin));
    assert.equal(w.writes[0].state.name, 'minecraft:brown_mushroom_block');
    assert.equal(w.writes.at(-1).state.name, 'minecraft:mushroom_stem');
    assert.equal(w.writes[0].state.properties.down, 'false');
});

test('mushroom world-height rejection consumes two height draws, not provider samples', () => {
    const w = world(); let draws = 0;
    assert.equal(w.place(oracleFeature('red'), { nextInt: () => { draws++; return 0; } }, { ...origin, y: 60 }), false);
    assert.equal(draws, 2); assert.equal(w.writes.length, 0);
});

test('root system rejects a non-air origin and returns success when no tree site exists', () => {
    const solid = world(() => state('stone'));
    assert.equal(solid.place(oracleFeature('root'), noRandom), false);
    const blocked = world();
    assert.equal(blocked.place(oracleFeature('root_blocked'), noRandom), true);
    assert.equal(blocked.writes.length, 0);
});

test('root-system nested trees use normal placement, not placeWithBiomeCheck', () => {
    const w = world(p => state(p.x === 0 && p.y === 20 && p.z === 0 || p.y > 22 ? 'air' : 'stone'));
    const feature = oracleFeature('root');
    feature.feature.placement.push({ type: 'minecraft:biome' });
    w.context.isBiomeFeature = () => assert.fail('Nested root tree has no top-level biome check');
    assert.throws(() => w.place(feature), /Biome placement requires a top-level/);
});

test('ice spike rare elevation branch grows both its spike and roots, stopping above Y=50', () => {
    const w = world(p => state(p.y < 60 ? 'snow_block' : 'air'));
    const draws = [0, 3, 0, 0, 0];
    assert.equal(w.place(oracleFeature('spike_high'), { nextInt: () => draws.shift() ?? 0, nextFloat: () => 0 }, { ...origin, y: 60 }), true);
    assert.ok(w.writes.some(v => v.pos.y === 78));
    assert.ok(w.writes.some(v => v.pos.y === 51));
    assert.ok(w.writes.every(v => v.pos.y > 50 && v.state.name === 'minecraft:packed_ice' && v.flags === 3));
});

test('delta excludes protected Nether blocks even when every neighbor has the correct shape', () => {
    const w = world(p => state(p.y <= 20 ? 'chest' : 'air'));
    assert.equal(w.place(oracleFeature('delta')), false);
    assert.equal(w.writes.length, 0);
});

test('fallen tree keeps its stump when the entire horizontal log cannot fit', () => {
    const w = world(() => state('stone'));
    assert.equal(w.place(oracleFeature('fallen_blocked')), true);
    assert.equal(w.writes.length, 1);
    assert.equal(w.writes[0].state.properties.axis, 'y');
    assert.deepEqual(w.marks, [{ x: 0, y: 21, z: 0 }, { x: 0, y: 22, z: 0 }]);
});

test('attached-to-logs samples a direction even for a singleton, and uses inclusive probability', () => {
    const calls = [], writes = [];
    const p = { x: 2, y: 3, z: 4 };
    assert.equal(placeAttachedToLogsDecorator({ probability: 0, directions: ['up'], block_provider: 'provider' }, [p], {
        nextInt: bound => { calls.push(bound); return 0; }, nextFloat: () => 0
    }, { context: { isAir: () => true }, sampleState: (_, pos) => { assert.deepEqual(pos, { ...p, y: 4 }); return state('brown_mushroom'); },
        setBlock: (_, pos, flags) => writes.push([pos, flags]) }), 1);
    assert.deepEqual(calls, [1]); assert.equal(writes[0][1], 19);
});

test('block-state equality includes properties and position hashing matches Vec3i, not coordinate packing', () => {
    assert.equal(sameBlockState(state('lava', { level: '0' }), state('lava', { level: '1' })), false);
    assert.equal(sameBlockState(state('vine', { up: 'false', east: 'true' }), state('vine', { east: 'true', up: 'false' })), true);
    assert.deepEqual(javaPositionSetOrder([-2, -3, -4, -5, -6].map(x => ({ x, y: 20, z: 0 }))).map(p => p.x), [-6, -5, -4, -3, -2]);
});

test('all 19 imported configs for the 12 new feature types reach the built-in executor', async () => {
    const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
    const types = new Set(['bamboo', 'blue_ice', 'delta_feature', 'underwater_magma', 'end_platform', 'void_start_platform', 'huge_brown_mushroom', 'huge_red_mushroom', 'spike', 'lake', 'root_system', 'fallen_tree'].map(v => `minecraft:${v}`));
    const features = Object.values(data).filter(v => types.has(v?.type));
    assert.equal(features.length, 19);
    for (const feature of features) {
        const w = world();
        w.context.testBlockPredicate = () => false;
        assert.equal(typeof w.place(feature), 'boolean', feature.type);
    }
});
