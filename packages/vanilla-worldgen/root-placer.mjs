import { sampleIntProvider } from './value-providers.mjs';

const HORIZONTAL_DIRECTIONS = [
    { x: 0, z: -1 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }
];

export function getRootTrunkOrigin(rootPlacer, origin, random) {
    if (rootPlacer?.type !== 'minecraft:mangrove_root_placer') throw new Error(`Unsupported root placer: ${rootPlacer?.type ?? '<missing type>'}`);
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new TypeError('Root placer origin must be an integer block position');
    const offset = sampleIntProvider(rootPlacer.trunk_offset_y, random);
    if (!Number.isInteger(offset) || offset < 0 || offset > 64) throw new RangeError('Invalid mangrove trunk offset');
    return { x: origin.x, y: origin.y + offset, z: origin.z };
}

export function placeMangroveRoots(rootPlacer, origin, trunkOrigin, random, callbacks = {}) {
    if (rootPlacer?.type !== 'minecraft:mangrove_root_placer') throw new Error('Expected a mangrove root placer');
    const placement = rootPlacer.mangrove_root_placement;
    if (!placement || !Number.isInteger(placement.max_root_length) || placement.max_root_length < 1 || placement.max_root_length > 64
        || !Number.isInteger(placement.max_root_width) || placement.max_root_width < 1 || placement.max_root_width > 12
        || !Number.isFinite(placement.random_skew_chance) || placement.random_skew_chance < 0 || placement.random_skew_chance > 1) {
        throw new TypeError('Malformed mangrove root placement settings');
    }
    for (const [name, callback] of Object.entries({
        isValidTreePos: callbacks.isValidTreePos,
        canGrowThrough: callbacks.canGrowThrough,
        isMuddyRootsIn: callbacks.isMuddyRootsIn,
        isWater: callbacks.isWater,
        isAir: callbacks.isAir,
        sampleState: callbacks.sampleState,
        stateIdFor: callbacks.stateIdFor,
        setBlock: callbacks.setBlock
    })) if (typeof callback !== 'function') throw new TypeError(`Mangrove root placement requires ${name}`);
    if (!origin || !trunkOrigin || ![origin.x, origin.y, origin.z, trunkOrigin.x, trunkOrigin.y, trunkOrigin.z].every(Number.isInteger)) {
        throw new TypeError('Mangrove root placement requires integer positions');
    }
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextBoolean !== 'function') {
        throw new TypeError('Mangrove root placement requires a Java-compatible random source');
    }
    if (!rootPlacer.root_provider || !placement.muddy_roots_provider) throw new TypeError('Mangrove root placer is missing a state provider');
    const above = rootPlacer.above_root_placement;
    if (above && (!rootPlacer.above_root_placement.above_root_provider
        || !Number.isFinite(above.above_root_placement_chance)
        || above.above_root_placement_chance < 0 || above.above_root_placement_chance > 1)) {
        throw new TypeError('Malformed above-root placement');
    }

    for (let y = origin.y; y < trunkOrigin.y; y++) {
        const pos = { x: origin.x, y, z: origin.z };
        if (!canPlaceRoot(pos, callbacks, placement)) return false;
    }

    const roots = [{ x: trunkOrigin.x, y: trunkOrigin.y - 1, z: trunkOrigin.z }];
    for (const direction of HORIZONTAL_DIRECTIONS) {
        const side = { x: trunkOrigin.x + direction.x, y: trunkOrigin.y, z: trunkOrigin.z + direction.z };
        const branchRoots = [];
        if (!simulateRoots(rootPlacer, side, direction, trunkOrigin, branchRoots, 0, random, callbacks)) return false;
        roots.push(...branchRoots, side);
    }

    for (const pos of roots) {
        if (!canPlaceRoot(pos, callbacks, placement)) continue;
        if (callbacks.isMuddyRootsIn(pos)) {
            writeProviderState(placement.muddy_roots_provider, pos, random, callbacks);
            continue;
        }
        writeProviderState(rootPlacer.root_provider, pos, random, callbacks);
        if (above && random.nextFloat() < Math.fround(above.above_root_placement_chance)) {
            const abovePos = { x: pos.x, y: pos.y + 1, z: pos.z };
            if (callbacks.isAir(abovePos)) writeProviderState(above.above_root_provider, abovePos, random, callbacks);
        }
    }
    return true;
}

function simulateRoots(rootPlacer, pos, direction, trunkOrigin, roots, depth, random, callbacks) {
    const placement = rootPlacer.mangrove_root_placement;
    const maxLength = placement.max_root_length;
    if (depth === maxLength || roots.length > maxLength) return false;
    const candidates = potentialRootPositions(pos, direction, trunkOrigin, placement, random);
    for (const candidate of candidates) {
        if (!canPlaceRoot(candidate, callbacks, placement)) continue;
        roots.push(candidate);
        if (!simulateRoots(rootPlacer, candidate, direction, trunkOrigin, roots, depth + 1, random, callbacks)) return false;
    }
    return true;
}

function potentialRootPositions(pos, direction, trunkOrigin, placement, random) {
    const below = { x: pos.x, y: pos.y - 1, z: pos.z };
    const sideBelow = { x: pos.x + direction.x, y: pos.y - 1, z: pos.z + direction.z };
    const distance = Math.abs(pos.x - trunkOrigin.x) + Math.abs(pos.y - trunkOrigin.y) + Math.abs(pos.z - trunkOrigin.z);
    const width = placement.max_root_width;
    if (distance > width) return [below];
    const skewed = random.nextFloat() < Math.fround(placement.random_skew_chance);
    if (distance > width - 3) return skewed ? [below, sideBelow] : [below];
    if (skewed) return [below];
    return random.nextBoolean()
        ? [{ x: pos.x + direction.x, y: pos.y, z: pos.z + direction.z }]
        : [below];
}

function canPlaceRoot(pos, callbacks, placement) {
    return callbacks.isValidTreePos(pos) || callbacks.canGrowThrough(pos, placement.can_grow_through);
}

function writeProviderState(provider, pos, random, callbacks) {
    const sampled = callbacks.sampleState(provider, pos, random);
    if (!sampled || typeof sampled.name !== 'string') throw new TypeError('Mangrove root state provider returned no block state');
    let state = sampled;
    if (Object.hasOwn(state.properties ?? {}, 'waterlogged')) {
        const properties = { ...state.properties, waterlogged: String(Boolean(callbacks.isWater(pos))) };
        const stateId = callbacks.stateIdFor(state.name, properties);
        if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError(`No vanilla state ID for ${state.name}`);
        state = { ...state, stateId, properties };
    }
    callbacks.setBlock(state, pos, 19);
}
