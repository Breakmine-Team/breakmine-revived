import test from 'node:test';
import assert from 'node:assert/strict';
import { createMaterialRuleEvaluator } from '../material-rules.mjs';

const grass = 17;
const dirt = 23;
const states = { 'minecraft:grass_block': grass, 'minecraft:dirt': dirt };
const data = {
    'data/minecraft/worldgen/material_rule/test/root.json': {
        type: 'minecraft:sequence',
        sequence: [
            { type: 'minecraft:condition', if_true: 'minecraft:not_underwater', then_run: 'minecraft:test/grass' },
            'minecraft:test/dirt'
        ]
    },
    'data/minecraft/worldgen/material_rule/test/grass.json': { type: 'minecraft:block', result_state: 'minecraft:grass_block' },
    'data/minecraft/worldgen/material_rule/test/dirt.json': { type: 'minecraft:block', result_state: 'minecraft:dirt' },
    'data/minecraft/worldgen/material_condition/not_underwater.json': {
        type: 'minecraft:water', offset: -1, surface_depth_multiplier: 0, add_stone_depth: false
    },
    'data/minecraft/worldgen/material_condition/on_floor.json': { type: 'minecraft:stone_depth', offset: 0, add_surface_depth: false, secondary_depth_range: 0, surface_type: 'floor' },
    'data/minecraft/worldgen/material_condition/on_ceiling.json': { type: 'minecraft:stone_depth', offset: 0, add_surface_depth: false, secondary_depth_range: 0, surface_type: 'ceiling' },
    'data/minecraft/worldgen/material_condition/under_floor.json': { type: 'minecraft:stone_depth', offset: 0, add_surface_depth: true, secondary_depth_range: 0, surface_type: 'floor' },
    'data/minecraft/worldgen/material_condition/not_under_deep_water.json': { type: 'minecraft:water', offset: -6, surface_depth_multiplier: -1, add_stone_depth: true }
};

test('vanilla material rule references, sequence fallthrough, and block results', () => {
    const evaluator = createMaterialRuleEvaluator(data, {
        blockStates: states,
        conditionHandlers: { 'minecraft:water': () => false }
    });
    const dry = { blockX: 0, blockY: 60, blockZ: 0, surfaceDepth: 1, stoneDepthAbove: 1, waterHeight: -0x80000000 };
    assert.equal(evaluator.evaluate('minecraft:test/root', dry), grass);
    assert.equal(evaluator.evaluate('minecraft:test/root', { ...dry, waterHeight: 70 }), dirt);
});

test('condition handlers require exact boolean output and unknown rules fail closed', () => {
    const evaluator = createMaterialRuleEvaluator(data, { blockStates: states });
    assert.throws(() => evaluator.evaluate({ type: 'minecraft:bandlands' }, {}), /requires getBadlandsBand/);
    assert.throws(() => createMaterialRuleEvaluator(data, { blockStates: states }).evaluateCondition('minecraft:missing', {}), /Missing vanilla material condition/);
});

test('missing block mappings and malformed references are explicit errors', () => {
    const evaluator = createMaterialRuleEvaluator(data, { blockStates: {} });
    assert.throws(() => evaluator.evaluate('minecraft:test/grass', {}), /Missing block-state mapping/);
    assert.throws(() => evaluator.evaluate('minecraft:../outside', {}), /Invalid material rule resource/);
});

