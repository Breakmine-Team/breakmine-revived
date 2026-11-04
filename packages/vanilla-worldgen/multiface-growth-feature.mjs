import { DIRECTIONS, blockName, matchesHolderSet, relative, requireContext } from './feature-world.mjs';
import { shuffled } from './java-legacy-random.mjs';

const opposite = { down: 'up', up: 'down', north: 'south', south: 'north', east: 'west', west: 'east' };
const axis = direction => ['up', 'down'].includes(direction) ? 'y' : ['east', 'west'].includes(direction) ? 'x' : 'z';
const air = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(state));
const airOrWater = state => air(state) || blockName(state) === 'minecraft:water';

export function createMultifaceSpreader(name, { context, directState, setBlock }) {
    if (!['minecraft:glow_lichen', 'minecraft:sculk_vein'].includes(name)) throw new Error(`Unsupported multiface block: ${name}`);
    const read = requireContext(context, 'getBlockState');
    const fluidAt = requireContext(context, 'getFluidState');
    const defaultState = requireContext(context, 'getDefaultBlockState')(name);
    const hasFace = (state, face) => state.properties?.[face] === 'true';
    const valid = (state, pos, face) => {
        if (!Object.hasOwn(defaultState.properties, face) || blockName(state) === name && hasFace(state, face)) return false;
        const support = relative(pos, face), surface = opposite[face];
        return requireContext(context, 'isBlockSupportFaceFull')(support, surface) || requireContext(context, 'isCollisionFaceFull')(support, surface);
    };
    const placementState = (state, pos, face) => {
        if (!valid(state, pos, face)) return null;
        const fluid = fluidAt(pos);
        const properties = blockName(state) === name ? state.properties : { ...defaultState.properties, waterlogged: String(fluid.source && fluid.id === 'minecraft:water') };
        return directState({ id: name, properties: { ...properties, [face]: 'true' } });
    };
    const canSpreadInto = (from, pos, face) => {
        const state = read(pos), fluid = fluidAt(pos);
        let replaceable = air(state) || blockName(state) === name || blockName(state) === 'minecraft:water' && fluid.source;
        if (name === 'minecraft:sculk_vein') {
            if (['minecraft:sculk', 'minecraft:sculk_catalyst', 'minecraft:moving_piston'].includes(blockName(read(relative(pos, face))))) return false;
            if (Math.abs(from.x - pos.x) + Math.abs(from.y - pos.y) + Math.abs(from.z - pos.z) === 2 && requireContext(context, 'isFaceSturdy')(relative(from, opposite[face]), face)) return false;
            if (!fluid.empty && fluid.id !== 'minecraft:water' || requireContext(context, 'isBlockInTag')(state, 'minecraft:fire')) return false;
            replaceable = requireContext(context, 'isReplaceable')(pos) || replaceable;
        }
        return replaceable && valid(state, pos, face);
    };
    function spread(state, origin, face, random, mark = true) {
        const otherSource = name === 'minecraft:sculk_vein' && blockName(state) !== name;
        for (const toward of shuffled(DIRECTIONS, random)) {
            if (axis(toward) === axis(face) || !otherSource && (!hasFace(state, face) || hasFace(state, toward))) continue;
            const candidates = [
                { pos: origin, face: toward },
                { pos: relative(origin, toward), face },
                { pos: relative(relative(origin, toward), face), face: opposite[toward] }
            ];
            const candidate = candidates.find(entry => canSpreadInto(origin, entry.pos, entry.face));
            if (!candidate) continue;
            const placed = placementState(read(candidate.pos), candidate.pos, candidate.face);
            if (!placed) continue;
            if (mark) requireContext(context, 'markPosForPostProcessing')(candidate.pos);
            const written = setBlock(placed, candidate.pos, 2);
            if (typeof written !== 'boolean') throw new TypeError('Multiface spread requires setBlock() to return the world write success boolean');
            if (written) return candidate;
        }
        return null;
    }
    function spreadAll(state, origin, mark = true, spreadTypes = ['same_position', 'same_plane', 'wrap_around']) {
        let placedCount = 0;
        const sourceIsVein = blockName(state) === name;
        for (const face of DIRECTIONS) {
            if (!sourceIsVein || hasFace(state, face)) {
                for (const toward of DIRECTIONS) {
                    if (axis(face) === axis(toward)) continue;
                    const candidates = [];
                    for (const type of spreadTypes) {
                        if (type === 'same_position') candidates.push({ pos: origin, face: toward });
                        else if (type === 'same_plane') candidates.push({ pos: relative(origin, toward), face });
                        else if (type === 'wrap_around') candidates.push({ pos: relative(relative(origin, toward), face), face: opposite[toward] });
                        else throw new TypeError(`Unknown multiface spread type: ${type}`);
                    }
                    const candidate = candidates.find(entry => canSpreadInto(origin, entry.pos, entry.face));
                    if (!candidate) continue;
                    const placed = placementState(read(candidate.pos), candidate.pos, candidate.face);
                    if (!placed) continue;
                    if (mark) requireContext(context, 'markPosForPostProcessing')(candidate.pos);
                    if (setBlock(placed, candidate.pos, 3)) placedCount++;
                }
            }
        }
        return placedCount;
    }
    return { placementState, spread, spreadAll };
}

export function placeMultifaceGrowth(feature, origin, random, options) {
    const { context, setBlock } = options;
    const name = blockName(feature.block), range = feature.search_range ?? 10;
    if (!Number.isInteger(range) || range < 1 || range > 64) throw new RangeError('Invalid multiface search_range');
    const read = requireContext(context, 'getBlockState');
    if (!airOrWater(read(origin))) return false;
    const spreader = createMultifaceSpreader(name, options);
    const valid = [
        ...(feature.can_place_on_ceiling ? ['up'] : []), ...(feature.can_place_on_floor ? ['down'] : []),
        ...(feature.can_place_on_wall ? ['north', 'east', 'south', 'west'] : [])
    ];
    function grow(pos, state, directions) {
        for (const face of directions) {
            if (!matchesHolderSet(feature.can_be_placed_on, read(relative(pos, face)), context)) continue;
            const placed = spreader.placementState(state, pos, face);
            if (!placed) return false;
            setBlock(placed, pos, 3);
            requireContext(context, 'markPosForPostProcessing')(pos);
            if (random.nextFloat() < Math.fround(feature.chance_of_spreading ?? 0.5)) spreader.spread(placed, pos, face, random);
            return true;
        }
        return false;
    }
    const directions = shuffled(valid, random);
    if (grow(origin, read(origin), directions)) return true;
    for (const direction of directions) {
        const attachments = shuffled(valid.filter(face => face !== opposite[direction]), random);
        for (let step = 0; step < range; step++) {
            // reference resets the probe to origin+direction, rather than advancing it.
            const pos = relative(origin, direction), state = read(pos);
            if (!airOrWater(state) && blockName(state) !== name) break;
            if (grow(pos, state, attachments)) return true;
        }
    }
    return false;
}
