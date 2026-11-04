import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../generated/vanilla-data.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };
import stateRules from '../generated/block-rules.json' with { type: 'json' };
import { createNativeBlockTags, createNativeTreeRules } from '../native-tree-rules.mjs';

test('bundled native block tags resolve all 300 definitions without missing registry blocks', () => {
    const tags = createNativeBlockTags(data, registry);
    const paths = Object.keys(data).filter(path => path.startsWith('data/minecraft/tags/block/'));
    assert.equal(paths.length, 300);
    for (const path of paths) assert.ok(Array.isArray(tags.resolveBlockTag(`minecraft:${path.slice('data/minecraft/tags/block/'.length, -5)}`)));
    assert.equal(tags.isBlockInTag('minecraft:oak_leaves', 'minecraft:replaceable_by_trees'), true);
    assert.equal(tags.isBlockInTag('minecraft:oak_log', 'minecraft:logs'), true);
    assert.equal(tags.isBlockInTag('minecraft:dirt', 'minecraft:logs'), false);
});

test('tag resolution rejects cycles and missing required entries, permits optional entries and deduplicates', () => {
    const fixture = {
        'data/minecraft/tags/block/a.json': { values: ['minecraft:stone', 'minecraft:stone', { id: 'minecraft:absent', required: false }] },
        'data/minecraft/tags/block/b.json': { values: ['#minecraft:c'] },
        'data/minecraft/tags/block/c.json': { values: ['#minecraft:b'] },
        'data/minecraft/tags/block/d.json': { values: ['minecraft:absent'] }
    };
    const tags = createNativeBlockTags(fixture, registry);
    assert.deepEqual(tags.resolveBlockTag('minecraft:a'), ['minecraft:stone']);
    assert.throws(() => tags.resolveBlockTag('minecraft:b'), /cycle/);
    assert.throws(() => tags.resolveBlockTag('minecraft:d'), /Missing block/);
    assert.throws(() => tags.resolveBlockTag('minecraft:absent'), /Missing native block tag/);
});

test('26.3 tree predicates distinguish replaceable positions, logs, leaves, vines and water', () => {
    let name = 'minecraft:air';
    let properties = {};
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => ({ name, properties }) });
    const pos = { x: -1, y: 64, z: 0 };
    for (name of ['minecraft:air', 'minecraft:cave_air', 'minecraft:oak_leaves', 'minecraft:short_grass', 'minecraft:water']) {
        assert.equal(rules.isValidTreePos(pos), true, name);
    }
    name = 'minecraft:oak_log';
    assert.equal(rules.isValidTreePos(pos), false);
    assert.equal(rules.isTreeFreePos(pos), true);
    assert.equal(rules.isAirOrLeaves(pos), false);
    name = 'minecraft:stone';
    assert.equal(rules.isTreeFreePos(pos), false);
    name = 'minecraft:vine';
    assert.equal(rules.isVine(pos), true);
    name = 'minecraft:water';
    properties = { level: '0' };
    assert.equal(rules.isWater(pos), true);
    properties.level = '1';
    assert.equal(rules.isWater(pos), false);
    name = 'minecraft:oak_leaves';
    properties = { waterlogged: 'true' };
    assert.equal(rules.isWater(pos), true);
});

test('tree ground decorators receive air-or-vine, replaceability and no-leaves height context', () => {
    const state = name => {
        const id = stateRules.defaults[name];
        const entry = registry.states[id];
        return { name: entry.name, properties: entry.properties, stateId: id };
    };
    const air = state('minecraft:air');
    const vine = state('minecraft:vine');
    const leaves = state('minecraft:oak_leaves');
    const stone = state('minecraft:stone');
    const rules = createNativeTreeRules(data, registry, {
        minY: 0,
        maxY: 16,
        getBlockState(pos) {
            if (pos.y === 10) return leaves;
            if (pos.y === 5) return stone;
            if (pos.y === 1) return vine;
            return air;
        }
    }, stateRules);
    assert.equal(rules.isAirOrVine({ x: 0, y: 0, z: 0 }), true);
    assert.equal(rules.isAirOrVine({ x: 0, y: 1, z: 0 }), true);
    assert.equal(rules.isAirOrVine({ x: 0, y: 10, z: 0 }), false);
    assert.equal(rules.isReplaceable({ x: 0, y: 0, z: 0 }), true);
    assert.equal(rules.heightmapPredicate('MOTION_BLOCKING_NO_LEAVES', leaves), false);
    assert.equal(rules.heightmapPredicate('MOTION_BLOCKING_NO_LEAVES', stone), true);
});

