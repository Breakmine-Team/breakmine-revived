import { createConfiguredFeaturePlacer } from '../features.mjs';
import { createBlockPredicateTester } from '../feature-world.mjs';
import { STRUCTURE_FEATURE_MODES, structureFeature, runStructureFixture } from './structure-feature-fixtures.mjs';

const direct = id => ({ id: `minecraft:${id}` });
const uniform = (min, max) => ({ type: 'minecraft:uniform', min_inclusive: min, max_inclusive: max });
const matching = blocks => ({ type: 'minecraft:matching_blocks', blocks: `minecraft:${blocks}` });
const unit = (provider, placement = []) => ({ feature: { type: 'minecraft:block_column', layers: [{ height: 1, provider }], direction: 'up', allowed_placement: matching('air'), prioritize_tip: false }, placement });
export function oracleFeature(mode) {
    if (STRUCTURE_FEATURE_MODES.includes(mode)) return structureFeature(mode);
    switch (mode) {
        case 'iceberg_packed': case 'iceberg_blue': case 'iceberg_blocked': case 'iceberg_frozen': case 'iceberg_snow_layers': case 'iceberg_dry': case 'iceberg_holes': case 'iceberg_cave_air':
            return { type: 'minecraft:iceberg', state: `minecraft:${mode === 'iceberg_blue' ? 'blue_ice' : 'packed_ice'}` };
        case 'podium_active': case 'podium_inactive': case 'podium_air': case 'podium_preexisting': case 'podium_stone': case 'podium_water':
            return { type: 'minecraft:end_podium', active: mode !== 'podium_inactive' };
        case 'gateway_delayed': case 'gateway_return': case 'gateway_search': case 'gateway_missing': case 'gateway_wrong':
            return { type: 'minecraft:end_gateway', exact: mode !== 'gateway_search' && mode !== 'gateway_delayed', ...(mode === 'gateway_delayed' ? {} : { exit: [100, 50, -8] }) };
        case 'fill_air': case 'fill_mixed': case 'fill_blocked': return { type: 'minecraft:fill_layer', height: 4, state: { ...direct('basalt'), properties: { axis: 'y' } } };
        case 'pointed_floor': case 'pointed_ceiling': case 'pointed_both': case 'pointed_water': case 'pointed_blocked': case 'pointed_sulfur': case 'pointed_spread': return {
            type: 'minecraft:speleothem', base_block: `minecraft:${mode === 'pointed_sulfur' ? 'sulfur' : 'dripstone_block'}`,
            pointed_block: `minecraft:${mode === 'pointed_sulfur' ? 'sulfur_spike' : 'pointed_dripstone'}`, replaceable_blocks: 'minecraft:stone',
            ...(mode === 'pointed_spread' ? { chance_of_taller_generation: 1, chance_of_directional_spread: 1, chance_of_spread_radius2: 1, chance_of_spread_radius3: 1 } : {}) };
        case 'cluster': case 'cluster_wet': case 'cluster_water': case 'cluster_lava': case 'cluster_floor': case 'cluster_ceiling': case 'cluster_line': case 'cluster_blocked': case 'cluster_sulfur': case 'cluster_merge': return {
            type: 'minecraft:speleothem_cluster', base_block: `minecraft:${mode === 'cluster_sulfur' ? 'sulfur' : 'dripstone_block'}`,
            pointed_block: `minecraft:${mode === 'cluster_sulfur' ? 'sulfur_spike' : 'pointed_dripstone'}`, replaceable_blocks: 'minecraft:stone',
            floor_to_ceiling_search_range: 12, height: mode === 'cluster_merge' ? 8 : uniform(3, 6), radius: uniform(2, 4), max_stalagmite_stalactite_height_diff: 1,
            height_deviation: 3, speleothem_block_layer_thickness: uniform(2, 4), density: mode === 'cluster_merge' ? 1 : { type: 'minecraft:uniform', min_inclusive: 0.3, max_exclusive: 0.7 },
            wetness: mode === 'cluster_wet' ? 1 : mode === 'cluster_sulfur' || mode === 'cluster_merge' ? 0 : { type: 'minecraft:clamped_normal', mean: 0.1, deviation: 0.3, min: 0.1, max: 0.9 },
            chance_of_speleothem_at_max_distance_from_center: mode === 'cluster_merge' ? 1 : 0.1, max_distance_from_edge_affecting_chance_of_speleothem: 3, max_distance_from_center_affecting_height_bias: 8 };
        case 'large': case 'large_wind': case 'large_shrink': case 'large_lava': case 'large_water': case 'large_open': case 'large_short': case 'large_blocked': case 'large_radius1': case 'large_heightgate': return {
            type: 'minecraft:large_dripstone', replaceable_blocks: 'minecraft:stone', floor_to_ceiling_search_range: 30,
            column_radius: mode === 'large_radius1' ? 1 : mode === 'large_shrink' ? 8 : mode === 'large_wind' ? 6 : { type: 'minecraft:clamped', min_inclusive: 3, max_inclusive: 16, source: uniform(3, 19) },
            height_scale: { type: 'minecraft:uniform', min_inclusive: 0.4, max_exclusive: 2 }, max_column_radius_to_cave_height_ratio: 0.33,
            stalactite_bluntness: { type: 'minecraft:uniform', min_inclusive: 0.3, max_exclusive: 0.9 }, stalagmite_bluntness: { type: 'minecraft:uniform', min_inclusive: 0.4, max_exclusive: 1 },
            wind_speed: { type: 'minecraft:uniform', min_inclusive: 0, max_exclusive: 0.3 }, min_radius_for_wind: mode === 'large_wind' ? 0 : 4,
            min_bluntness_for_wind: mode === 'large_wind' ? 0 : mode === 'large_shrink' ? 5 : 0.6 };
        case 'pillar': case 'pillar_cap': case 'pillar_blocked': case 'pillar_down': return { type: 'minecraft:single_block_pillar', block: { ...direct('basalt'), properties: { axis: 'y' } },
            can_replace: matching('air'), direction: mode === 'pillar_down' ? 'down' : 'up', chance_to_continue: 0.75,
            ...(['pillar_cap', 'pillar_blocked'].includes(mode) ? { cap_feature: unit(direct('glowstone')) } : {}) };
        case 'patch': case 'patch_empty': case 'patch_zero': return { type: 'minecraft:projected_random_patchy_square', block: mode === 'patch_empty' ? { type: 'minecraft:random_block', blocks: [] } : direct('moss_block'),
            project_through: matching('air'), size: uniform(1, 3), max_projection_height: mode === 'patch_zero' ? 0 : 5 };
        case 'stepped': case 'stepped_blocked': case 'stepped_raised': return { type: 'minecraft:stepped_column_cluster', block: { ...direct('basalt'), properties: { axis: 'y' } },
            continue_through: matching('basalt'), can_replace: matching('air'), cannot_place_on: `minecraft:${mode === 'stepped_blocked' ? 'stone' : 'bedrock'}`,
            cluster_reach: uniform(1, 2), column_count: uniform(3, 5), column_reach: uniform(1, 3), height: uniform(3, 7) };
        case 'coral_tree': case 'coral_tree_blocked': case 'coral_claw': case 'coral_claw_blocked': return { type: `minecraft:${mode.startsWith('coral_tree') ? 'coral_tree' : 'coral_claw'}`, feature: unit(direct('fire_coral_block'), [{ type: 'minecraft:block_predicate_filter', predicate: matching('air') }]) };
        case 'fungus_crimson': case 'fungus_planted': case 'fungus_warped': case 'fungus_height': case 'fungus_blocked': return { type: 'minecraft:huge_fungus',
            valid_base_block: `minecraft:${mode === 'fungus_warped' ? 'warped' : 'crimson'}_nylium`, stem_state: { ...direct(mode === 'fungus_warped' ? 'warped_stem' : 'crimson_stem'), properties: { axis: 'y' } },
            hat_state: `minecraft:${mode === 'fungus_warped' ? 'warped_wart_block' : 'nether_wart_block'}`, decor_state: 'minecraft:shroomlight',
            replaceable_blocks: matching('air'), planted: mode === 'fungus_planted' };
        case 'chorus': case 'chorus_blocked': case 'chorus_wall': return { type: 'minecraft:chorus_plant' };
        case 'random_block': return { ...unit({ type: 'minecraft:random_block', blocks: ['minecraft:basalt', 'minecraft:stone'] }).feature, layers: [{ height: 5, provider: { type: 'minecraft:random_block', blocks: ['minecraft:basalt', 'minecraft:stone'] } }] };
        case 'cuboid': case 'cuboid_faces': case 'cuboid_shell': case 'cuboid_random': case 'random_chance': case 'random_selected': case 'height_biased': case 'height_biased_empty': {
            let modifier;
            const chance = { type: 'minecraft:random_chance', chance: 0.35 };
            if (mode.startsWith('height_biased')) modifier = { type: 'minecraft:height_range', height: { type: 'minecraft:biased_to_bottom', min_inclusive: { above_bottom: mode === 'height_biased_empty' ? 50 : 2 }, max_inclusive: { absolute: mode === 'height_biased_empty' ? 51 : 50 }, inner: 3 } };
            else if (mode === 'random_chance') modifier = chance;
            else if (mode === 'random_selected') modifier = { type: 'minecraft:randomly_selected', placements: [chance, { type: 'minecraft:cuboid', xz_size: 2, y_size: 1 }] };
            else modifier = { type: 'minecraft:cuboid', xz_size: mode === 'cuboid_random' ? uniform(1, 3) : 3, y_size: mode === 'cuboid_random' ? uniform(1, 3) : 3,
                include_edges: mode !== 'cuboid_faces', include_interior: mode !== 'cuboid_faces' && mode !== 'cuboid_shell' };
            return { type: 'minecraft:sequence', features: [unit(direct('stone'), [modifier])] };
        }
        case 'fallen': case 'fallen_birch': case 'fallen_mushrooms': case 'fallen_poplar': case 'fallen_blocked': case 'fallen_gap': return {
            type: 'minecraft:fallen_tree', trunk_provider: { ...direct(mode === 'fallen_poplar' ? 'poplar_log' : mode === 'fallen_birch' ? 'birch_log' : 'oak_log'), properties: { axis: 'y' } },
            log_length: uniform(mode === 'fallen_birch' ? 5 : 4, mode === 'fallen_birch' ? 15 : 7),
            stump_decorators: ['fallen_birch', 'fallen_poplar'].includes(mode) ? [] : [{ type: 'minecraft:trunk_vine' }],
            log_decorators: [{ type: 'minecraft:attached_to_logs', probability: mode === 'fallen_mushrooms' ? 1 : 0.1, directions: ['up'],
                block_provider: mode === 'fallen_poplar' ? direct('brown_mushroom') : { type: 'minecraft:weighted', entries: [{ data: 'minecraft:red_mushroom', weight: 2 }, { data: 'minecraft:brown_mushroom', weight: 1 }] } },
                ...(mode === 'fallen_poplar' ? [{ type: 'minecraft:shelf_mushroom', probability: 0.8 }] : [])] };
        case 'root': case 'root_level': case 'root_water': case 'root_blocked': case 'root_height': case 'root_water_blocked': return { type: 'minecraft:root_system',
            feature: { feature: { type: 'minecraft:block_column', layers: [{ height: 1, provider: { ...direct('oak_log'), properties: { axis: 'y' } } }], direction: 'up', allowed_placement: matching('air'), prioritize_tip: false }, placement: [] },
            required_vertical_space_for_tree: 3, level_test_distance: mode === 'root_level' ? 1 : 0, max_level_deviation: 1,
            root_radius: 3, root_replaceable: 'minecraft:stone', root_state_provider: direct('rooted_dirt'), root_placement_attempts: 20, root_column_max_height: 8,
            hanging_root_radius: 3, hanging_roots_vertical_span: 2, hanging_root_state_provider: { ...direct('hanging_roots'), properties: { waterlogged: 'false' } }, hanging_root_placement_attempts: 20,
            allowed_vertical_water_for_tree: 2, allowed_tree_position: mode === 'root_blocked' ? { type: 'minecraft:not', predicate: { type: 'minecraft:true' } } : matching('air') };
        case 'bamboo': case 'bamboo_blocked': return { type: 'minecraft:bamboo', probability: 1 };
        case 'blue_ice': return { type: 'minecraft:blue_ice' };
        case 'delta': return { type: 'minecraft:delta_feature', contents: { ...direct('lava'), properties: { level: '0' } }, rim: 'minecraft:magma_block', size: uniform(3, 7), rim_size: uniform(0, 2) };
        case 'magma': return { type: 'minecraft:underwater_magma', floor_search_range: 5, placement_radius_around_floor: 1, placement_probability_per_valid_position: 0.5 };
        case 'end_platform': return { type: 'minecraft:end_platform' };
        case 'void_platform': case 'void_far': return { type: 'minecraft:void_start_platform' };
        case 'brown': case 'red': return { type: `minecraft:huge_${mode}_mushroom`, foliage_radius: mode === 'brown' ? 3 : 2,
            can_place_on: matching('dirt'), cap_provider: { ...direct(`${mode}_mushroom_block`), properties: { down: 'false', east: 'true', north: 'true', south: 'true', up: 'true', west: 'true' } },
            stem_provider: { ...direct('mushroom_stem'), properties: { down: 'false', east: 'true', north: 'true', south: 'true', up: 'false', west: 'true' } } };
        case 'spike': case 'spike_high': return { type: 'minecraft:spike', state: 'minecraft:packed_ice', can_place_on: matching('snow_block'),
            can_replace: { type: 'minecraft:matching_blocks', blocks: ['minecraft:snow_block', 'minecraft:packed_ice', 'minecraft:ice'] } };
        case 'lake': case 'lake_rejected': case 'lake_protected': case 'lake_air_barrier': case 'lake_water': return { type: 'minecraft:lake',
            fluid: { ...direct(mode === 'lake_water' ? 'water' : 'lava'), properties: { level: '0' } }, barrier: mode === 'lake_air_barrier' ? direct('air') : { ...direct('basalt'), properties: { axis: 'y' } },
            can_place_feature: mode === 'lake_rejected' ? { type: 'minecraft:not', predicate: { type: 'minecraft:true' } } : { type: 'minecraft:true' },
            can_replace_with_air_or_fluid: mode === 'lake_protected' ? { type: 'minecraft:not', predicate: matching('stone') } : { type: 'minecraft:true' },
            can_replace_with_barrier: { type: 'minecraft:true' } };
        case 'end_island': return { type: 'minecraft:end_island' };
        case 'single': return { type: 'minecraft:replace_single_block', targets: [{ state: 'minecraft:diamond_ore', target: { predicate_type: 'minecraft:block_match', block: 'minecraft:stone' } }] };
        case 'column': case 'column_tip': return { type: 'minecraft:block_column', layers: [
            { height: uniform(2, 5), provider: { ...direct('cactus'), properties: { age: '0' } } },
            { height: 1, provider: direct('cactus_flower') }
        ], direction: 'up', allowed_placement: matching('air'), prioritize_tip: mode === 'column_tip' };
        case 'pile': return { type: 'minecraft:block_pile', state_provider: { type: 'minecraft:rotated', state: { ...direct('hay_block'), properties: { axis: 'y' } } } };
        case 'blob': return { type: 'minecraft:block_blob', state: 'minecraft:mossy_cobblestone', can_place_on: matching('dirt') };
        case 'replace': return { type: 'minecraft:netherrack_replace_blobs', target: 'minecraft:netherrack', state: 'minecraft:magma_block', radius: uniform(1, 3) };
        case 'spread': return { type: 'minecraft:random_neighbor_spread', block: direct('glowstone'), accepted_neighbors: 'minecraft:glowstone', can_replace: matching('air'), attempts: 80, xz_offset: uniform(-2, 2), y_offset: uniform(-3, 0) };
        case 'disk': return { type: 'minecraft:disk', state_provider: { type: 'minecraft:rule_based', fallback: direct('sand'), rules: [
            { if_true: { ...matching('air'), offset: [0, -1, 0] }, then: direct('sandstone') }
        ] }, target: matching('dirt'), radius: uniform(2, 4), half_height: 2 };
        case 'spring': return { type: 'minecraft:spring_feature', state: direct('water'), valid_blocks: 'minecraft:stone' };
        case 'scattered': case 'ore': case 'ore_blocked': return { type: mode === 'scattered' ? 'minecraft:scattered_ore' : 'minecraft:ore', size: mode === 'scattered' ? 9 : 33,
            discard_chance_on_air_exposure: mode === 'scattered' ? 1 : 0.5,
            targets: [{ state: 'minecraft:diamond_ore', target: { predicate_type: 'minecraft:block_match', block: 'minecraft:stone' } }] };
        default: throw new Error(`Unknown oracle feature fixture: ${mode}`);
    }
}

