import { DIRECTIONS, blockName, matchesHolderSet, relative, requireContext } from './feature-world.mjs';
import { sampleIntProvider, intProviderBounds } from './value-providers.mjs';
import { worldSeed } from './java-legacy-random.mjs';

const uniform = (min, max) => ({ type: 'minecraft:uniform', min_inclusive: min, max_inclusive: max });
const air = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(state));
const distanceSquared = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

export function placeGeode(feature, origin, random, { context, directState, sampleState, setBlock }) {
    const blocks = feature.blocks, layers = feature.layers ?? {}, crack = feature.crack ?? {};
    if (!blocks || !Array.isArray(blocks.inner_placements) || !blocks.inner_placements.length) throw new TypeError('Geode requires inner_placements');
    if (!Number.isInteger(feature.invalid_blocks_threshold) || feature.invalid_blocks_threshold < 0) throw new RangeError('Invalid geode invalid_blocks_threshold');
    const min = feature.min_gen_offset ?? -16, max = feature.max_gen_offset ?? 16;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max || min < -64 || max > 64) throw new RangeError('Invalid geode generation bounds');
    const read = requireContext(context, 'getBlockState');
    const fluidAt = requireContext(context, 'getFluidState');
    const seed = worldSeed(context?.seed);
    if (typeof random.normalNoise !== 'function') throw new TypeError('Geode requires the legacy NormalNoise WASM adapter');
    const count = sampleIntProvider(feature.distribution_points ?? uniform(3, 4), random);
    const noise = random.normalNoise({ base_octave: -4, octave_count: 1, amplitude_modifiers: [1], normalize: 'legacy' }, seed, true);
    try {
        const wall = feature.outer_wall_distance ?? uniform(4, 5);
        const ratio = count / intProviderBounds(wall).max;
        const filling = 1 / Math.sqrt(layers.filling ?? 1.7);
        const inner = 1 / Math.sqrt((layers.inner_layer ?? 2.2) + ratio);
        const middle = 1 / Math.sqrt((layers.middle_layer ?? 3.2) + ratio);
        const outer = 1 / Math.sqrt((layers.outer_layer ?? 4.2) + ratio);
        const crackThreshold = 1 / Math.sqrt((crack.base_crack_size ?? 2) + random.nextDouble() / 2 + (count > 3 ? ratio : 0));
        const cracked = random.nextFloat() < (crack.generate_crack_chance ?? 1);
        const points = [], cracks = [], potential = [];
        let invalid = 0;
        for (let i = 0; i < count; i++) {
            const pos = { x: origin.x + sampleIntProvider(wall, random), y: origin.y + sampleIntProvider(wall, random), z: origin.z + sampleIntProvider(wall, random) };
            const state = read(pos);
            if ((air(state) || matchesHolderSet(blocks.invalid_blocks, state, context)) && ++invalid > feature.invalid_blocks_threshold) return false;
            points.push({ pos, offset: sampleIntProvider(feature.point_offset ?? uniform(1, 2), random) });
        }
        if (cracked) {
            const direction = random.nextInt(4), distance = count * 2 + 1;
            for (const y of [7, 5, 1]) cracks.push({ x: origin.x + (direction === 0 || direction === 2 ? distance : 0), y: origin.y + y, z: origin.z + (direction === 1 || direction === 2 ? distance : 0) });
        }
        const safeSet = (state, pos) => {
            if (!matchesHolderSet(blocks.cannot_replace, read(pos), context)) setBlock(state, pos, 2);
        };
        const sampleLayer = (provider, pos) => {
            const sampled = sampleState(provider, pos), defaults = requireContext(context, 'getDefaultBlockState')(blockName(sampled));
            return directState({ id: blockName(sampled), properties: { ...defaults.properties, ...sampled.properties } });
        };
        const empty = directState('minecraft:air');
        for (let z = min; z <= max; z++) for (let y = min; y <= max; y++) for (let x = min; x <= max; x++) {
            const pos = { x: origin.x + x, y: origin.y + y, z: origin.z + z };
            const perturbation = Math.fround(noise.sample(pos.x, pos.y, pos.z)) * (feature.noise_multiplier ?? 0.05);
            let density = 0, crackDensity = 0;
            for (const point of points) density += 1 / Math.sqrt(distanceSquared(pos, point.pos) + point.offset) + perturbation;
            for (const point of cracks) crackDensity += 1 / Math.sqrt(distanceSquared(pos, point) + (crack.crack_point_offset ?? 2)) + perturbation;
            if (density < outer) continue;
            if (density >= filling) { safeSet(sampleLayer(blocks.filling_provider, pos), pos); continue; }
            if (cracked && crackDensity >= crackThreshold) {
                safeSet(empty, pos);
                for (const direction of DIRECTIONS) {
                    const neighbor = relative(pos, direction), fluid = fluidAt(neighbor);
                    if (!fluid.empty) requireContext(context, 'scheduleFluidTick')(fluid, neighbor, 0);
                }
            } else if (density >= inner) {
                const alternate = random.nextFloat() < (feature.use_alternate_layer0_chance ?? 0);
                safeSet(sampleLayer(alternate ? blocks.alternate_inner_layer_provider : blocks.inner_layer_provider, pos), pos);
                if (!(feature.placements_require_layer0_alternate ?? true) || alternate) {
                    if (random.nextFloat() < (feature.use_potential_placements_chance ?? 0.35)) potential.push(pos);
                }
            } else if (density >= middle) safeSet(sampleLayer(blocks.middle_layer_provider, pos), pos);
            else safeSet(sampleLayer(blocks.outer_layer_provider, pos), pos);
        }
        for (const pos of potential) {
            const value = blocks.inner_placements[random.nextInt(blocks.inner_placements.length)];
            const base = requireContext(context, 'getDefaultBlockState')(blockName(value));
            let state = directState({ id: blockName(base), properties: { ...base.properties, ...(typeof value === 'string' ? {} : value.properties) } });
            for (const direction of DIRECTIONS) {
                if (Object.hasOwn(state.properties, 'facing')) state = directState({ id: state.name, properties: { ...state.properties, facing: direction } });
                const neighbor = relative(pos, direction), existing = read(neighbor), fluid = fluidAt(neighbor);
                if (Object.hasOwn(state.properties, 'waterlogged')) state = directState({ id: state.name, properties: { ...state.properties, waterlogged: String(fluid.source) } });
                if (air(existing) || blockName(existing) === 'minecraft:water' && fluid.full) {
                    safeSet(state, neighbor); break;
                }
            }
        }
        return true;
    } finally { noise.dispose(); }
}