test('26.3 material predicates use block column context and inclusive vanilla boundaries', () => {
    const evaluator = createMaterialRuleEvaluator(data, { blockStates: states });
    const context = {
        blockX: 2, blockY: 70, blockZ: -3, surfaceDepth: 2, surfaceSecondary: 0.5,
        surfaceGradientX: -4, surfaceGradientZ: 0, stoneDepthAbove: 1,
        stoneDepthBelow: 3, waterHeight: 72, minSurfaceLevel: 70, biome: 'minecraft:plains'
    };
    assert.equal(evaluator.evaluateCondition('minecraft:on_floor', context), true);
    assert.equal(evaluator.evaluateCondition('minecraft:on_ceiling', context), false);
    assert.equal(evaluator.evaluateCondition('minecraft:under_floor', context), true);
    assert.equal(evaluator.evaluateCondition('minecraft:not_underwater', context), false);
    assert.equal(evaluator.evaluateCondition('minecraft:not_under_deep_water', context), true);
    assert.equal(evaluator.evaluateCondition('minecraft:on_floor', { ...context, stoneDepthAbove: 2 }), false);

    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:above_preliminary_surface' }, context), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:hole' }, { ...context, surfaceDepth: 0 }), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:steep' }, context), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:biome', biome_is: ['minecraft:plains', 'minecraft:forest'] }, context), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:y_above', anchor: { absolute: 68 }, surface_depth_multiplier: 1, add_stone_depth: false }, {
        ...context, resolveAnchorY: anchor => anchor.absolute
    }), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:noise_threshold', noise: 'minecraft:surface', min_threshold: -0.25, max_threshold: 0.25 }, {
        ...context, sampleNoise: id => id === 'minecraft:surface' ? 0.25 : NaN
    }), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:temperature' }, {
        ...context, seaLevel: 63, isColdAt: (x, y, z, seaLevel) => x === 2 && y === 70 && z === -3 && seaLevel === 63
    }), true);
    assert.equal(evaluator.evaluateCondition({ type: 'minecraft:vertical_gradient' }, {
        ...context, verticalGradient: () => false
    }), false);
});

test('water checks handle no-fluid sentinel and Java integer comparisons', () => {
    const evaluator = createMaterialRuleEvaluator(data, { blockStates: states });
    const notUnderwater = 'minecraft:not_underwater';
    const base = { blockX: 0, blockY: 62, blockZ: 0, surfaceDepth: 4, stoneDepthAbove: 2, waterHeight: 63 };
    assert.equal(evaluator.evaluateCondition(notUnderwater, base), true);
    assert.equal(evaluator.evaluateCondition(notUnderwater, { ...base, blockY: 60 }), false);
    assert.equal(evaluator.evaluateCondition(notUnderwater, { ...base, waterHeight: -0x80000000 }), true);
});

test('26.3 ore-vein rule uses staged density, positional draws, and ore/filler selection', () => {
    const evaluator = createMaterialRuleEvaluator(data, {
        blockStates: {
            ...states,
            'minecraft:copper_ore': 31,
            'minecraft:raw_copper_block': 32,
            'minecraft:granite': 33
        }
    });
    const rule = {
        type: 'minecraft:ore_vein',
        ore_block: 'minecraft:copper_ore', raw_ore_block: 'minecraft:raw_copper_block',
        filler_block: 'minecraft:granite', raw_ore_chance: 0.02,
        density: 'minecraft:overworld/ore_vein/copper_density',
        richness: 'minecraft:overworld/ore_vein/richness',
        filler_gap: 'minecraft:overworld/ore_vein/gap'
    };
    const values = {
        'minecraft:overworld/ore_vein/copper_density': 0.5,
        'minecraft:overworld/ore_vein/richness': 0.8,
        'minecraft:overworld/ore_vein/gap': -0.1
    };
    const draws = [0.3, 0.7, 0.01];
    const context = {
        sampleDensity: id => values[id],
        randomFloat: (name, index) => { assert.equal(name, 'minecraft:ore'); return draws[index]; }
    };
    assert.equal(evaluator.evaluate(rule, context), 32);
    assert.equal(evaluator.evaluate(rule, { ...context, randomFloat: (_name, index) => index === 2 ? 0.03 : draws[index] }), 31);
    assert.equal(evaluator.evaluate(rule, { ...context, sampleDensity: id => id.endsWith('/gap') ? 0 : values[id] }), 33);
    assert.equal(evaluator.evaluate(rule, { ...context, randomFloat: (_name, index) => index === 0 ? 0.6 : draws[index] }), null);
    assert.equal(evaluator.evaluate(rule, { ...context, sampleDensity: () => 0 }), null);
});
