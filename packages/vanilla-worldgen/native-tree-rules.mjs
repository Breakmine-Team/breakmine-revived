import { blockName, matchesHolderSet } from './feature-world.mjs';

const preparedRegistries = new WeakMap();
const preparedTags = new WeakMap();

function prepareRegistry(registry) {
    let prepared = preparedRegistries.get(registry);
    if (!prepared) {
        prepared = { names: new Set(registry.states.map(state => state.name)),
            statesById: new Map(registry.states.map(state => [state.id, state])) };
        preparedRegistries.set(registry, prepared);
    }
    return prepared;
}

export function createNativeBlockTags(data, registry) {
    let registryTags = preparedTags.get(data);
    if (!registryTags) {
        registryTags = new WeakMap();
        preparedTags.set(data, registryTags);
    }
    const cachedTags = registryTags.get(registry);
    if (cachedTags) return cachedTags;
    const { names } = prepareRegistry(registry);
    const cache = new Map();
    const memberships = new Map();
    function resolve(tag, active = new Set(), required = true) {
        tag = tag.replace(/^#/, '');
        if (!tag.includes(':')) tag = `minecraft:${tag}`;
        if (cache.has(tag)) return cache.get(tag);
        if (active.has(tag)) throw new Error(`Native block tag cycle: ${tag}`);
        const [namespace, path] = tag.split(':');
        const resource = data[`data/${namespace}/tags/block/${path}.json`];
        if (!resource) {
            if (!required) return [];
            throw new Error(`Missing native block tag: ${tag}`);
        }
        if (!Array.isArray(resource.values)) throw new TypeError(`Malformed native block tag: ${tag}`);
        active.add(tag);
        try {
            const values = new Set();
            for (const entry of resource.values) {
                const id = typeof entry === 'string' ? entry : entry.id;
                const needed = typeof entry === 'string' || entry.required !== false;
                if (typeof id !== 'string') throw new TypeError(`Invalid native block tag entry: ${tag}`);
                if (id.startsWith('#')) for (const name of resolve(id, active, needed)) values.add(name);
                else {
                    const name = blockName(id);
                    if (names.has(name)) values.add(name);
                    else if (needed) throw new Error(`Missing block ${name} in native tag ${tag}`);
                }
            }
            const result = Object.freeze([...values]);
            cache.set(tag, result);
            return result;
        } finally { active.delete(tag); }
    }
    const api = {
        resolveBlockTag: tag => [...resolve(tag)],
        isBlockInTag(state, tag) {
            tag = tag.replace(/^#/, '');
            if (!tag.includes(':')) tag = `minecraft:${tag}`;
            let membership = memberships.get(tag);
            if (!membership) {
                membership = new Set(resolve(tag));
                memberships.set(tag, membership);
            }
            return membership.has(blockName(state));
        }
    };
    registryTags.set(registry, api);
    return api;
}

export function createNativeTreeRules(data, registry, { getBlockState, getBlockLight, getHeight, setBlock, minY, maxY }, stateRules) {
    if (typeof getBlockState !== 'function') throw new TypeError('Native tree rules need a live block reader');
    const tags = createNativeBlockTags(data, registry);
    if (stateRules && (stateRules.source?.sha256 !== registry.source?.sha256 || stateRules.states?.length !== registry.states.length)) throw new Error('Native state rules source mismatch');
    const { statesById } = prepareRegistry(registry);
    function fluidInTag(name, tag, active = new Set()) {
        tag = tag.replace(/^#/, '');
        if (active.has(tag)) throw new Error(`Native fluid tag cycle: ${tag}`);
        const [namespace, path] = tag.split(':');
        const definition = data[`data/${namespace}/tags/fluid/${path}.json`];
        if (!definition) throw new Error(`Missing native fluid tag: ${tag}`);
        active.add(tag);
        try {
            return definition.values.some(value => {
                const id = typeof value === 'string' ? value : value.id;
                return id.startsWith('#') ? fluidInTag(name, id, active) : id === name;
            });
        } finally { active.delete(tag); }
    }
    const ruleAt = pos => {
        const state = getBlockState(pos);
        const rule = stateRules?.states[state.stateId];
        if (!rule || rule.id !== state.stateId) throw new Error(`Native block rules missing for ${blockName(state)}`);
        return rule;
    };
    const faceAt = (pos, direction, shape) => {
        const index = ['down', 'up', 'north', 'south', 'west', 'east'].indexOf(direction);
        if (index < 0) throw new Error(`Invalid native support face: ${direction}`);
        const mask = ruleAt(pos).faces?.[shape];
        if (!Number.isInteger(mask)) throw new Error(`Native ${shape} face rules missing`);
        return !!(mask & (1 << index));
    };
    const oppositeFace = { down: 'up', up: 'down', north: 'south', south: 'north', west: 'east', east: 'west' };
    const isEmptyBlock = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(state));
    const valid = pos => {
        const state = getBlockState(pos);
        return isEmptyBlock(state) || tags.isBlockInTag(state, 'minecraft:replaceable_by_trees');
    };
    function heightmapPredicate(type, state) {
        if (type === 'WORLD_SURFACE' || type === 'WORLD_SURFACE_WG') return !isEmptyBlock(state);
        if (type === 'OCEAN_FLOOR' || type === 'OCEAN_FLOOR_WG') return tags.isBlockInTag(state, 'minecraft:blocks_motion_in_heightmap');
        if (type === 'MOTION_BLOCKING' || type === 'MOTION_BLOCKING_NO_LEAVES') {
            const rule = stateRules?.states[state.stateId];
            if (!rule) throw new Error('Native motion heightmap needs fluid-state rules');
            return !rule.fluidEmpty || tags.isBlockInTag(state, type === 'MOTION_BLOCKING' ? 'minecraft:blocks_motion_in_heightmap' : 'minecraft:blocks_motion_in_heightmap_no_leaves');
        }
        throw new Error(`Native heightmap predicate is not ported: ${type}`);
    }
    return { ...tags, isEmptyBlock,
        matchesBlockTag: (state, tag) => tags.isBlockInTag(state, tag),
        isFluidInTag: (state, tag) => fluidInTag(blockName(state), tag),
        blockFluidIsInTag(state, tag) {
            const rule = stateRules?.states[state.stateId];
            if (!rule) throw new Error('Native block fluid rules missing');
            return fluidInTag(rule.fluid, tag);
        },
        isDoublePlant: state => stateRules?.survival?.[blockName(state)] === 'double_vegetation',
        canPlaceDoublePlant(state, pos) {
            const above = { ...pos, y: pos.y + 1 };
            if (Number.isInteger(maxY) && above.y >= maxY) return false;
            const next = getBlockState(above);
            if (isEmptyBlock(next)) return true;
            const rule = ruleAt(above);
            return rule.fluidEmpty && rule.replaceable;
        },
        placeDoublePlant(state, pos, flags = 2) {
            if (typeof setBlock !== 'function') throw new Error('Native double plants require a transactional writer');
            setBlock({ name: blockName(state), properties: { ...state.properties, half: 'lower' } }, pos, flags);
            setBlock({ name: blockName(state), properties: { ...state.properties, half: 'upper' } }, { ...pos, y: pos.y + 1 }, flags);
        },
        ...(stateRules ? { normalizeBlockProperties(name, properties) {
            const state = statesById.get(stateRules.defaults[blockName(name)]);
            if (!state) throw new Error(`Native default block state missing: ${name}`);
            return { ...state.properties, ...properties };
        } } : {}),
        heightmapPredicate,
        canStateSurvive(state, pos) {
            const name = blockName(state);
            if (name === 'minecraft:sugar_cane') {
                const below = { ...pos, y: pos.y - 1 };
                const substrate = getBlockState(below);
                if (blockName(substrate) === name) return true;
                if (!tags.isBlockInTag(substrate, 'minecraft:supports_sugar_cane')) return false;
                return [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([x, z]) => {
                    const adjacent = { x: below.x + x, y: below.y, z: below.z + z };
                    return fluidInTag(ruleAt(adjacent).fluid, 'minecraft:supports_sugar_cane_adjacently') ||
                        tags.isBlockInTag(getBlockState(adjacent), 'minecraft:supports_sugar_cane_adjacently');
                });
            }
            if (name === 'minecraft:cactus') {
                const below = getBlockState({ ...pos, y: pos.y - 1 });
                if (blockName(below) !== name && !tags.isBlockInTag(below, 'minecraft:supports_cactus')) return false;
                return [[0, -1], [1, 0], [0, 1], [-1, 0]].every(([x, z]) =>
                    !ruleAt({ x: pos.x + x, y: pos.y, z: pos.z + z }).solid);
            }
            if (name === 'minecraft:pumpkin' || name === 'minecraft:melon' || name === 'minecraft:sculk_catalyst') return true;
            if (name === 'minecraft:lily_pad') {
                const water = ruleAt({ ...pos, y: pos.y - 1 });
                return water.fluid === 'minecraft:water' && water.fluidSource;
            }
            if (name === 'minecraft:bamboo') {
                return tags.isBlockInTag(getBlockState({ ...pos, y: pos.y - 1 }), 'minecraft:supports_bamboo');
            }
            if (name === 'minecraft:leaf_litter') {
                return faceAt({ ...pos, y: pos.y - 1 }, 'up', 'sturdy');
            }
            if (name === 'minecraft:brown_mushroom' || name === 'minecraft:red_mushroom') {
                const below = getBlockState({ ...pos, y: pos.y - 1 });
                if (!faceAt({ ...pos, y: pos.y - 1 }, 'up', 'sturdy')) return false;
                if (tags.isBlockInTag(below, 'minecraft:overrides_mushroom_light_requirement')) return true;
                if (typeof getBlockLight !== 'function' || typeof getHeight !== 'function') throw new Error('Native mushroom survival needs block-light and sky-height context');
                const skyLight = pos.y >= getHeight('MOTION_BLOCKING', pos.x, pos.z) ? 15 : 0;
                return Math.max(skyLight, getBlockLight(pos)) < 13;
            }
            if (/^minecraft:(?:dead_)?(?:tube|brain|bubble|fire|horn)_coral_block$/.test(name)) return true;
            if (/^minecraft:(?:dead_)?(?:tube|brain|bubble|fire|horn)_coral_wall_fan$/.test(name)) {
                const facing = state.properties?.facing;
                const supportOffset = {
                    north: { x: 0, z: 1 }, south: { x: 0, z: -1 },
                    west: { x: 1, z: 0 }, east: { x: -1, z: 0 }
                }[facing];
                if (!supportOffset) throw new Error(`Invalid coral wall-fan facing: ${facing}`);
                const support = { x: pos.x + supportOffset.x, y: pos.y, z: pos.z + supportOffset.z };
                return faceAt(support, facing, 'sturdy');
            }
            if (['minecraft:dead_bush', 'minecraft:short_dry_grass', 'minecraft:tall_dry_grass'].includes(name)) {
                return tags.isBlockInTag(getBlockState({ ...pos, y: pos.y - 1 }), 'minecraft:supports_dry_vegetation');
            }
            const strategy = stateRules?.survival?.[name];
            if (strategy === 'double_vegetation' && state.properties?.half === 'upper') {
                const below = getBlockState({ ...pos, y: pos.y - 1 });
                return blockName(below) === name && below.properties?.half === 'lower';
            }
            if (strategy === 'vegetation' || strategy === 'double_vegetation' || ['minecraft:short_grass', 'minecraft:fern', 'minecraft:firefly_bush'].includes(name)) {
                return tags.isBlockInTag(getBlockState({ ...pos, y: pos.y - 1 }), 'minecraft:supports_vegetation');
            }
            if (name === 'minecraft:seagrass' || name === 'minecraft:tall_seagrass') {
                const below = { ...pos, y: pos.y - 1 };
                const substrate = getBlockState(below);
                if (name === 'minecraft:tall_seagrass' && state.properties?.half === 'upper') {
                    return blockName(substrate) === name && substrate.properties?.half === 'lower';
                }
                const support = ruleAt(below);
                if (typeof support.sturdyUp !== 'boolean') throw new Error('Native upward support rules missing');
                const supported = support.sturdyUp && !tags.isBlockInTag(substrate, 'minecraft:cannot_support_seagrass');
                return supported && (name === 'minecraft:seagrass' || ruleAt(pos).sourceWater);
            }
            if (name === 'minecraft:kelp' || name === 'minecraft:kelp_plant') {
                const below = { ...pos, y: pos.y - 1 };
                const substrate = getBlockState(below);
                if (tags.isBlockInTag(substrate, 'minecraft:cannot_support_kelp')) return false;
                if (['minecraft:kelp', 'minecraft:kelp_plant'].includes(blockName(substrate))) return true;
                const support = ruleAt(below);
                if (typeof support.sturdyUp !== 'boolean') throw new Error('Native upward support rules missing');
                return support.sturdyUp;
            }
            throw new Error(`Native block survival is not ported: ${name}`);
        },
        isBedrock: state => blockName(state) === 'minecraft:bedrock',
        isAir: pos => isEmptyBlock(getBlockState(pos)),
        isAirOrVine(pos) {
            const state = getBlockState(pos);
            return isEmptyBlock(state) || blockName(state) === 'minecraft:vine';
        },
        isLog: pos => tags.isBlockInTag(getBlockState(pos), 'minecraft:logs'),
        canMangroveRootGrowThrough: (pos, tag) => matchesHolderSet(tag, getBlockState(pos), tags),
        isMuddyRootsIn: (pos, tag) => matchesHolderSet(tag, getBlockState(pos), tags),
        isSolid: pos => ruleAt(pos).solid,
        isSolidRender: pos => ruleAt(pos).solidRender,
        isReplaceable: pos => ruleAt(pos).replaceable,
        isWaterOrWaterNearby(pos) {
            const offsets = [[0, 0, 0], [0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
            return offsets.some(([x, y, z]) => fluidInTag(ruleAt({ x: pos.x + x, y: pos.y + y, z: pos.z + z }).fluid, 'minecraft:water'));
        },
        hasShelfMushroomAt: pos => blockName(getBlockState(pos)) === 'minecraft:shelf_mushroom',
        isLiquid: pos => ruleAt(pos).liquid,
        isFaceSturdy: (pos, direction) => faceAt(pos, direction, 'sturdy'),
        isFaceOcclusionFull: (pos, direction) => faceAt(pos, direction, 'occlusion'),
        isBlockSupportFaceFull: (pos, direction) => faceAt(pos, direction, 'support'),
        isCollisionFaceFull: (pos, direction) => faceAt(pos, direction, 'collision'),
        isAcceptableVineNeighbour: (pos, direction) => {
            const face = oppositeFace[direction];
            if (!face) throw new Error(`Invalid vine neighbour direction: ${direction}`);
            return faceAt(pos, face, 'support') || faceAt(pos, face, 'collision');
        },
        isCollisionShapeFullBlock: pos => {
            const full = ruleAt(pos).collisionFullBlock;
            if (typeof full !== 'boolean') throw new Error('Native full collision rules missing; reimport block rules');
            return full;
        },
        getFluidState(pos) {
            const rule = ruleAt(pos);
            if (typeof rule.fluidSource !== 'boolean') throw new Error('Native fluid source rules missing');
            return { id: rule.fluid, name: rule.fluid, properties: {}, empty: rule.fluidEmpty, source: rule.fluidSource };
        },
        getLightRule(state) {
            const rule = stateRules?.states[state.stateId];
            if (!rule || !Number.isInteger(rule.lightEmission) || !Number.isInteger(rule.lightDampening)) throw new Error('Native block-light rules missing; reimport block rules');
            return { emission: rule.lightEmission, dampening: rule.lightDampening };
        },
        canSnowSurvive(pos) {
            const below = { ...pos, y: pos.y - 1 };
            const support = getBlockState(below);
            if (tags.isBlockInTag(support, 'minecraft:cannot_support_snow_layer')) return false;
            if (tags.isBlockInTag(support, 'minecraft:support_override_snow_layer')) return true;
            const rule = ruleAt(below);
            if (!Number.isInteger(rule.faces?.collision)) throw new Error('Native snow collision rules missing; reimport block rules');
            return !!(rule.faces.collision & (1 << 1)) ||
                (blockName(support) === 'minecraft:snow' && Number(support.properties?.layers) === 8);
        },
        getDefaultBlockState(name) {
            const id = stateRules?.defaults[blockName(name)];
            const state = statesById.get(id);
            if (!state) throw new Error(`Native default block state missing: ${name}`);
            return { name: state.name, properties: state.properties, stateId: id };
        },
        isValidTreePos: valid,
        isTreeFreePos: pos => valid(pos) || tags.isBlockInTag(getBlockState(pos), 'minecraft:logs'),
        isAirOrLeaves: pos => isEmptyBlock(getBlockState(pos)) || tags.isBlockInTag(getBlockState(pos), 'minecraft:leaves'),
        isVine: pos => blockName(getBlockState(pos)) === 'minecraft:vine',
        isWater: pos => {
            if (stateRules) return ruleAt(pos).sourceWater;
            const state = getBlockState(pos);
            const name = blockName(state);
            if (name === 'minecraft:water') return state.properties?.level === '0';
            if (['minecraft:seagrass', 'minecraft:tall_seagrass'].includes(name)) return true;
            return state.properties?.waterlogged === 'true';
        }
    };
}
