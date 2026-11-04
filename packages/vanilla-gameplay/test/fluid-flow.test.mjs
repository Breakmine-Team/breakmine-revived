import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeFluidFlow } from '../fluid-flow.mjs';
import { applyFluidCurrent } from '../movement.mjs';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';

const water = { name: 'water', level: 0 };
test('uniform water has no current; lower eastern level pulls east', () => {
    let lower = false;
    const world = { getFluidState: x => lower && x === 1 ? { name: 'water', level: 4 } : water };
    assert.deepEqual(nativeFluidFlow(world, 0, 0, 0, water), { x: 0, y: 0, z: 0 });
    lower = true;
    assert.deepEqual(nativeFluidFlow(world, 0, 0, 0, water), { x: 1, y: 0, z: 0 });
});

test('falling water along sturdy walls pulls down; ice is excluded by JAR semantics', () => {
    const falling = { name: 'water', level: 8, falling: true };
    let ice = false;
    const world = { getFluidState: x => x === 1 ? null : falling,
        getNativeBlockStateAt: x => ({ name: x === 1 ? ice ? 'minecraft:ice' : 'minecraft:stone' : 'minecraft:water' }),
        getSpawnBlockRulesAt: () => ({ faces: { sturdy: 63 } }) };
    assert.equal(nativeFluidFlow(world, 0, 0, 0, falling).y, -1);
    ice = true;
    assert.equal(nativeFluidFlow(world, 0, 0, 0, falling).y, 0);
});

test('current maps world direction into living movement and skips flying players', () => {
    const entity = { x: .5, y: .1, z: .5, ticksExisted: 1, motionX: 0, motionY: 0, motionZ: 0,
        boundingBox: new BoundingBox(.2, .1, .2, .8, 1.9, .8), updatePlayerPose() {},
        world: { getFluidState: () => water, getFluidFlowAt: () => ({ x: 1, y: 0, z: 0 }) } };
    applyFluidCurrent(entity);
    assert.equal(entity.motionX, -.014);
    entity.flying = true;
    applyFluidCurrent(entity);
    assert.equal(entity.motionX, -.014);
});
