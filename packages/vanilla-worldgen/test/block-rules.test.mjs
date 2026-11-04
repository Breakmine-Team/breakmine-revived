import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../generated/vanilla-data.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };
import native from '../generated/block-rules.json' with { type: 'json' };
import { createNativeTreeRules } from '../native-tree-rules.mjs';
import { createBlockStateProviderSampler } from '../features.mjs';

test('native oracle rules cover every pinned state and exact registered default', () => {
    assert.equal(native.source.sha256, registry.source.sha256);
    assert.equal(native.states.length, 35723);
    assert.equal(Object.keys(native.defaults).length, 1286);
    for (const state of registry.states) {
        const rule = native.states[state.id];
        assert.equal(rule.id, state.id);
        for (const field of ['solid', 'solidRender', 'canOcclude', 'replaceable', 'fluidEmpty', 'sourceWater', 'liquid', 'sturdyUp']) assert.equal(typeof rule[field], 'boolean');
        assert.equal(typeof rule.useShapeForLightOcclusion, 'boolean');
        assert.ok(Number.isFinite(rule.destroySpeed) && rule.destroySpeed >= -1);
        assert.equal(rule.faces.occlusionShapes.length, 6);
        assert.ok(rule.faces.occlusionShapes.every(shapeId => shapeId >= 0 && shapeId < native.occlusionShapes.length));
        assert.ok(rule.fluid.startsWith('minecraft:'));
    }
    assert.ok(native.occlusionShapes.every(mask => /^[0-9a-f]{64}$/.test(mask)));
    const states = new Map(registry.states.map(state => [state.id, state]));
    for (const [name, id] of Object.entries(native.defaults)) assert.equal(states.get(id).name, name);
});

test('native vegetation, double plants and aquatic supports retain distinct survival branches', () => {
    const pos = { x: 0, y: 64, z: 0 };
    const state = (name, properties) => {
        const s = registry.states.find(s => s.name === name && (!properties || Object.entries(properties).every(([k, v]) => s.properties[k] === v)));
        return { name: s.name, properties: s.properties, stateId: s.id };
    };
    let below = state('minecraft:grass_block'), current = state('minecraft:water', { level: '0' });
    const rules = createNativeTreeRules(data, registry, { getBlockState: p => p.y === 63 ? below : current }, native);
    assert.equal(native.survival['minecraft:dandelion'], 'vegetation');
    assert.equal(rules.canStateSurvive(state('minecraft:dandelion'), pos), true);
    assert.equal(rules.canStateSurvive(state('minecraft:tall_grass', { half: 'upper' }), pos), false);
    below = state('minecraft:tall_grass', { half: 'lower' });
    assert.equal(rules.canStateSurvive(state('minecraft:tall_grass', { half: 'upper' }), pos), true);
    below = state('minecraft:stone');
    assert.equal(rules.canStateSurvive(state('minecraft:tall_seagrass', { half: 'lower' }), pos), true);
    current = state('minecraft:water', { level: '1' });
    assert.equal(rules.canStateSurvive(state('minecraft:tall_seagrass', { half: 'lower' }), pos), false);
    below = state('minecraft:tall_seagrass', { half: 'lower' });
    assert.equal(rules.canStateSurvive(state('minecraft:tall_seagrass', { half: 'upper' }), pos), true);
    below = state('minecraft:kelp_plant');
    assert.equal(rules.canStateSurvive(state('minecraft:kelp'), pos), true);
    below = state('minecraft:air');
    assert.equal(rules.canStateSurvive(state('minecraft:kelp'), pos), false);
    assert.equal(rules.blockFluidIsInTag(state('minecraft:water', { level: '0' }), 'minecraft:water'), true);
    assert.equal(rules.blockFluidIsInTag(state('minecraft:lava', { level: '0' }), 'minecraft:water'), false);
});

test('live and dead coral blocks use the vanilla full-block survival path', () => {
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => registry.states[native.defaults['minecraft:water']] }, native);
    for (const coral of ['tube', 'brain', 'bubble', 'fire', 'horn']) {
        for (const name of [`minecraft:${coral}_coral_block`, `minecraft:dead_${coral}_coral_block`]) {
            assert.equal(rules.canStateSurvive({ name, properties: {} }, { x: 0, y: 40, z: 0 }), true, name);
        }
    }
});

