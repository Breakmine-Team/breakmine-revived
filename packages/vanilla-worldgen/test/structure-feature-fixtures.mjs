import { createConfiguredFeaturePlacer } from '../features.mjs';
import { FOSSIL_MODES, fossilFeature, runFossilFixture } from './fossil-fixtures.mjs';

export const STRUCTURE_FEATURE_MODES = Object.freeze([
    'geode', 'geode_no_crack', 'geode_buds', 'geode_water', 'geode_flooded', 'geode_lava', 'geode_protected', 'geode_invalid', 'geode_air', 'geode_small', 'geode_shifted', 'geode_flatnoise', 'geode_custom', 'geode_weighted',
    'lichen_floor', 'lichen_ceiling', 'lichen_wall', 'lichen_water', 'lichen_flowing', 'lichen_blocked', 'lichen_search', 'lichen_wrap', 'lichen_slab', 'lichen_none',
    'vein_floor', 'vein_water', 'vein_wrap', 'vein_reject', 'vein_replace', 'vein_fire',
    'bonus', 'bonus_collision', 'bonus_blocked', 'bonus_missing', 'bonus_uneven', 'bonus_torches',
    'room', 'room_no_doors', 'room_many_doors', 'room_floor', 'room_ceiling', 'room_protected', 'room_missing', 'room_existing', 'room_glass',
    'end_spike', 'end_spike_guard', 'end_spike_beam', 'end_spike_missing', 'end_spike_default', 'end_spike_far', 'end_spike_negative', 'end_spike_multi',
    ...FOSSIL_MODES
]);
const state = (name, properties = {}) => ({ name: `minecraft:${name}`, properties });
const direct = name => ({ id: `minecraft:${name}` });
const uniform = (min, max) => ({ type: 'minecraft:uniform', min_inclusive: min, max_inclusive: max });
export function structureFeature(mode) {
    if (mode.startsWith('fossil_')) return fossilFeature(mode);
    if (mode.startsWith('geode')) return {
        type: 'minecraft:geode', blocks: {
            filling_provider: direct(mode === 'geode_custom' || mode === 'geode_flooded' ? 'water' : 'air'), inner_layer_provider: direct('amethyst_block'), alternate_inner_layer_provider: direct('budding_amethyst'),
            middle_layer_provider: direct('calcite'), outer_layer_provider: mode === 'geode_weighted' ? {
                type: 'minecraft:weighted', entries: [{ weight: 3, data: direct('smooth_basalt') }, { weight: 2, data: direct('andesite') }]
            } : direct('smooth_basalt'),
            inner_placements: ['minecraft:small_amethyst_bud', 'minecraft:medium_amethyst_bud', 'minecraft:large_amethyst_bud', 'minecraft:amethyst_cluster'],
            cannot_replace: 'minecraft:bedrock', invalid_blocks: 'minecraft:lava'
        }, layers: mode === 'geode_custom' ? { filling: 1.2, inner_layer: 2, middle_layer: 4, outer_layer: 6 } : {},
        crack: { generate_crack_chance: mode === 'geode_no_crack' ? 0 : mode === 'geode_custom' ? 1 : 0.95 },
        outer_wall_distance: uniform(4, 6), use_alternate_layer0_chance: ['geode_buds', 'geode_water', 'geode_flooded'].includes(mode) ? 1 : 0.083,
        invalid_blocks_threshold: 1,
        ...(mode === 'geode_buds' ? { use_potential_placements_chance: 1 } : {}),
        ...(mode === 'geode_small' ? { min_gen_offset: -4, max_gen_offset: 4, distribution_points: 1, point_offset: 1 } : {}),
        ...(mode === 'geode_flatnoise' ? { noise_multiplier: 0 } : {}),
        ...(mode === 'geode_custom' ? { placements_require_layer0_alternate: false, distribution_points: 5, point_offset: 2, crack: { generate_crack_chance: 1, base_crack_size: 3, crack_point_offset: 0 } } : {})
    };
    if (mode.startsWith('lichen_') || mode.startsWith('vein_')) return {
        type: 'minecraft:multiface_growth', block: `minecraft:${mode.startsWith('vein_') ? 'sculk_vein' : 'glow_lichen'}`,
        can_be_placed_on: ['minecraft:stone', 'minecraft:stone_slab'], search_range: 20,
        can_place_on_floor: true, can_place_on_ceiling: true, can_place_on_wall: true,
        chance_of_spreading: mode === 'lichen_none' ? 0 : 1
    };
    if (mode.startsWith('bonus')) return { type: 'minecraft:bonus_chest' };
    if (mode.startsWith('room')) return { type: 'minecraft:monster_room' };
    if (mode.startsWith('end_spike')) return { type: 'minecraft:end_spike',
        spikes: mode === 'end_spike_default' || mode === 'end_spike_far' ? [] : [
            { centerX: mode === 'end_spike_negative' ? -1 : 0, centerZ: 0, radius: 2, height: 70, guarded: mode === 'end_spike_guard' },
            ...(mode === 'end_spike_multi' ? [{ centerX: 5, centerZ: 5, radius: 1, height: 68, guarded: true }, { centerX: 16, centerZ: 0, radius: 1, height: 69, guarded: false }] : [])
        ], ...(mode === 'end_spike_beam' ? { crystal_invulnerable: true, crystal_beam_target: [12, 30, -5] } : {}) };
    throw new Error(`Unknown structure fixture: ${mode}`);
}