export function runFeatureFixture(mode, random, seed = '0') {
    if (STRUCTURE_FEATURE_MODES.includes(mode)) return runStructureFixture(mode, random, seed);
    const writes = [], marks = [], ticks = [], destroyed = [], gatewayExits = [], blocks = new Map();
    const key = pos => `${pos.x},${pos.y},${pos.z}`;
    function base(pos) {
        let name;
        switch (mode) {
            case 'iceberg_packed': case 'iceberg_blue': name = pos.y < 32 ? 'water' : 'air'; break;
            case 'iceberg_blocked': case 'podium_stone': case 'fill_blocked': name = 'stone'; break;
            case 'iceberg_frozen': name = pos.y === 32 ? 'ice' : pos.y < 32 ? 'water' : 'air'; break;
            case 'iceberg_snow_layers': name = pos.y === 33 ? 'snow' : pos.y === 32 ? 'packed_ice' : pos.y < 32 ? 'water' : 'air'; break;
            case 'iceberg_holes': name = pos.y < 32 && (pos.x * pos.x + pos.z * pos.z) % 3 !== 0 ? 'water' : 'air'; break;
            case 'iceberg_cave_air': name = pos.y < 32 ? 'water' : 'cave_air'; break;
            case 'iceberg_dry': case 'podium_air': case 'gateway_delayed': case 'gateway_return': case 'gateway_search': case 'gateway_missing': case 'gateway_wrong': case 'fill_air': name = 'air'; break;
            case 'fill_mixed': name = (pos.x + pos.z) % 3 === 0 ? 'dirt' : 'cave_air'; break;
            case 'podium_active': case 'podium_inactive': name = pos.y < 20 ? 'end_stone' : 'air'; break;
            case 'podium_water': name = 'water'; break;
            case 'podium_preexisting': name = pos.y === 20 && pos.x * pos.x + pos.z * pos.z < 2.5 ** 2 ? 'end_portal' : pos.y < 20 ? 'end_stone' : 'air'; break;
            case 'pointed_floor': case 'pointed_sulfur': case 'pointed_spread': name = pos.y < 20 ? 'stone' : 'air'; break;
            case 'pointed_ceiling': name = pos.y > 20 ? 'stone' : 'air'; break;
            case 'pointed_both': name = pos.y !== 20 ? 'stone' : 'air'; break;
            case 'pointed_water': name = pos.y < 20 ? 'stone' : 'water'; break;
            case 'pointed_blocked': case 'cluster_line': name = 'air'; break;
            case 'cluster': case 'cluster_wet': case 'cluster_sulfur': name = pos.y <= 17 || pos.y >= 27 ? 'stone' : 'air'; break;
            case 'cluster_merge': name = pos.y <= 19 || pos.y >= 22 ? 'stone' : 'air'; break;
            case 'cluster_water': name = pos.y <= 17 || pos.y >= 27 ? 'stone' : 'water'; break;
            case 'cluster_lava': name = pos.y <= 17 ? 'lava' : pos.y >= 27 ? 'stone' : 'air'; break;
            case 'cluster_floor': name = pos.y <= 17 ? 'stone' : 'air'; break;
            case 'cluster_ceiling': name = pos.y >= 27 ? 'stone' : 'air'; break;
            case 'cluster_blocked': case 'large_blocked': name = 'stone'; break;
            case 'large': case 'large_wind': case 'large_radius1': case 'large_heightgate': name = pos.y <= 10 || pos.y >= 35 ? 'stone' : 'air'; break;
            case 'large_shrink': name = (pos.y <= 10 || pos.y >= 35) && Math.abs(pos.x) <= 3 && Math.abs(pos.z) <= 3 ? 'stone' : 'air'; break;
            case 'large_water': name = pos.y <= 10 || pos.y >= 35 ? 'stone' : 'water'; break;
            case 'large_lava': name = pos.y <= 10 ? 'lava' : pos.y >= 35 ? 'stone' : 'air'; break;
            case 'large_open': name = pos.y <= 10 ? 'stone' : 'air'; break;
            case 'large_short': name = pos.y <= 19 || pos.y >= 23 ? 'stone' : 'air'; break;
            case 'pillar': case 'pillar_cap': case 'pillar_down': case 'stepped': case 'stepped_blocked': case 'random_block': name = pos.y < 20 ? 'stone' : 'air'; break;
            case 'pillar_blocked': case 'coral_tree_blocked': case 'coral_claw_blocked': name = 'stone'; break;
            case 'stepped_raised': name = pos.y < 20 || pos.x > 0 && pos.y < 22 ? 'stone' : 'air'; break;
            case 'patch': case 'patch_empty': case 'patch_zero': name = pos.y < 18 ? 'stone' : 'air'; break;
            case 'coral_tree': case 'coral_claw': case 'cuboid': case 'cuboid_faces': case 'cuboid_shell': case 'cuboid_random': case 'random_chance': case 'random_selected': case 'height_biased': case 'height_biased_empty': name = 'air'; break;
            case 'fungus_crimson': case 'fungus_planted': case 'fungus_warped': case 'fungus_height': case 'fungus_blocked':
                name = pos.y < (mode === 'fungus_height' ? 60 : 20) ? mode === 'fungus_blocked' ? 'stone' : mode === 'fungus_warped' ? 'warped_nylium' : 'crimson_nylium' : 'air'; break;
            case 'chorus': case 'chorus_blocked': case 'chorus_wall':
                name = pos.y < 20 ? mode === 'chorus_blocked' ? 'stone' : 'end_stone' : mode === 'chorus_wall' && pos.x === 1 && pos.y >= 23 ? 'stone' : 'air'; break;
            case 'column': case 'column_tip': name = pos.y < 20 || pos.y >= 24 ? 'stone' : 'air'; break;
            case 'pile': name = pos.y < 20 ? 'stone' : 'air'; break;
            case 'blob': name = pos.y < 20 ? 'dirt' : 'air'; break;
            case 'replace': name = pos.y <= 20 ? 'netherrack' : 'air'; break;
            case 'spread': name = pos.y === 21 ? 'stone' : 'air'; break;
            case 'disk': name = pos.y <= 21 ? 'dirt' : 'air'; break;
            case 'spring': name = pos.x === 1 && pos.y === 20 && pos.z === 0 ? 'air' : 'stone'; break;
            case 'bamboo': case 'bamboo_blocked': name = pos.y < 20 ? 'bamboo' : mode === 'bamboo_blocked' && pos.y === 24 ? 'stone' : 'air'; break;
            case 'blue_ice': name = pos.x === 1 && pos.y === 20 && pos.z === 0 ? 'packed_ice' : pos.y <= 20 ? 'water' : 'air'; break;
            case 'delta': name = pos.y <= 20 ? 'netherrack' : 'air'; break;
            case 'magma': name = pos.y <= 18 ? 'stone' : 'water'; break;
            case 'brown': case 'red': name = pos.y < 20 ? 'dirt' : 'air'; break;
            case 'spike': case 'spike_high': name = pos.y < (mode === 'spike_high' ? 60 : 20) ? 'snow_block' : 'air'; break;
            case 'lake': case 'lake_rejected': case 'lake_protected': case 'lake_air_barrier': case 'lake_water': name = 'stone'; break;
            case 'root': case 'root_level': case 'root_water': case 'root_blocked': case 'root_height': case 'root_water_blocked':
                name = pos.x === 0 && pos.y === 20 && pos.z === 0 ? 'air' : mode.startsWith('root_water') && pos.y === 24 || mode === 'root_water_blocked' && pos.y === 25 ? 'water' : pos.y <= 22 ? 'stone' : 'air'; break;
            case 'fallen_blocked': name = 'stone'; break;
            case 'fallen_gap': name = pos.y === 19 && Math.max(Math.abs(pos.x), Math.abs(pos.z)) >= 4 || pos.y >= 20 ? 'air' : 'stone'; break;
            case 'fallen': case 'fallen_birch': case 'fallen_mushrooms': case 'fallen_poplar': name = pos.y < 20 ? 'stone' : 'air'; break;
            default: name = pos.y < 32 && !(pos.x === 2 && pos.z === 1) ? 'stone' : 'air';
        }
        return { name: `minecraft:${name}`, properties: mode === 'iceberg_snow_layers' && name === 'snow' ? { layers: '2' } : {} };
    }
    const write = (state, pos, flags) => {
        blocks.set(key(pos), state);
        writes.push({ ...pos, name: state.name, properties: state.properties, flags });
    };
    const context = {
        minY: 0, maxY: 64, seaLevel: 32, generationDepth: 64,
        getBlockState: pos => blocks.get(key(pos)) ?? base(pos),
        isAir: pos => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(context.getBlockState(pos).name),
        isLiquid: pos => ['minecraft:water', 'minecraft:lava'].includes(context.getBlockState(pos).name),
        isSolid: pos => !context.isAir(pos) && !context.isLiquid(pos),
        isBlockInTag: (state, tag) => tag === 'minecraft:supports_chorus_plant' && state.name === 'minecraft:end_stone' || tag === 'minecraft:base_stone_overworld' && state.name === 'minecraft:stone',
        getDefaultBlockState: name => ({ name, properties: name === 'minecraft:basalt' ? { axis: 'y' } : {} }),
        hasEndGatewayBlockEntity: () => mode !== 'gateway_missing' && mode !== 'gateway_wrong',
        setEndGatewayExit: (pos, exit, exact) => gatewayExits.push({ ...pos, exit: [exit.x, exit.y, exit.z], exact, afterWrites: writes.length }),
        destroyBlock: (pos, drop) => {
            destroyed.push({ ...pos, drop });
            if (context.isAir(pos)) return false;
            write({ name: 'minecraft:air', properties: {} }, pos, 3); return true;
        },
        isFaceOcclusionFull: pos => context.isSolid(pos),
        blockFluidIsInTag: (state, tag) => state.name === tag || tag === 'minecraft:water' && state.properties?.waterlogged === 'true',
        shouldFreeze: () => false,
        isFaceSturdy: pos => !context.isAir(pos),
        isReplaceable: pos => context.isAir(pos),
        isWaterOrWaterNearby: () => false,
        hasShelfMushroomAt: pos => context.getBlockState(pos).name === 'minecraft:shelf_mushroom',
        getHeight: () => mode.startsWith('bamboo') ? 20 : mode === 'root_height' ? 22 : mode === 'large_heightgate' ? 11 : 32,
        ensureCanWrite: pos => mode !== 'ore_blocked' || pos.x >= 0,
        hasWritableSection: pos => pos.y >= 0 && pos.y < 64,
        setBlockInSection: (state, pos, acquire) => {
            if (acquire !== false) throw new Error('Vanilla ore uses unacquired section writes');
            write(state, pos, 0);
        },
        markPosForPostProcessing: pos => marks.push([pos.x, pos.y, pos.z]),
        scheduleFluidTick: (fluid, pos, delay) => ticks.push({ ...pos, type: 'fluid', name: fluid.id, delay })
    };
    context.testBlockPredicate = createBlockPredicateTester(context);
    const place = createConfiguredFeaturePlacer({}, { stateIdFor: () => 1, canSurvive: () => true, setBlock: write,
        scheduleTick: (state, pos, delay) => ticks.push({ ...pos, type: 'block', name: state.name, delay }) });
    const succeeded = place('<oracle>', oracleFeature(mode), { x: mode === 'void_far' ? 48 : 0, y: mode === 'spike_high' || mode === 'fungus_height' ? 60 : 20, z: 0 }, random, context);
    return { succeeded, writes, marks, ticks, destroyed, gatewayExits, effects: [], nextLong: String(random.nextLong()) };
}
