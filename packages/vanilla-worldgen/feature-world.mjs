import { resolveVerticalAnchor } from './value-providers.mjs';

export const DIRECTIONS = Object.freeze(['down', 'up', 'north', 'south', 'west', 'east']);
const steps = { down: [0, -1, 0], up: [0, 1, 0], north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0] };

export function relative(pos, direction, distance = 1) {
    const step = steps[direction];
    if (!step) throw new TypeError(`Invalid feature direction: ${direction}`);
    return { x: pos.x + step[0] * distance, y: pos.y + step[1] * distance, z: pos.z + step[2] * distance };
}

export function requireContext(context, name) {
    if (typeof context?.[name] !== 'function') throw new TypeError(`Worldgen feature requires context.${name}()`);
    return context[name].bind(context);
}

export function blockName(state) {
    const name = typeof state === 'string' ? state : state?.name ?? state?.id;
    if (typeof name !== 'string') throw new TypeError('Expected a named vanilla block state');
    return name.includes(':') ? name : `minecraft:${name}`;
}

export function sameBlockState(a, b) {
    if (blockName(a) !== blockName(b)) return false;
    const left = a.properties ?? {}, right = b.properties ?? {};
    return Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value);
}

export function matchesHolderSet(value, state, context) {
    if (typeof value === 'string' && value.startsWith('#')) return requireContext(context, 'isBlockInTag')(state, value.slice(1));
    return (Array.isArray(value) ? value : [value]).some(name => blockName(name) === blockName(state));
}

export function javaPositionSetOrder(positions) {
    let capacity = 16;
    while (positions.length > capacity * 0.75) capacity *= 2;
    const hash = pos => (Math.imul((pos.y + Math.imul(pos.z, 31)) | 0, 31) + pos.x) | 0;
    return positions.map((pos, insertion) => ({ pos, insertion })).sort((a, b) => {
        const ah = hash(a.pos), bh = hash(b.pos);
        return ((ah ^ (ah >>> 16)) & (capacity - 1)) - ((bh ^ (bh >>> 16)) & (capacity - 1)) || a.insertion - b.insertion;
    }).map(entry => entry.pos);
}

export function* boxPositions(origin, rx, ry, rz, upperY = ry) {
    for (let z = -rz; z <= rz; z++) for (let y = -ry; y <= upperY; y++) for (let x = -rx; x <= rx; x++) {
        yield { x: origin.x + x, y: origin.y + y, z: origin.z + z };
    }
}

export function* manhattanPositions(origin, rx, ry, rz, maxDepth = rx + ry + rz) {
    for (let depth = 0; depth <= maxDepth; depth++) {
        const maxX = Math.min(rx, depth);
        for (let x = -maxX; x <= maxX; x++) {
            const maxY = Math.min(ry, depth - Math.abs(x));
            for (let y = -maxY; y <= maxY; y++) {
                const z = depth - Math.abs(x) - Math.abs(y);
                if (z > rz) continue;
                yield { x: origin.x + x, y: origin.y + y, z: origin.z + z };
                if (z) yield { x: origin.x + x, y: origin.y + y, z: origin.z - z };
            }
        }
    }
}

export function createBlockPredicateTester(context) {
    return function test(predicate, origin) {
        if (!predicate || typeof predicate.type !== 'string') throw new TypeError('Malformed worldgen block predicate');
        const offset = predicate.offset ?? [0, 0, 0];
        const pos = { x: origin.x + offset[0], y: origin.y + offset[1], z: origin.z + offset[2] };
        switch (predicate.type.replace(/^minecraft:/, '')) {
            case 'true': case 'always_true': return true;
            case 'not': return !test(predicate.predicate, origin);
            case 'all_of': return predicate.predicates.every(value => test(value, origin));
            case 'any_of': return predicate.predicates.some(value => test(value, origin));
            case 'matching_blocks': return matchesHolderSet(predicate.blocks, requireContext(context, 'getBlockState')(pos), context);
            case 'matching_block_tag': return requireContext(context, 'isBlockInTag')(requireContext(context, 'getBlockState')(pos), predicate.tag);
            case 'matching_fluids': return matchesHolderSet(predicate.fluids, requireContext(context, 'getFluidState')(pos), {
                isBlockInTag: (state, tag) => requireContext(context, 'isFluidInTag')(state, tag)
            });
            case 'solid': return requireContext(context, 'isSolid')(pos);
            case 'replaceable': return requireContext(context, 'isReplaceable')(pos);
            case 'has_sturdy_face': return requireContext(context, 'isFaceSturdy')(pos, predicate.direction);
            case 'would_survive': return requireContext(context, 'canStateSurvive')(predicate.state, pos);
            case 'inside_world_bounds': return requireContext(context, 'isInsideWorldBounds')(pos);
            case 'height_range': {
                const range = context.generationContext ?? context;
                const min = resolveVerticalAnchor(predicate.min_inclusive, range);
                const max = resolveVerticalAnchor(predicate.max_inclusive, range);
                return pos.y >= min && pos.y <= max;
            }
            default: throw new Error(`Unsupported worldgen block predicate: ${predicate.type}`);
        }
    };
}