test('patch pumpkin and melon use vanilla full-block survival behavior', () => {
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => registry.states[native.defaults['minecraft:water']] }, native);
    for (const name of ['minecraft:pumpkin', 'minecraft:melon']) {
        const block = registry.states[native.defaults[name]];
        assert.equal(rules.canStateSurvive({ name: block.name, properties: block.properties, stateId: block.id }, { x: 0, y: 40, z: 0 }), true, name);
    }
});

test('sculk catalyst uses the vanilla unrestricted survival rule', () => {
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => { throw new Error('No support lookup required'); } }, native);
    const catalyst = registry.states[native.defaults['minecraft:sculk_catalyst']];
    assert.equal(rules.canStateSurvive({ name: catalyst.name, properties: catalyst.properties, stateId: catalyst.id }, { x: 0, y: 40, z: 0 }), true);
});

test('dead bush and dry grasses use the native supports_dry_vegetation substrate tag', () => {
    let below = registry.states[native.defaults['minecraft:sand']];
    const rules = createNativeTreeRules(data, registry, { getBlockState: pos => {
        assert.deepEqual(pos, { x: 2, y: 63, z: -3 });
        return below;
    } }, native);
    const pos = { x: 2, y: 64, z: -3 };
    for (const name of ['minecraft:dead_bush', 'minecraft:short_dry_grass', 'minecraft:tall_dry_grass']) {
        const block = registry.states[native.defaults[name]];
        const state = { name: block.name, properties: block.properties, stateId: block.id };
        for (const substrate of ['minecraft:sand', 'minecraft:red_sand', 'minecraft:terracotta', 'minecraft:grass_block']) {
            below = registry.states[native.defaults[substrate]];
            assert.equal(rules.canStateSurvive(state, pos), true, `${name} on ${substrate}`);
        }
        below = registry.states[native.defaults['minecraft:stone']];
        assert.equal(rules.canStateSurvive(state, pos), false, `${name} on stone`);
    }
});

test('bamboo uses the native supports_bamboo substrate tag', () => {
    let below = registry.states[native.defaults['minecraft:podzol']];
    const rules = createNativeTreeRules(data, registry, {
        getBlockState: pos => {
            assert.deepEqual(pos, { x: 2, y: 63, z: -3 });
            return below;
        }
    }, native);
    const bambooState = registry.states[native.defaults['minecraft:bamboo']];
    const bamboo = { name: bambooState.name, properties: bambooState.properties, stateId: bambooState.id };
    const pos = { x: 2, y: 64, z: -3 };
    assert.equal(rules.canStateSurvive(bamboo, pos), true);
    below = registry.states[native.defaults['minecraft:bamboo']];
    assert.equal(rules.canStateSurvive(bamboo, pos), true);
    below = registry.states[native.defaults['minecraft:stone']];
    assert.equal(rules.canStateSurvive(bamboo, pos), false);
});

test('cactus requires supports_cactus below and non-solid horizontal neighbours', () => {
    const state = name => {
        const id = native.defaults[name];
        const entry = registry.states[id];
        return { name: entry.name, properties: entry.properties, stateId: id };
    };
    let blocks = new Map();
    const at = (x, y, z) => blocks.get(`${x},${y},${z}`) ?? state('minecraft:air');
    const rules = createNativeTreeRules(data, registry, { getBlockState: ({ x, y, z }) => at(x, y, z) }, native);
    const pos = { x: 4, y: 65, z: -2 };
    const cactus = state('minecraft:cactus');
    blocks.set('4,64,-2', state('minecraft:sand'));
    assert.equal(rules.canStateSurvive(cactus, pos), true);
    blocks.set('4,64,-2', state('minecraft:red_sand'));
    assert.equal(rules.canStateSurvive(cactus, pos), true);
    blocks.set('4,64,-2', state('minecraft:suspicious_sand'));
    assert.equal(rules.canStateSurvive(cactus, pos), true);
    blocks.set('4,64,-2', cactus);
    assert.equal(rules.canStateSurvive(cactus, pos), true);
    blocks.set('4,64,-2', state('minecraft:stone'));
    assert.equal(rules.canStateSurvive(cactus, pos), false);
    blocks.set('4,64,-2', state('minecraft:sand'));
    blocks.set('5,65,-2', state('minecraft:stone'));
    assert.equal(rules.canStateSurvive(cactus, pos), false);
});

