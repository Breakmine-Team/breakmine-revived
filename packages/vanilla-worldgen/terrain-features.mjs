import { sampleIntProvider } from './value-providers.mjs';
import { DIRECTIONS, relative, requireContext, blockName, matchesHolderSet, boxPositions, manhattanPositions, createBlockPredicateTester } from './feature-world.mjs';

export const TERRAIN_FEATURE_TYPES = new Set([
    'block_column', 'disk', 'block_pile', 'block_blob', 'netherrack_replace_blobs',
    'spring_feature', 'vines', 'freeze_top_layer', 'random_neighbor_spread', 'end_island'
].map(type => `minecraft:${type}`));

export function placeTerrainFeature(feature, origin, random, { context, sampleState, sampleOptionalState, directState, setBlock }) {
    const type = feature.type.replace(/^minecraft:/, '');
    const read = pos => requireContext(context, 'getBlockState')(pos);
    const air = pos => requireContext(context, 'isAir')(pos);
    const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
    const write = (state, pos, flags = 2) => setBlock(state, { ...pos }, flags);
    const minY = () => {
        if (!Number.isInteger(context?.minY)) throw new TypeError('Worldgen feature requires context.minY');
        return context.minY;
    };
    switch (type) {
        case 'end_island': {
            const state = directState('minecraft:end_stone');
            let radius = random.nextInt(3) + 4, dy = 0;
            while (radius > 0.5) {
                for (let dx = Math.floor(-radius); dx <= Math.ceil(radius); dx++) for (let dz = Math.floor(-radius); dz <= Math.ceil(radius); dz++) {
                    if (dx * dx + dz * dz <= Math.fround(Math.fround(radius + 1) ** 2)) write(state, { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz }, 3);
                }
                radius = Math.fround(radius - Math.fround(random.nextInt(2) + 0.5));
                dy--;
            }
            return true;
        }
        case 'block_column': {
            const heights = feature.layers.map(layer => sampleIntProvider(layer.height, random));
            if (heights.some(height => height < 0)) throw new RangeError('Block column heights cannot be negative');
            const total = heights.reduce((a, b) => a + b, 0);
            if (!total) return false;
            let probe = relative(origin, feature.direction);
            for (let i = 0; i < total; i++, probe = relative(probe, feature.direction)) {
                if (test(feature.allowed_placement, probe)) continue;
                let remove = total - i;
                const start = feature.prioritize_tip ? 0 : heights.length - 1;
                const step = feature.prioritize_tip ? 1 : -1;
                for (let layer = start; layer >= 0 && layer < heights.length && remove; layer += step) {
                    const n = Math.min(remove, heights[layer]);
                    heights[layer] -= n; remove -= n;
                }
                break;
            }
            let pos = { ...origin };
            for (let layer = 0; layer < heights.length; layer++) for (let i = 0; i < heights[layer]; i++) {
                write(sampleState(feature.layers[layer].provider, pos), pos);
                pos = relative(pos, feature.direction);
            }
            return true;
        }
        case 'disk': {
            const radius = sampleIntProvider(feature.radius, random);
            let placed = false;
            for (const column of boxPositions(origin, radius, 0, radius)) {
                if ((column.x - origin.x) ** 2 + (column.z - origin.z) ** 2 > radius ** 2) continue;
                let previousPlaced = false;
                for (let y = origin.y + feature.half_height; y >= origin.y - feature.half_height; y--) {
                    const pos = { ...column, y };
                    if (!test(feature.target, pos)) { previousPlaced = false; continue; }
                    const state = sampleOptionalState(feature.state_provider, pos);
                    if (state == null) continue;
                    write(state, pos); placed = true;
                    if (!previousPlaced) {
                        let above = pos;
                        for (let i = 0; i < 2; i++) {
                            above = relative(above, 'up');
                            if (air(above)) break;
                            requireContext(context, 'markPosForPostProcessing')(above);
                        }
                    }
                    previousPlaced = true;
                }
            }
            return placed;
        }
        case 'block_pile': {
            if (origin.y < minY() + 5) return false;
            const rx = 2 + random.nextInt(2), rz = 2 + random.nextInt(2);
            for (const pos of boxPositions(origin, rx, 0, rz, 1)) {
                const radius = Math.fround(Math.fround(random.nextFloat() * 10) - Math.fround(random.nextFloat() * 6));
                if ((pos.x - origin.x) ** 2 + (pos.z - origin.z) ** 2 > radius && !(random.nextFloat() < 0.031)) continue;
                if (!air(pos)) continue;
                const below = relative(pos, 'down');
                const supported = blockName(read(below)) === 'minecraft:dirt_path'
                    ? random.nextBoolean() : requireContext(context, 'isFaceSturdy')(below, 'up');
                if (supported) write(sampleState(feature.state_provider, pos), pos, 260);
            }
            return true;
        }
        case 'block_blob': {
            let center = { ...origin };
            while (center.y > minY() + 3 && !test(feature.can_place_on, relative(center, 'down'))) center.y--;
            if (center.y <= minY() + 3) return false;
            const state = directState(feature.state);
            for (let i = 0; i < 3; i++) {
                const rx = random.nextInt(2), ry = random.nextInt(2), rz = random.nextInt(2);
                const radius = Math.fround(Math.fround((rx + ry + rz) * Math.fround(0.333)) + 0.5);
                for (const pos of boxPositions(center, rx, ry, rz)) {
                    if ((pos.x - center.x) ** 2 + (pos.y - center.y) ** 2 + (pos.z - center.z) ** 2 <= Math.fround(radius * radius)) write(state, pos, 3);
                }
                center = { x: center.x - 1 + random.nextInt(2), y: center.y - random.nextInt(2), z: center.z - 1 + random.nextInt(2) };
            }
            return true;
        }
        case 'netherrack_replace_blobs': {
            if (!Number.isInteger(context?.maxY)) throw new TypeError('Replace blobs requires context.maxY (exclusive upper bound)');
            const center = { ...origin, y: Math.min(context.maxY - 1, Math.max(minY() + 1, origin.y)) };
            const target = blockName(feature.target);
            while (center.y > minY() + 1 && blockName(read(center)) !== target) center.y--;
            if (center.y <= minY() + 1) return false;
            const rx = sampleIntProvider(feature.radius, random), ry = sampleIntProvider(feature.radius, random), rz = sampleIntProvider(feature.radius, random);
            const state = directState(feature.state);
            let placed = false;
            for (const pos of manhattanPositions(center, rx, ry, rz, Math.max(rx, ry, rz))) {
                if (blockName(read(pos)) === target) { write(state, pos, 3); placed = true; }
            }
            return placed;
        }
        case 'spring_feature': {
            if (!matchesHolderSet(feature.valid_blocks, read(relative(origin, 'up')), context)) return false;
            if ((feature.requires_block_below ?? true) && !matchesHolderSet(feature.valid_blocks, read(relative(origin, 'down')), context)) return false;
            if (!air(origin) && !matchesHolderSet(feature.valid_blocks, read(origin), context)) return false;
            const neighbors = ['west', 'east', 'north', 'south', 'down'].map(d => relative(origin, d));
            const rocks = neighbors.filter(pos => matchesHolderSet(feature.valid_blocks, read(pos), context)).length;
            const holes = neighbors.filter(air).length;
            if (rocks !== (feature.rock_count ?? 4) || holes !== (feature.hole_count ?? 1)) return false;
            const fluid = typeof feature.state === 'string' ? { id: feature.state } : feature.state;
            const name = blockName(fluid);
            let state;
            if (['minecraft:water', 'minecraft:lava'].includes(name)) state = directState({ id: name, properties: { level: '0' } });
            else if (['minecraft:flowing_water', 'minecraft:flowing_lava'].includes(name)) {
                const level = Number(fluid.properties?.level ?? 7);
                state = directState({ id: name.replace('flowing_', ''), properties: { level: String(8 - level + (fluid.properties?.falling === 'true' ? 8 : 0)) } });
            } else state = requireContext(context, 'fluidToBlockState')(fluid);
            write(state, origin);
            requireContext(context, 'scheduleFluidTick')(fluid, origin, 0);
            return true;
        }
        case 'vines': {
            if (!air(origin)) return false;
            for (const direction of DIRECTIONS.slice(1)) {
                if (!requireContext(context, 'isAcceptableVineNeighbour')(relative(origin, direction), direction)) continue;
                const properties = Object.fromEntries(DIRECTIONS.slice(1).map(d => [d, String(d === direction)]));
                write(directState({ id: 'minecraft:vine', properties }), origin);
                return true;
            }
            return false;
        }
        case 'random_neighbor_spread': {
            write(sampleState(feature.block, origin), origin);
            const attempts = sampleIntProvider(feature.attempts, random);
            for (let i = 0; i < attempts; i++) {
                const pos = { x: origin.x + sampleIntProvider(feature.xz_offset, random), y: origin.y + sampleIntProvider(feature.y_offset, random), z: origin.z + sampleIntProvider(feature.xz_offset, random) };
                if (!test(feature.can_replace, pos)) continue;
                let count = 0;
                for (const direction of DIRECTIONS) if (matchesHolderSet(feature.accepted_neighbors, read(relative(pos, direction)), context) && ++count > 1) break;
                if (count === 1) write(sampleState(feature.block, pos), pos);
            }
            return true;
        }
        case 'freeze_top_layer': {
            for (let dx = 0; dx < 16; dx++) for (let dz = 0; dz < 16; dz++) {
                const x = origin.x + dx, z = origin.z + dz;
                const pos = { x, y: requireContext(context, 'getHeight')('MOTION_BLOCKING', x, z), z };
                const below = relative(pos, 'down');
                if (requireContext(context, 'shouldFreeze')(below, false, pos)) write(directState('minecraft:ice'), below);
                if (!requireContext(context, 'shouldSnow')(pos)) continue;
                write(directState('minecraft:snow'), pos);
                const state = read(below);
                if (Object.hasOwn(state.properties ?? {}, 'snowy')) write(directState({ id: blockName(state), properties: { ...state.properties, snowy: 'true' } }), below);
            }
            return true;
        }
        default: throw new Error(`Unsupported terrain feature: ${feature.type}`);
    }
}
