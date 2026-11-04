import test from 'node:test';
import assert from 'node:assert/strict';
import registry from '../generated/block-states.json' with { type: 'json' };
import rules from '../generated/block-rules.json' with { type: 'json' };
import { isFluidType, resolveNativeFluidState } from '../fluid-state.mjs';
import BlockLiquid from '../../../src/js/net/minecraft/client/world/block/type/BlockLiquid.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import { getLiquidBlockCornerHeights } from '../../../src/js/net/minecraft/client/render/LiquidMeshHelper.js';
import Tessellator from '../../../src/js/net/minecraft/client/render/Tessellator.js';
import EnumBlockFace from '../../../src/js/net/minecraft/util/EnumBlockFace.js';

const byName = (name, predicate = () => true) => registry.states.find(state => state.name === name && predicate(state));

test('fluid type matching accepts canonical resolver names and namespaced world API names', () => {
    assert.equal(isFluidType({ name: 'water', empty: false }, 'minecraft:water'), true);
    assert.equal(isFluidType({ name: 'minecraft:water', empty: false }, 'water'), true);
    assert.equal(isFluidType({ id: 'lava', empty: false }, 'minecraft:lava'), true);
    assert.equal(isFluidType({ name: 'water', empty: true }, 'water'), false);
    assert.equal(isFluidType({ name: 'lava', empty: false }, 'water'), false);
});

test('native fluid state resolution includes waterlogged blocks, submerged plants and fluid levels', () => {
    const slab = byName('minecraft:oak_slab', state => state.properties.waterlogged === 'true' && state.properties.type === 'bottom');
    const seagrass = byName('minecraft:seagrass');
    const source = byName('minecraft:water', state => state.properties.level === '0');
    const flowing = byName('minecraft:water', state => state.properties.level === '5');
    assert.ok(slab && seagrass && source && flowing);
    assert.deepEqual(resolveNativeFluidState(slab, rules.states[slab.id]), {
        name: 'water', source: true, level: 0, falling: false, waterlogged: true, baseHeight: 0.5, ceilingHeight: 1, stateId: slab.id
    });
    assert.equal(resolveNativeFluidState(seagrass, rules.states[seagrass.id]).name, 'water');
    assert.equal(resolveNativeFluidState(source, rules.states[source.id]).source, true);
    assert.equal(resolveNativeFluidState(flowing, rules.states[flowing.id]).level, 5);
    assert.equal(resolveNativeFluidState(registry.states[0], rules.states[0]), null);
});

test('waterlogged bottom slabs mesh a fluid surface above their solid half', () => {
    const fluidBlock = new BlockLiquid(4094, 0, 'water');
    const world = { getFluidState: (_x, y) => y === 10 ? ({ name: 'water', source: true, level: 0, waterlogged: true, baseHeight: 0.5, ceilingHeight: 1 }) : null };
    assert.equal(getLiquidBlockCornerHeights(world, 0, 10, 0, fluidBlock.id).h00, 15 / 16);
    const emitted = [];
    const tessellator = new Tessellator();
    tessellator.addVertexWithUV = (...vertex) => emitted.push(vertex);
    tessellator.addLiquidFace(world, fluidBlock.id, EnumBlockFace.WEST, 0, 0, 0, 0, 10, 0, 0, 0, 1, 1, 0.5, 0.5);
    assert.equal(emitted.length, 4);
    assert.ok(emitted.some(vertex => vertex[1] === 10.5));
    assert.ok(emitted.every(vertex => vertex[1] >= 10.5));
});

test('scheduled liquid ticks preserve levels, spread into open cells and solidify water/lava contact', () => {
    const water = new BlockLiquid(4093, 0, 'water');
    const support = new Block(4091);
    support.isReplaceable = () => false;
    water.getOppositeLiquidId = () => 4092;
    water.getSolidificationId = () => 4;
    water.getOptimalFlowDirections = () => [{ x: 1, z: 0 }];
    const cells = new Map([['0,10,0', { id: water.id, data: 0 }], ['0,9,0', { id: support.id, data: 0 }]]);
    const scheduled = [];
    const world = {
        getBlockAt: (x, y, z) => cells.get(`${x},${y},${z}`)?.id ?? 0,
        getBlockDataAt: (x, y, z) => cells.get(`${x},${y},${z}`)?.data ?? 0,
        setBlockAt(x, y, z, id, data = 0) { cells.set(`${x},${y},${z}`, { id, data }); },
        scheduleBlockTick: (x, y, z, delay) => scheduled.push({ x, y, z, delay })
    };
    water.updateFlow(world, 0, 10, 0);
    assert.deepEqual(cells.get('1,10,0'), { id: water.id, data: 1 });
    assert.ok(scheduled.some(tick => tick.x === 1 && tick.y === 10 && tick.delay === water.tickRate));
    cells.set('0,10,1', { id: 4092, data: 0 });
    assert.equal(water.checkContact(world, 0, 10, 0), true);
    assert.deepEqual(cells.get('0,10,1'), { id: 4, data: 0 });
});