test('small mushrooms need sturdy support and dim light except on native override substrates', () => {
    let below = registry.states[native.defaults['minecraft:stone']];
    let blockLight = 12, skyHeight = 65;
    const rules = createNativeTreeRules(data, registry, {
        getBlockState: pos => {
            const state = pos.y === 63 ? below : registry.states[native.defaults['minecraft:air']];
            return { ...state, stateId: state.id };
        },
        getBlockLight: () => blockLight,
        getHeight: () => skyHeight
    }, native);
    const mushroom = registry.states[native.defaults['minecraft:brown_mushroom']];
    const state = { name: mushroom.name, properties: mushroom.properties, stateId: mushroom.id };
    const pos = { x: 0, y: 64, z: 0 };
    assert.equal(rules.canStateSurvive(state, pos), true);
    blockLight = 13;
    assert.equal(rules.canStateSurvive(state, pos), false);
    skyHeight = 64;
    blockLight = 0;
    assert.equal(rules.canStateSurvive(state, pos), false);
    below = registry.states[native.defaults['minecraft:podzol']];
    assert.equal(rules.canStateSurvive(state, pos), true);
    below = registry.states[native.defaults['minecraft:air']];
    assert.equal(rules.canStateSurvive(state, pos), false);
});

test('double vegetation places both halves, rejects obstructed tops and build-height overflow', () => {
    let above = registry.states[native.defaults['minecraft:air']];
    const writes = [];
    const rules = createNativeTreeRules(data, registry, { maxY: 320,
        getBlockState: () => ({ ...above, stateId: above.id }),
        setBlock: (state, pos, flags) => writes.push({ state, pos, flags }) }, native);
    const state = { name: 'minecraft:tall_grass', properties: { half: 'lower' } }, pos = { x: 0, y: 64, z: 0 };
    assert.equal(rules.isDoublePlant(state), true);
    assert.equal(rules.canPlaceDoublePlant(state, pos), true);
    rules.placeDoublePlant(state, pos);
    assert.deepEqual(writes.map(w => [w.state.properties.half, w.pos.y, w.flags]), [['lower', 64, 2], ['upper', 65, 2]]);
    above = registry.states[native.defaults['minecraft:water']];
    assert.equal(rules.canPlaceDoublePlant(state, pos), false);
    above = registry.states[native.defaults['minecraft:air']];
    assert.equal(rules.canPlaceDoublePlant(state, { ...pos, y: 319 }), false);
});

test('sugar cane accepts stacked cane or tagged ground with tagged adjacent fluid/block support', () => {
    const state = name => { const s = registry.states[native.defaults[name]]; return { name, properties: s.properties, stateId: s.id }; };
    let ground = state('minecraft:sand'), neighbor = state('minecraft:water');
    const rules = createNativeTreeRules(data, registry, { getBlockState: p => p.x === 0 && p.z === 0 ? ground : neighbor }, native);
    const pos = { x: 0, y: 64, z: 0 }, cane = state('minecraft:sugar_cane');
    assert.equal(rules.canStateSurvive(cane, pos), true);
    neighbor = state('minecraft:air');
    assert.equal(rules.canStateSurvive(cane, pos), false);
    ground = cane;
    assert.equal(rules.canStateSurvive(cane, pos), true);
    ground = state('minecraft:stone');
    neighbor = state('minecraft:water');
    assert.equal(rules.canStateSurvive(cane, pos), false);
});

test('native support/collision/sturdy masks distinguish every face instead of treating all blocks as cubes', () => {
    let selected = registry.states[native.defaults['minecraft:stone']];
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => ({ ...selected, stateId: selected.id }) }, native);
    const pos = { x: 0, y: 64, z: 0 };
    for (const direction of ['down', 'up', 'north', 'south', 'west', 'east']) {
        assert.equal(rules.isBlockSupportFaceFull(pos, direction), true);
        assert.equal(rules.isCollisionFaceFull(pos, direction), true);
        assert.equal(rules.isFaceSturdy(pos, direction), true);
    }
    selected = registry.states.find(s => s.name === 'minecraft:stone_slab' && s.properties.type === 'bottom' && s.properties.waterlogged === 'false');
    assert.equal(rules.isCollisionFaceFull(pos, 'down'), true);
    assert.equal(rules.isCollisionFaceFull(pos, 'up'), false);
    assert.equal(rules.isFaceSturdy(pos, 'north'), false);
    selected = registry.states[native.defaults['minecraft:air']];
    assert.equal(rules.isBlockSupportFaceFull(pos, 'up'), false);
    assert.equal(rules.getFluidState(pos).empty, true);
    assert.throws(() => rules.isFaceSturdy(pos, 'invalid'), /Invalid native support face/);
    selected = registry.states[native.defaults['minecraft:water']];
    assert.equal(rules.getFluidState(pos).id, 'minecraft:water');
    assert.equal(rules.getFluidState(pos).source, true);
});

