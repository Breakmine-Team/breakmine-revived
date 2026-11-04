import { sampleIntProvider } from './value-providers.mjs';
import { relative, requireContext, createBlockPredicateTester, matchesHolderSet, boxPositions } from './feature-world.mjs';

export const SHAPE_FEATURE_TYPES = new Set(['single_block_pillar', 'projected_random_patchy_square', 'stepped_column_cluster', 'coral_tree', 'coral_claw'].map(v => `minecraft:${v}`));
const horizontal = ['north', 'east', 'south', 'west'];
const opposite = d => horizontal[(horizontal.indexOf(d) + 2) % 4];
const shuffled = (list, random) => {
    const result = [...list];
    for (let n = result.length; n > 1; n--) {
        const i = random.nextInt(n); [result[n - 1], result[i]] = [result[i], result[n - 1]];
    }
    return result;
};

export function placeShapeFeature(feature, origin, random, { context, sampleState, sampleOptionalState, setBlock, placeNested }) {
    const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
    const read = p => requireContext(context, 'getBlockState')(p);
    const air = p => requireContext(context, 'isAir')(p);
    switch (feature.type) {
        case 'minecraft:single_block_pillar': {
            if (!['up', 'down'].includes(feature.direction)) throw new TypeError('Pillar direction must be vertical');
            if (!Number.isInteger(context?.minY) || !Number.isInteger(context?.maxY)) throw new TypeError('Pillar requires build height bounds');
            let pos = { ...origin };
            while (test(feature.can_replace ?? { type: 'minecraft:true' }, pos) && random.nextFloat() < Math.fround(feature.chance_to_continue ?? 1)) {
                if (pos.y < context.minY || pos.y >= context.maxY) break;
                setBlock(sampleState(feature.block, pos), pos, 2); pos = relative(pos, feature.direction);
            }
            pos = relative(pos, feature.direction === 'up' ? 'down' : 'up');
            if (feature.cap_feature) placeNested(feature.cap_feature, pos);
            return true;
        }
        case 'minecraft:projected_random_patchy_square': {
            const size = sampleIntProvider(feature.size, random), bound = size * size + 1;
            for (let x = -size; x <= size; x++) for (let z = -size; z <= size; z++) {
                if (random.nextInt(bound) >= bound - Math.abs(x) * Math.abs(z)) continue;
                let pos = { x: origin.x + x, y: origin.y, z: origin.z + z }, remaining = feature.max_projection_height;
                while (test(feature.project_through, relative(pos, 'down'))) {
                    pos = relative(pos, 'down'); if (--remaining <= 0) break;
                }
                const state = sampleOptionalState(feature.block, pos);
                if (state != null) setBlock(state, pos, 2);
            }
            return true;
        }
        case 'minecraft:stepped_column_cluster': {
            if (!Number.isInteger(context?.minY) || !Number.isInteger(context?.maxY)) throw new TypeError('Column cluster requires build height bounds');
            const blocked = p => matchesHolderSet(feature.cannot_place_on, read(p), context);
            const canPlace = p => test(feature.can_replace, p) && !air(relative(p, 'down')) && !blocked(relative(p, 'down'));
            if (!canPlace(origin)) return false;
            const height = sampleIntProvider(feature.height, random);
            const reach = Math.min(height, sampleIntProvider(feature.cluster_reach, random)), count = sampleIntProvider(feature.column_count, random);
            let placed = false;
            for (let i = 0; i < count; i++) {
                const center = { x: origin.x - reach + random.nextInt(reach * 2 + 1), y: origin.y + random.nextInt(1), z: origin.z - reach + random.nextInt(reach * 2 + 1) };
                const remaining = height - Math.abs(center.x - origin.x) - Math.abs(center.z - origin.z);
                if (remaining < 0) continue;
                const radius = sampleIntProvider(feature.column_reach, random);
                for (const candidate of boxPositions(center, radius, 0, radius)) {
                    let budget = Math.abs(candidate.x - center.x) + Math.abs(candidate.z - center.z), pos = candidate, found = false;
                    if (test(feature.can_replace, pos)) {
                        while (pos.y > context.minY + 1 && budget > 0) {
                            budget--; if (canPlace(pos)) { found = true; break; } pos = relative(pos, 'down');
                        }
                    } else {
                        while (pos.y < context.maxY && budget > 0) {
                            budget--; if (blocked(pos)) break;
                            if (air(pos)) { found = true; break; } pos = relative(pos, 'up');
                        }
                    }
                    if (!found) continue;
                    const distance = Math.abs(candidate.x - center.x) + Math.abs(candidate.z - center.z);
                    for (let h = remaining - Math.trunc(distance / 2); h >= 0; h--, pos = relative(pos, 'up')) {
                        if (test(feature.can_replace, pos)) { setBlock(sampleState(feature.block, pos), pos, 3); placed = true; }
                        else if (!test(feature.continue_through, pos)) break;
                    }
                }
            }
            return placed;
        }
        case 'minecraft:coral_tree': {
            let pos = { ...origin };
            const height = random.nextInt(3) + 1;
            for (let i = 0; i < height; i++, pos = relative(pos, 'up')) if (!placeNested(feature.feature, pos)) return true;
            const top = pos, count = random.nextInt(3) + 2;
            const directions = shuffled(horizontal, random).slice(0, count);
            for (const d of directions) {
                pos = relative(top, d);
                const length = random.nextInt(5) + 2; let sinceTurn = 0;
                for (let i = 0; i < length; i++) {
                    if (!placeNested(feature.feature, pos)) break;
                    sinceTurn++; pos = relative(pos, 'up');
                    if (i === 0 || sinceTurn >= 2 && random.nextFloat() < 0.25) { pos = relative(pos, d); sinceTurn = 0; }
                }
            }
            return true;
        }
        case 'minecraft:coral_claw': {
            if (!placeNested(feature.feature, origin)) return false;
            const direction = horizontal[random.nextInt(4)], branches = random.nextInt(2) + 2;
            const index = horizontal.indexOf(direction);
            const directions = shuffled([direction, horizontal[(index + 1) % 4], horizontal[(index + 3) % 4]], random).slice(0, branches);
            for (const d of directions) {
                const firstLength = random.nextInt(2) + 1;
                let pos = relative(origin, d), bend, length;
                if (d === direction) { bend = direction; length = random.nextInt(3) + 2; }
                else { pos = relative(pos, 'up'); bend = [d, 'up'][random.nextInt(2)]; length = random.nextInt(3) + 3; }
                for (let i = 0; i < firstLength; i++) {
                    if (!placeNested(feature.feature, pos)) break; pos = relative(pos, bend);
                }
                pos = relative(relative(pos, bend === 'up' ? 'down' : opposite(bend)), 'up');
                for (let i = 0; i < length; i++) {
                    pos = relative(pos, direction);
                    if (!placeNested(feature.feature, pos)) break;
                    if (random.nextFloat() < 0.25) pos = relative(pos, 'up');
                }
            }
            return true;
        }
        default: throw new Error(`Unsupported shape feature: ${feature.type}`);
    }
}
