import { createBlockPredicateTester, requireContext, relative, matchesHolderSet } from './feature-world.mjs';

export function placeRootSystem(feature, origin, random, { context, sampleState, setBlock, canSurvive, placeTree }) {
    const air = requireContext(context, 'isAir');
    if (!air(origin)) return false;
    const read = requireContext(context, 'getBlockState');
    const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
    const fluidTag = (pos, tag) => requireContext(context, 'blockFluidIsInTag')(read(pos), tag);
    const spaceForTree = pos => {
        for (let i = 1; i <= feature.required_vertical_space_for_tree; i++) {
            const above = relative(pos, 'up', i);
            if (!air(above) && !(i + 1 <= feature.allowed_vertical_water_for_tree && fluidTag(above, 'minecraft:water'))) return false;
        }
        if (feature.level_test_distance > 0) for (const direction of ['south', 'west', 'north', 'east']) {
            const probe = relative(pos, direction, feature.level_test_distance);
            const belowAir = air(relative(probe, 'down', feature.max_level_deviation));
            const aboveAir = air(relative(probe, 'up', feature.max_level_deviation));
            if (belowAir || !aboveAir) return false;
        }
        return true;
    };
    const offset = radius => random.nextInt(radius) - random.nextInt(radius);
    for (let i = 0; i < feature.root_column_max_height; i++) {
        const tree = relative(origin, 'up', i + 1);
        if (requireContext(context, 'getHeight')('WORLD_SURFACE', tree.x, tree.z) < tree.y) break;
        if (!test(feature.allowed_tree_position, tree) || !spaceForTree(tree)) continue;
        const below = relative(tree, 'down');
        if (fluidTag(below, 'minecraft:lava') || !requireContext(context, 'isSolid')(below)) break;
        if (!placeTree(feature.feature, tree)) continue;
        for (let y = origin.y; y < origin.y + i; y++) for (let j = 0; j < feature.root_placement_attempts; j++) {
            const pos = { x: origin.x + offset(feature.root_radius), y, z: origin.z + offset(feature.root_radius) };
            if (matchesHolderSet(feature.root_replaceable, read(pos), context)) setBlock(sampleState(feature.root_state_provider, pos), pos, 2);
        }
        for (let j = 0; j < feature.hanging_root_placement_attempts; j++) {
            const pos = { x: origin.x + offset(feature.hanging_root_radius), y: origin.y + offset(feature.hanging_roots_vertical_span), z: origin.z + offset(feature.hanging_root_radius) };
            if (!air(pos)) continue;
            const state = sampleState(feature.hanging_root_state_provider, pos);
            if (canSurvive(state, pos) && requireContext(context, 'isFaceSturdy')(relative(pos, 'up'), 'down', pos)) setBlock(state, pos, 2);
        }
        break;
    }
    return true;
}