function reader() {
    let state = registry.states[native.defaults['minecraft:air']];
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => ({ ...state, stateId: state.id }) }, native);
    return { rules, select(name, properties) {
        state = properties ? registry.states.find(state => state.name === name && Object.entries(properties).every(([key, value]) => state.properties[key] === value)) : registry.states[native.defaults[name]];
        assert.ok(state);
        return { ...state, stateId: state.id };
    } };
}

test('solid/liquid/fluid/source-water predicates read native state facts, not name heuristics', () => {
    const { rules, select } = reader(), pos = { x: 0, y: 64, z: 0 };
    select('minecraft:stone');
    assert.equal(rules.isSolid(pos), true);
    assert.equal(rules.isSolidRender(pos), true);
    assert.equal(rules.isLiquid(pos), false);
    select('minecraft:air');
    assert.equal(rules.isSolid(pos), false);
    assert.equal(rules.isReplaceable(pos), true);
    select('minecraft:water', { level: '0' });
    assert.equal(rules.isLiquid(pos), true);
    assert.equal(rules.isWater(pos), true);
    select('minecraft:water', { level: '1' });
    assert.equal(rules.isWater(pos), false);
    assert.equal(rules.isLiquid(pos), true);
    select('minecraft:oak_leaves', { waterlogged: 'true', persistent: 'false', distance: '7' });
    assert.equal(rules.isLiquid(pos), false);
    assert.equal(rules.isWater(pos), true);
    assert.equal(rules.getFluidState(pos).name, 'minecraft:water');
});

test('26.3 ocean-floor and motion heightmap predicates distinguish liquid and leaves', () => {
    const { rules, select } = reader();
    const stone = select('minecraft:stone');
    assert.equal(rules.heightmapPredicate('OCEAN_FLOOR_WG', stone), true);
    const water = select('minecraft:water', { level: '0' });
    assert.equal(rules.heightmapPredicate('WORLD_SURFACE_WG', water), true);
    assert.equal(rules.heightmapPredicate('OCEAN_FLOOR_WG', water), false);
    assert.equal(rules.heightmapPredicate('MOTION_BLOCKING', water), true);
    const leaves = select('minecraft:oak_leaves', { waterlogged: 'false', persistent: 'false', distance: '7' });
    assert.equal(rules.heightmapPredicate('MOTION_BLOCKING', leaves), true);
    assert.equal(rules.heightmapPredicate('MOTION_BLOCKING_NO_LEAVES', leaves), false);
    const wet = select('minecraft:oak_leaves', { waterlogged: 'true', persistent: 'false', distance: '7' });
    assert.equal(rules.heightmapPredicate('MOTION_BLOCKING_NO_LEAVES', wet), true);
});

test('default states retain full native properties and wrong source facts fail closed', () => {
    const { rules } = reader();
    assert.deepEqual(rules.getDefaultBlockState('minecraft:chest').properties, registry.states[native.defaults['minecraft:chest']].properties);
    assert.throws(() => rules.getDefaultBlockState('minecraft:missing'), /missing/);
    assert.throws(() => createNativeTreeRules(data, registry, { getBlockState() {} }, { ...native, source: { sha256: 'wrong' } }), /source mismatch/);
    assert.throws(() => rules.canStateSurvive('minecraft:chest'), /not ported/);
});

test('providers inherit native omitted properties, retaining explicit overrides and rejecting invalid ones', () => {
    const { rules } = reader();
    const sampler = createBlockStateProviderSampler(data, { random: { nextInt: () => 0 }, context: rules,
        stateIdFor(name, properties) {
            const state = registry.states.find(state => state.name === name &&
                Object.keys(state.properties).length === Object.keys(properties).length &&
                Object.entries(properties).every(([key, value]) => state.properties[key] === value));
            return state?.id;
        }
    });
    const ore = sampler.directState({ id: 'minecraft:redstone_ore' });
    assert.deepEqual(ore.properties, { lit: 'false' });
    assert.equal(ore.stateId, native.defaults['minecraft:redstone_ore']);
    const lit = sampler.directState({ id: 'minecraft:redstone_ore', properties: { lit: 'true' } });
    assert.equal(lit.properties.lit, 'true');
    assert.notEqual(lit.stateId, ore.stateId);
    assert.throws(() => sampler.directState({ id: 'minecraft:redstone_ore', properties: { lit: 'invalid' } }), /No vanilla state ID/);
});