export function structureOrigin(mode) {
    return { x: mode === 'geode_shifted' ? -21 : mode === 'end_spike_default' ? 32 : mode === 'end_spike_far' ? 1000 : mode === 'end_spike_negative' ? -1 : 0,
        y: 20, z: mode === 'geode_shifted' ? 31 : 0 };
}

export function structureBase(mode, pos) {
    const { x, y, z } = pos;
    if (mode.startsWith('geode')) {
        if (mode === 'geode_air') return state('air');
        if (mode === 'geode_invalid') return state('lava', { level: '0' });
        if (mode === 'geode_water' || mode === 'geode_flooded') return state('water', { level: '0' });
        if (mode === 'geode_lava' && y <= 20) return state('lava', { level: '0' });
        if (mode === 'geode_protected' && (x + z) % 3 === 0) return state('bedrock');
        return state('stone');
    }
    if (mode.startsWith('lichen_') || mode.startsWith('vein_')) {
        if (mode === 'lichen_blocked') return state('stone');
        if (mode === 'lichen_ceiling') return state(y >= 21 ? 'stone' : 'air');
        if (mode === 'lichen_wall') return state(x >= 1 ? 'stone' : 'air');
        if (mode === 'lichen_search') return state(x >= 2 ? 'stone' : 'air');
        if (mode === 'lichen_wrap' || mode === 'vein_wrap') return state(x === 0 && z === 0 && y === 19 ? 'stone' : 'air');
        if (mode === 'lichen_slab' && y < 20) return state('stone_slab', { type: 'bottom', waterlogged: 'false' });
        if (y < 20) return state('stone');
        if (mode === 'vein_reject' && (x !== 0 || z !== 0)) return state('sculk');
        if (mode === 'vein_replace' && (x !== 0 || z !== 0)) return state('short_grass');
        if (mode === 'vein_fire' && (x !== 0 || z !== 0)) return structureDefaultState('minecraft:fire');
        if (mode === 'lichen_water' || mode === 'vein_water') return state('water', { level: '0' });
        if (mode === 'lichen_flowing') return state('water', { level: '1' });
        return state('air');
    }
    if (mode.startsWith('bonus')) {
        if (mode === 'bonus_blocked') return state('stone');
        if (mode === 'bonus_collision' && y === 32) return state('short_grass');
        const ground = mode === 'bonus_uneven' ? 30 + Math.abs(x + z) % 4 : 32;
        if (mode === 'bonus_torches' && y === 31 && (x + z) % 2 === 0) return state('air');
        return state(y < ground ? 'stone' : 'air');
    }
    if (mode.startsWith('room')) {
        if (mode === 'room_floor' && y === 19 || mode === 'room_ceiling' && y === 24) return state('air');
        if (mode !== 'room_no_doors' && (y === 20 || y === 21) && z === 0 && x >= 2) return state('air');
        if (mode === 'room_many_doors' && (y === 20 || y === 21)) return state('air');
        if (mode === 'room_existing' && y === 20 && x === 0 && z === 1) return structureDefaultState('minecraft:chest');
        if (mode === 'room_existing' && y === 20 && x === 1 && z === 1) return state('spawner');
        if (mode === 'room_protected' && (x + y + z) % 5 === 0) return state('bedrock');
        return state(mode === 'room_glass' ? 'glass' : 'stone');
    }
    return state('end_stone');
}

export function structureDefaultState(name) {
    const properties = name === 'minecraft:chest' ? { facing: 'north', type: 'single', waterlogged: 'false' }
        : name === 'minecraft:glow_lichen' || name === 'minecraft:sculk_vein' ? { down: 'false', up: 'false', north: 'false', south: 'false', west: 'false', east: 'false', waterlogged: 'false' }
        : name.includes('amethyst_bud') || name === 'minecraft:amethyst_cluster' ? { facing: 'up', waterlogged: 'false' }
        : name === 'minecraft:iron_bars' ? { north: 'false', south: 'false', west: 'false', east: 'false', waterlogged: 'false' }
        : name === 'minecraft:fire' ? { age: '0', up: 'false', north: 'false', south: 'false', west: 'false', east: 'false' }
        : name === 'minecraft:water' || name === 'minecraft:lava' ? { level: '0' } : {};
    return { name, properties };
}

