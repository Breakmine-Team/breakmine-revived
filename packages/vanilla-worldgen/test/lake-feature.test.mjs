import test from 'node:test';
import assert from 'node:assert/strict';
import { placeLake } from '../lake-feature.mjs';
import { oracleFeature } from './feature-fixtures.mjs';

const origin = { x: 0, y: 20, z: 0 };
function fixture({ base = 'stone', water = false, freeze = false, protectedBlocks = false, barrier = 'basalt' } = {}) {
    const writes = [], ticks = [], marks = [], freezes = [], providers = [], blocks = new Map();
    const key = p => `${p.x},${p.y},${p.z}`;
    const named = value => typeof value === 'string' ? { name: value, properties: {} } : { name: value.id, properties: value.properties ?? {} };
    const read = p => blocks.get(key(p)) ?? named(`minecraft:${base}`);
    const context = {
        minY: 0, getBlockState: read,
        isAir: p => read(p).name.endsWith('air'),
        isLiquid: p => ['minecraft:water', 'minecraft:lava'].includes(read(p).name),
        isSolid: p => !context.isAir(p) && !context.isLiquid(p),
        markPosForPostProcessing: p => marks.push({ ...p }),
        blockFluidIsInTag: (state, tag) => state.name === tag,
        shouldFreeze: (p, exposed, query) => { freezes.push([p, exposed, query]); return freeze; }
    };
    const options = {
        context, directState: named,
        sampleState: (provider, p) => { providers.push([provider, p]); return named(provider); },
        setBlock: (state, p, flags) => { blocks.set(key(p), state); writes.push({ state, pos: p, flags }); },
        scheduleTick: (state, p, delay) => ticks.push({ state, pos: p, delay })
    };
    const feature = { ...oracleFeature(protectedBlocks ? 'lake_protected' : 'lake'), barrier: { id: `minecraft:${barrier}` },
        ...(water ? { fluid: { id: 'minecraft:water', properties: { level: '0' } } } : {}) };
    let ints = 0, doubles = 0;
    const random = { nextInt: bound => { ints++; return bound === 2 ? 1 : 0; }, nextDouble: () => { doubles++; return 0.5; } };
    return { feature, options, random, writes, ticks, marks, freezes, providers, calls: () => ({ ints, doubles }),
        place: () => placeLake(feature, origin, random, options) };
}

test('lake minimum height rejects before shape draws or provider sampling', () => {
    const f = fixture();
    assert.equal(placeLake(f.feature, { ...origin, y: 4 }, { nextInt: () => assert.fail('No shape sampling') }, f.options), false);
    assert.equal(f.providers.length, 0);
});

test('lake ellipsoids sample fluid/barrier at the translated origin and queue cave-air ticks', () => {
    const f = fixture();
    assert.equal(f.place(), true);
    assert.equal(f.calls().doubles, 24);
    assert.deepEqual(f.providers.map(v => v[1]), [{ x: -8, y: 16, z: -8 }, { x: -8, y: 16, z: -8 }]);
    assert.ok(f.ticks.length > 0);
    assert.equal(f.ticks.length, f.writes.filter(v => v.state.name === 'minecraft:cave_air').length);
    assert.ok(f.ticks.every(v => v.delay === 0 && v.state.name === 'minecraft:cave_air' && v.pos.y >= 20));
    assert.ok(f.writes.every(v => v.flags === 2));
    assert.ok(f.marks.length > 0);
});

test('lake validation rejects liquid above the fluid line before modifying terrain', () => {
    const f = fixture({ base: 'water' });
    assert.equal(f.place(), false);
    assert.equal(f.writes.length, 0);
    assert.equal(f.providers.length, 1);
});

test('lake lower-boundary validation compares the entire fluid state', () => {
    const f = fixture({ base: 'lava' });
    f.options.context.getBlockState = () => ({ name: 'minecraft:lava', properties: { level: '1' } });
    assert.equal(f.place(), false);
    assert.equal(f.writes.length, 0);
});

test('lake protected cavity still places barriers but never schedules air ticks', () => {
    const f = fixture({ protectedBlocks: true });
    assert.equal(f.place(), true);
    assert.ok(f.writes.length > 0);
    assert.ok(f.writes.every(v => v.state.name === 'minecraft:basalt'));
    assert.equal(f.ticks.length, 0);
});

test('air barrier suppresses the barrier coin flips, not ellipsoid sampling', () => {
    const air = fixture({ barrier: 'air' }), stone = fixture();
    assert.equal(air.place(), true); assert.equal(stone.place(), true);
    assert.equal(air.calls().ints, 1);
    assert.ok(stone.calls().ints > air.calls().ints);
    assert.equal(air.calls().doubles, stone.calls().doubles);
    assert.ok(air.writes.every(v => v.state.name !== 'minecraft:basalt'));
});

test('water lakes ask the biome about all 256 surface positions with exposure disabled', () => {
    const f = fixture({ water: true, freeze: true, barrier: 'air' });
    assert.equal(f.place(), true);
    assert.equal(f.freezes.length, 256);
    assert.ok(f.freezes.every(([p, exposed, query]) => p.y === 20 && exposed === false && p === query));
    assert.equal(f.writes.filter(v => v.state.name === 'minecraft:ice').length, 256);
});

test('lake air carving requires an explicit scheduled-block-tick adapter', () => {
    const f = fixture(); delete f.options.scheduleTick;
    assert.throws(() => f.place(), /requires scheduleTick/);
});