test('remaining tree decorators use native log, mangrove, shelf-mushroom and nearby-water rules', () => {
    const state = name => {
        const id = stateRules.defaults[name];
        const entry = registry.states[id];
        return { name: entry.name, properties: entry.properties, stateId: id };
    };
    const states = new Map([
        ['minecraft:air', state('minecraft:air')],
        ['minecraft:mangrove_log', state('minecraft:mangrove_log')],
        ['minecraft:mud', state('minecraft:mud')],
        ['minecraft:shelf_mushroom', state('minecraft:shelf_mushroom')],
        ['minecraft:water', state('minecraft:water')]
    ]);
    const rules = createNativeTreeRules(data, registry, {
        getBlockState(pos) {
            if (pos.y === 1) return states.get('minecraft:mangrove_log');
            if (pos.y === 2) return states.get('minecraft:mud');
            if (pos.y === 3) return states.get('minecraft:shelf_mushroom');
            if (pos.x === 1) return states.get('minecraft:water');
            return states.get('minecraft:air');
        }
    }, stateRules);
    assert.equal(rules.isLog({ x: 0, y: 1, z: 0 }), true);
    assert.equal(rules.canMangroveRootGrowThrough({ x: 0, y: 1, z: 0 }, '#minecraft:mangrove_logs_can_grow_through'), true);
    assert.equal(rules.isMuddyRootsIn({ x: 0, y: 2, z: 0 }, ['minecraft:mud', 'minecraft:muddy_mangrove_roots']), true);
    assert.equal(rules.hasShelfMushroomAt({ x: 0, y: 3, z: 0 }), true);
    assert.equal(rules.isWaterOrWaterNearby({ x: 0, y: 4, z: 0 }), true);
});

test('short grass, fern and firefly bush use the native supports_vegetation substrate tag', () => {
    let substrate = 'minecraft:grass_block';
    const pos = { x: 1, y: 64, z: -1 };
    const rules = createNativeTreeRules(data, registry, { getBlockState(p) {
        assert.deepEqual(p, { ...pos, y: 63 });
        return { name: substrate, properties: {} };
    } });
    for (const name of ['minecraft:short_grass', 'minecraft:fern', 'minecraft:firefly_bush']) {
        substrate = 'minecraft:grass_block';
        assert.equal(rules.canStateSurvive(name, pos), true);
        substrate = 'minecraft:stone';
        assert.equal(rules.canStateSurvive(name, pos), false);
    }
});

test('leaf litter survives exactly on a substrate with a sturdy upward face', () => {
    const state = name => {
        const id = stateRules.defaults[name];
        const entry = registry.states[id];
        return { name: entry.name, properties: entry.properties, stateId: id };
    };
    const pos = { x: 1, y: 64, z: -1 };
    let substrate = state('minecraft:stone');
    const rules = createNativeTreeRules(data, registry, {
        getBlockState(p) {
            assert.deepEqual(p, { ...pos, y: 63 });
            return substrate;
        }
    }, stateRules);
    assert.equal(rules.canStateSurvive('minecraft:leaf_litter', pos), true);
    substrate = state('minecraft:oak_leaves');
    assert.equal(rules.canStateSurvive('minecraft:leaf_litter', pos), false);
});

test('lily pads survive only above a source-water fluid state', () => {
    const native = (name, properties = {}) => {
        const state = registry.states.find(entry => entry.name === name &&
            Object.entries(properties).every(([key, value]) => entry.properties[key] === value));
        assert.ok(state, `missing ${name} ${JSON.stringify(properties)}`);
        return { name: state.name, properties: state.properties, stateId: state.id };
    };
    const pos = { x: -3, y: 64, z: 5 };
    let support = native('minecraft:water', { level: '0' });
    const rules = createNativeTreeRules(data, registry, {
        getBlockState(query) { return query.y === pos.y - 1 ? support : native('minecraft:air'); }
    }, stateRules);
    assert.equal(rules.canStateSurvive('minecraft:lily_pad', pos), true);
    support = native('minecraft:water', { level: '1' });
    assert.equal(rules.canStateSurvive('minecraft:lily_pad', pos), false);
    support = native('minecraft:stone');
    assert.equal(rules.canStateSurvive('minecraft:lily_pad', pos), false);
});

test('living and dead coral wall fans require the sturdy face opposite their facing', () => {
    const directions = {
        north: { support: { x: 0, z: 1 }, face: 'north' },
        south: { support: { x: 0, z: -1 }, face: 'south' },
        west: { support: { x: 1, z: 0 }, face: 'west' },
        east: { support: { x: -1, z: 0 }, face: 'east' }
    };
    const pos = { x: 12, y: 40, z: -7 };
    let facing = 'north';
    let support = registry.states.find(state => state.id === stateRules.defaults['minecraft:stone']);
    const rules = createNativeTreeRules(data, registry, {
        getBlockState(query) {
            assert.deepEqual(query, { x: pos.x + directions[facing].support.x, y: pos.y,
                z: pos.z + directions[facing].support.z });
            return { name: support.name, properties: support.properties, stateId: support.id };
        }
    }, stateRules);

    for (const name of ['minecraft:tube_coral_wall_fan', 'minecraft:dead_tube_coral_wall_fan']) {
        for (facing of Object.keys(directions)) {
            const fan = { name, properties: { facing, waterlogged: 'false' } };
            assert.equal(rules.canStateSurvive(fan, pos), true, `${name} ${facing} on stone`);
            support = registry.states.find(state => state.id === stateRules.defaults['minecraft:air']);
            assert.equal(rules.canStateSurvive(fan, pos), false, `${name} ${facing} without support`);
            support = registry.states.find(state => state.id === stateRules.defaults['minecraft:stone']);
        }
    }
});