export function createStructureFixtureWorld(mode, seed = '0', base = pos => structureBase(mode, pos)) {
    const writes = [], marks = [], ticks = [], effects = [], blocks = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    const context = {
        seed, minY: 0, maxY: 128, seaLevel: 32,
        getBlockState: pos => blocks.get(key(pos)) ?? base(pos),
        getDefaultBlockState: structureDefaultState,
        getFluidState: pos => {
            const s = context.getBlockState(pos), water = s.name === 'minecraft:water' || s.properties.waterlogged === 'true', lava = s.name === 'minecraft:lava';
            return { id: water ? s.properties.level === '1' ? 'minecraft:flowing_water' : 'minecraft:water' : lava ? 'minecraft:lava' : 'minecraft:empty',
                empty: !water && !lava, source: (water || lava) && (!s.properties.level || s.properties.level === '0'), full: (water || lava) && (!s.properties.level || s.properties.level === '0') };
        },
        isAir: pos => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(context.getBlockState(pos).name),
        isSolid: pos => !context.isAir(pos) && !['minecraft:water', 'minecraft:lava', 'minecraft:glow_lichen', 'minecraft:sculk_vein', 'minecraft:short_grass', 'minecraft:fire'].includes(context.getBlockState(pos).name),
        isSolidRender: pos => context.isSolid(pos) && !['minecraft:glass', 'minecraft:stone_slab', 'minecraft:spawner', 'minecraft:chest'].includes(context.getBlockState(pos).name),
        isCollisionShapeEmpty: pos => context.isAir(pos) || context.getBlockState(pos).name === 'minecraft:short_grass',
        isBlockSupportFaceFull: (pos, face) => context.getBlockState(pos).name === 'minecraft:stone_slab' ? face === 'down' : context.isSolid(pos),
        isCollisionFaceFull: (pos, face) => context.isBlockSupportFaceFull(pos, face),
        isFaceSturdy: (pos, face) => context.isBlockSupportFaceFull(pos, face),
        isReplaceable: pos => context.isAir(pos) || ['minecraft:short_grass', 'minecraft:water', 'minecraft:fire'].includes(context.getBlockState(pos).name),
        isBlockInTag: (s, tag) => tag === 'minecraft:features_cannot_replace' && s.name === 'minecraft:bedrock' || tag === 'minecraft:geode_invalid_blocks' && s.name === 'minecraft:lava' || tag === 'minecraft:fire' && s.name === 'minecraft:fire',
        getHeight: (type, x, z) => mode === 'bonus_uneven' ? 30 + Math.abs(x + z) % 4 : 32,
        markPosForPostProcessing: pos => marks.push([pos.x, pos.y, pos.z]),
        scheduleFluidTick: (fluid, pos, delay) => ticks.push({ ...pos, type: 'fluid', name: fluid.id, delay }),
        hasLootContainer: pos => mode !== 'bonus_missing' && mode !== 'room_missing' && context.getBlockState(pos).name === 'minecraft:chest',
        setLootTable: (pos, table, lootSeed) => effects.push({ ...pos, kind: 'loot', table, seed: String(lootSeed), afterWrites: writes.length }),
        hasSpawnerBlockEntity: pos => mode !== 'room_missing' && context.getBlockState(pos).name === 'minecraft:spawner',
        setSpawnerEntity: (pos, entity) => effects.push({ ...pos, kind: 'spawner', entity, afterWrites: writes.length }),
        canCreateEndCrystal: () => mode !== 'end_spike_missing',
        spawnEndCrystal: descriptor => effects.push({ kind: 'crystal', ...descriptor, afterWrites: writes.length }),
        getFireState: () => structureDefaultState('minecraft:fire')
    };
    const write = (s, pos, flags) => { blocks.set(key(pos), s); writes.push({ ...pos, name: s.name, properties: s.properties, flags }); return true; };
    const canSurvive = (s, pos) => s.name !== 'minecraft:torch' || context.isFaceSturdy({ ...pos, y: pos.y - 1 }, 'up');
    const directState = value => typeof value === 'string' ? { name: value, properties: {} } : { name: value.id, properties: { ...value.properties } };
    return { context, writes, marks, ticks, effects, write, canSurvive, options: { context, directState, setBlock: write, canSurvive } };
}

export function runStructureFixture(mode, random, seed = '0', suppliedFeature = structureFeature(mode)) {
    if (mode.startsWith('fossil_')) return runFossilFixture(mode, random, seed, createStructureFixtureWorld);
    const { context, writes, marks, ticks, effects, write, canSurvive } = createStructureFixtureWorld(mode, seed);
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, setBlock: write, canSurvive });
    const succeeded = place('<oracle>', suppliedFeature, structureOrigin(mode), random, context);
    return { succeeded, writes, marks, ticks, effects, destroyed: [], gatewayExits: [], nextLong: String(random.nextLong()) };
}
