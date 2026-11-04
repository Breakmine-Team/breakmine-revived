import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createConfiguredFeaturePlacer } from '../features.mjs';
import { placeIceberg, smoothIceberg, icebergRoundRadius, icebergEllipseDistance } from '../iceberg-feature.mjs';
import { placePortalFeature } from '../portal-features.mjs';
import { createVanillaKernel } from '../runtime.mjs';

const origin = { x: 0, y: 20, z: 0 };
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
const noRandom = Object.fromEntries(['nextInt', 'nextFloat', 'nextDouble', 'nextBoolean'].map(name => [name, () => assert.fail(`Unexpected ${name}`)]));
function world(base = () => state('air')) {
    const blocks = new Map(), writes = [], destroyed = [], exits = [], trace = [];
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const directState = value => typeof value === 'string' ? { name: value, properties: {} } : { name: value.id, properties: { ...value.properties } };
    const setBlock = (s, pos, flags) => {
        blocks.set(key(pos), s);
        writes.push({ state: s, pos: { ...pos }, flags }); trace.push({ kind: 'write', pos: { ...pos }, name: s.name });
    };
    const context = {
        minY: 0, maxY: 128, seaLevel: 32,
        getBlockState: pos => blocks.get(key(pos)) ?? base(pos),
        destroyBlock: (pos, drop) => {
            destroyed.push({ ...pos, drop }); trace.push({ kind: 'destroy', pos: { ...pos } });
            if (['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(context.getBlockState(pos).name)) return false;
            setBlock(state('air'), pos, 3); return true;
        },
        hasEndGatewayBlockEntity: pos => { trace.push({ kind: 'gateway-check', pos: { ...pos } }); return true; },
        setEndGatewayExit: (pos, exit, exact) => {
            exits.push({ pos: { ...pos }, exit: { ...exit }, exact, afterWrites: writes.length });
            trace.push({ kind: 'gateway-exit', pos: { ...pos } });
        }
    };
    return { writes, destroyed, exits, trace, context, options: { context, directState, setBlock } };
}
async function withKernel(fn) {
    const kernel = await createVanillaKernel(await readFile(new URL('../generated/worldgen.wasm', import.meta.url)),
        JSON.parse(await readFile(new URL('../generated/climate.json', import.meta.url), 'utf8')));
    try { await fn(kernel); } finally { kernel.dispose(); }
}

test('round iceberg radius draws float then a threshold integer even for short bergs', () => {
    const calls = [];
    assert.equal(icebergRoundRadius({ nextFloat: () => { calls.push('float'); return 0.5; },
        nextInt: bound => { calls.push(bound); return 0; } }, 1, 4, 8), 4);
    assert.deepEqual(calls, ['float', 5]);
});

test('tall round bergs conditionally consume their extra six-way draw', () => {
    const calls = [];
    assert.equal(icebergRoundRadius({ nextFloat: () => { calls.push('float'); return 0.5; },
        nextInt: bound => { calls.push(bound); return 0; } }, 6, 23, 11), 5);
    assert.deepEqual(calls, ['float', 5, 6]);
});

test('a radius rounded up from a negative fraction becomes Java integer zero, not JS -0', () => {
    const radius = icebergRoundRadius({ nextFloat: () => 0.5, nextInt: () => 4 }, 7, 14, 11);
    assert.equal(radius, 0); assert.equal(Object.is(radius, -0), false);
    assert.equal(1 / radius, Infinity);
});

test('ellipse distance uses the rotated axes and retains degenerate-axis rejection', () => {
    assert.equal(icebergEllipseDistance(0, 0, { x: 0, z: 0 }, 4, 2, 0), -1);
    assert.equal(icebergEllipseDistance(4, 0, { x: 0, z: 0 }, 4, 2, 0), 0);
    assert.ok(Math.abs(icebergEllipseDistance(0, 4, { x: 0, z: 0 }, 4, 2, Math.PI / 2)) < 1e-15);
    assert.ok(Number.isNaN(icebergEllipseDistance(0, 0, { x: 0, z: 0 }, 0, 0, 0)));
});

test('iceberg smoothing removes unsupported ice and the cell above, even when it is not snow', () => {
    const w = world(pos => state(pos.y === 20 ? 'packed_ice' : pos.y === 21 ? 'gold_block' : 'air'));
    smoothIceberg(origin, 0, 0, false, 0, w.options);
    assert.deepEqual(w.writes.map(v => [v.pos.y, v.state.name, v.flags]), [[20, 'minecraft:air', 3], [21, 'minecraft:air', 3]]);
});

test('supported isolated iceberg blocks check all four neighbors in west/east/north/south order', () => {
    const reads = [], w = world(pos => state(pos.y === 19 ? 'stone' : pos.x === 0 && pos.z === 0 && pos.y === 20 ? 'blue_ice' : 'air'));
    const read = w.context.getBlockState;
    w.context.getBlockState = pos => { reads.push({ ...pos }); return read(pos); };
    smoothIceberg(origin, 0, 0, false, 0, w.options);
    assert.deepEqual(reads.slice(2), [{ x: -1, y: 20, z: 0 }, { x: 1, y: 20, z: 0 }, { x: 0, y: 20, z: -1 }, { x: 0, y: 20, z: 1 }]);
    assert.equal(w.writes.length, 1); assert.equal(w.writes[0].state.name, 'minecraft:air');
});

test('supported thin snow survives isolation, while a full snow block is treated as iceberg material', () => {
    for (const [name, count] of [['snow', 0], ['snow_block', 1]]) {
        const w = world(pos => state(pos.y === 19 ? 'stone' : pos.x === 0 && pos.z === 0 && pos.y === 20 ? name : 'air'));
        smoothIceberg(origin, 0, 0, false, 0, w.options);
        assert.equal(w.writes.length, count);
    }
});

test('iceberg placement anchors to generator sea level and ignores the supplied origin Y', async () => {
    await withKernel(kernel => {
        const results = [];
        for (const y of [-300, 2000]) {
            const w = world(pos => state(pos.y < 48 ? 'water' : 'air')), random = kernel.random('8');
            w.context.seaLevel = 48;
            try {
                assert.equal(placeIceberg({ type: 'minecraft:iceberg', state: 'minecraft:blue_ice' }, { ...origin, y }, random, w.options), true);
                assert.ok(w.writes.some(v => v.pos.y < 48));
                assert.ok(w.writes.some(v => v.pos.y >= 48));
                results.push({ writes: w.writes, nextLong: random.nextLong() });
            } finally { random.dispose(); }
        }
        assert.deepEqual(results[0], results[1]);
    });
});

test('a fully obstructed iceberg succeeds without writes but still consumes its geometry RNG', async () => {
    await withKernel(kernel => {
        const w = world(() => state('stone')), random = kernel.random('0'), untouched = kernel.random('0');
        try {
            assert.equal(placeIceberg({ type: 'minecraft:iceberg', state: 'minecraft:packed_ice' }, origin, random, w.options), true);
            assert.equal(w.writes.length, 0);
            assert.notEqual(random.nextLong(), untouched.nextLong());
        } finally { random.dispose(); untouched.dispose(); }
    });
});

test('iceberg placement refuses to substitute origin height for a missing sea-level adapter', () => {
    const w = world(); delete w.context.seaLevel;
    assert.throws(() => placeIceberg({ type: 'minecraft:iceberg', state: 'minecraft:packed_ice' }, origin, noRandom, w.options), /seaLevel/);
    assert.equal(w.writes.length, 0);
});

test('inactive podium uses spherical distances, writes its pillar last and consumes no RNG', () => {
    const w = world(); delete w.context.getBlockState; delete w.context.destroyBlock;
    assert.equal(placePortalFeature({ type: 'minecraft:end_podium' }, origin, noRandom, w.options), true);
    assert.ok(w.writes.some(v => v.pos.x === 3 && v.pos.y === 19 && v.pos.z === 0 && v.state.name === 'minecraft:end_stone'));
    assert.ok(!w.writes.some(v => v.pos.x === 3 && v.pos.y === 23 && v.pos.z === 0));
    assert.deepEqual(w.writes.slice(-8, -4).map(v => [v.pos.y, v.state.name]), [20, 21, 22, 23].map(y => [y, 'minecraft:bedrock']));
    assert.deepEqual(w.writes.slice(-4).map(v => [v.pos, v.state.properties.facing]), [
        [{ x: 0, y: 22, z: -1 }, 'north'], [{ x: 1, y: 22, z: 0 }, 'east'],
        [{ x: 0, y: 22, z: 1 }, 'south'], [{ x: -1, y: 22, z: 0 }, 'west']]);
    assert.ok(w.writes.every(v => v.flags === 3));
});

test('active podium retains same-block portal/floor cells without destruction or redundant writes', () => {
    const w = world(pos => state(pos.y === 20 && pos.x ** 2 + pos.z ** 2 < 2.5 ** 2 ? 'end_portal' : pos.y < 20 ? 'end_stone' : 'air'));
    placePortalFeature({ type: 'minecraft:end_podium', active: true }, origin, noRandom, w.options);
    assert.equal(w.destroyed.length, 0);
    assert.ok(w.writes.every(v => v.state.name !== 'minecraft:end_portal'));
    assert.ok(w.writes.some(v => v.state.name === 'minecraft:bedrock' && v.pos.y === 20));
});

test('active podium destroys replaced blocks with drops before writing portal or air', () => {
    const w = world(() => state('stone'));
    placePortalFeature({ type: 'minecraft:end_podium', active: true }, origin, noRandom, w.options);
    const actions = w.trace.filter(v => v.pos.x === 1 && v.pos.y === 20 && v.pos.z === 0);
    assert.deepEqual(actions.map(v => [v.kind, v.name]), [['destroy', undefined], ['write', 'minecraft:air'], ['write', 'minecraft:end_portal']]);
    assert.ok(w.destroyed.length > 0 && w.destroyed.every(v => v.drop === true));
});

test('active podium does not guess destruction semantics when the world callback is absent', () => {
    const w = world(() => state('stone')); delete w.context.destroyBlock;
    assert.throws(() => placePortalFeature({ type: 'minecraft:end_podium', active: true }, origin, noRandom, w.options), /destroyBlock/);
});

test('delayed gateway makes the 45-cell frame with no block-entity lookup or random draw', () => {
    const w = world(); delete w.context.hasEndGatewayBlockEntity; delete w.context.setEndGatewayExit;
    assert.equal(placePortalFeature({ type: 'minecraft:end_gateway', exact: false }, origin, noRandom, w.options), true);
    assert.equal(w.writes.length, 45);
    assert.equal(w.writes.filter(v => v.state.name === 'minecraft:end_gateway').length, 1);
    assert.equal(w.writes.filter(v => v.state.name === 'minecraft:bedrock').length, 12);
    assert.equal(w.writes[0].state.name, 'minecraft:air');
    assert.ok(w.writes.every(v => v.flags === 3)); assert.equal(w.exits.length, 0);
});

test('known gateway exit is stored immediately after the center write, before the rest of its frame', () => {
    for (const exact of [true, false]) {
        const w = world();
        placePortalFeature({ type: 'minecraft:end_gateway', exact, exit: [100, 50, -8] }, origin, noRandom, w.options);
        assert.deepEqual(w.exits, [{ pos: origin, exit: { x: 100, y: 50, z: -8 }, exact, afterWrites: 23 }]);
        assert.deepEqual(w.trace.slice(22, 26).map(v => v.kind), ['write', 'gateway-check', 'gateway-exit', 'write']);
    }
});

test('missing or wrong-type gateway block entities leave the exit unset without calling its setter', () => {
    const w = world(); w.context.hasEndGatewayBlockEntity = () => false; delete w.context.setEndGatewayExit;
    assert.equal(placePortalFeature({ type: 'minecraft:end_gateway', exact: true, exit: [100, 50, 0] }, origin, noRandom, w.options), true);
    assert.equal(w.writes.length, 45); assert.equal(w.exits.length, 0);
});

test('known gateways require explicit entity callbacks and validate exit coordinates', () => {
    const w = world(); delete w.context.hasEndGatewayBlockEntity;
    assert.throws(() => placePortalFeature({ type: 'minecraft:end_gateway', exact: true, exit: [100, 50, 0] }, origin, noRandom, w.options), /hasEndGatewayBlockEntity/);
    assert.throws(() => placePortalFeature({ type: 'minecraft:end_gateway', exact: true, exit: [100, 50] }, origin, noRandom, world().options), /three integer/);
});

test('fill layer uses minY plus height, preserves explicit properties and loops X then Z', () => {
    const w = world(); w.context.minY = -64;
    const pos = { x: 17, y: 100, z: -4 };
    const feature = { type: 'minecraft:fill_layer', height: 4, state: { id: 'minecraft:basalt', properties: { axis: 'z' } } };
    assert.equal(placePortalFeature(feature, pos, noRandom, w.options), true);
    assert.equal(w.writes.length, 256);
    assert.deepEqual(w.writes.slice(0, 2).map(v => v.pos), [{ x: 17, y: -60, z: -4 }, { x: 17, y: -60, z: -3 }]);
    assert.deepEqual(w.writes.at(-1).pos, { x: 32, y: -60, z: 11 });
    assert.ok(w.writes.every(v => v.flags === 2 && v.state.properties.axis === 'z'));
});

test('fill layer recognizes cave/void air but never replaces a solid or water block', () => {
    const names = ['air', 'cave_air', 'void_air', 'stone', 'water'];
    const w = world(pos => state(names[pos.x % 5]));
    placePortalFeature({ type: 'minecraft:fill_layer', height: 4, state: 'minecraft:stone' }, origin, noRandom, w.options);
    assert.equal(w.writes.length, 160);
    assert.ok(w.writes.every(v => v.pos.x % 5 < 3));
    const blocked = world(() => state('stone'));
    assert.equal(placePortalFeature({ type: 'minecraft:fill_layer', height: 4, state: 'minecraft:stone' }, origin, noRandom, blocked.options), true);
    assert.equal(blocked.writes.length, 0);
});

test('all six imported iceberg, podium and gateway configs execute with real WASM RNG', async () => {
    const data = JSON.parse(await readFile(new URL('../generated/vanilla-data.json', import.meta.url), 'utf8'));
    const names = ['iceberg_blue', 'iceberg_packed', 'end_podium_active', 'end_podium_inactive', 'end_gateway_return', 'end_gateway_delayed'];
    const configs = Object.entries(data).filter(([path, value]) => path.startsWith('data/minecraft/worldgen/feature/')
        && ['minecraft:iceberg', 'minecraft:end_podium', 'minecraft:end_gateway', 'minecraft:fill_layer'].includes(value.type));
    assert.equal(configs.length, 6);
    await withKernel(kernel => {
        for (const name of names) for (const seed of ['0', '8', '9223372036854775807']) {
            const w = world(pos => state(name.startsWith('iceberg') ? pos.y < 32 ? 'water' : 'air' : pos.y < 20 ? 'end_stone' : 'air'));
            const place = createConfiguredFeaturePlacer(data, { stateIdFor: () => 1, canSurvive: () => assert.fail('Unexpected survival callback'), setBlock: w.options.setBlock });
            const random = kernel.random(seed);
            try {
                assert.equal(place(name, data[`data/minecraft/worldgen/feature/${name}.json`], origin, random, w.context), true);
                assert.ok(w.writes.length > 0, `${name}, seed=${seed}: no actual block writes`);
                if (name === 'end_gateway_return') assert.deepEqual(w.exits[0].exit, { x: 100, y: 50, z: 0 });
            } finally { random.dispose(); }
        }
    });
});
