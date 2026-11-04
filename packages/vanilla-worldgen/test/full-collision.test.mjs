import test from 'node:test';
import assert from 'node:assert/strict';
import data from '../generated/vanilla-data.json' with { type: 'json' };
import registry from '../generated/block-states.json' with { type: 'json' };
import imported from '../generated/block-rules.json' with { type: 'json' };
import { createNativeTreeRules } from '../native-tree-rules.mjs';

test('native collision volume predicate is imported for every registry state', () => {
    for (const state of registry.states) assert.equal(typeof imported.states[state.id].collisionFullBlock, 'boolean');
});

test('full collision uses the native volume predicate rather than six face masks', () => {
    const state = registry.states.find(state => state.name === 'minecraft:stone');
    const facts = { ...imported, states: imported.states.slice() };
    facts.states[state.id] = { ...facts.states[state.id], collisionFullBlock: false, faces: { collision: 63 } };
    const rules = createNativeTreeRules(data, registry, { getBlockState: () => ({ ...state, stateId: state.id }) }, facts);
    assert.equal(rules.isCollisionFaceFull({ x: 0, y: 0, z: 0 }, 'up'), true);
    assert.equal(rules.isCollisionShapeFullBlock({ x: 0, y: 0, z: 0 }), false);
    delete facts.states[state.id].collisionFullBlock;
    assert.throws(() => rules.isCollisionShapeFullBlock({ x: 0, y: 0, z: 0 }), /reimport block rules/);
});
