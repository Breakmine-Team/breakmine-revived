import { sampleHeightProvider, sampleIntProvider } from './value-providers.mjs';

export const SUPPORTED_PLACEMENT_MODIFIERS = Object.freeze([
    'minecraft:biome', 'minecraft:block_predicate_filter', 'minecraft:count',
    'minecraft:count_on_every_layer', 'minecraft:environment_scan',
    'minecraft:fixed_placement', 'minecraft:height_range', 'minecraft:heightmap',
    'minecraft:in_square', 'minecraft:noise_based_count',
    'minecraft:noise_threshold_count', 'minecraft:offset',
    'minecraft:rarity_filter', 'minecraft:random_chance', 'minecraft:randomly_selected', 'minecraft:cuboid', 'minecraft:surface_relative_threshold_filter',
    'minecraft:surface_water_depth_filter'
]);

function javaInt(value, label) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new RangeError(`${label} must be a Java int`);
    return value;
}

function position(value) {
    if (Array.isArray(value)) {
        if (value.length !== 3) throw new TypeError('Expected a three-coordinate block position');
        return { x: javaInt(value[0], 'position x'), y: javaInt(value[1], 'position y'), z: javaInt(value[2], 'position z') };
    }
    if (!value || typeof value !== 'object') throw new TypeError('Expected a block position');
    return { x: javaInt(value.x, 'position x'), y: javaInt(value.y, 'position y'), z: javaInt(value.z, 'position z') };
}

function height(context, type, pos) {
    if (typeof context.getHeight !== 'function') throw new TypeError(`Placement ${type} requires getHeight(heightmap, x, z)`);
    return javaInt(context.getHeight(type, pos.x, pos.z), `${type} height`);
}

function randomInt(random, bound) {
    if (!Number.isInteger(bound) || bound <= 0 || bound > 0x7fffffff) throw new RangeError('Invalid placement random bound');
    const value = random.nextInt(bound);
    if (!Number.isInteger(value) || value < 0 || value >= bound) throw new RangeError('Random source returned an invalid bounded integer');
    return value;
}

function randomFloat(random) {
    if (typeof random.nextFloat !== 'function') throw new TypeError('This placement modifier requires random.nextFloat()');
    const value = Math.fround(random.nextFloat());
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('Random source returned an invalid float');
    return value;
}

function sameChunk(a, b) {
    return (a.x >> 4) === (b.x >> 4) && (a.z >> 4) === (b.z >> 4);
}

function requireBoolean(value, label) {
    if (typeof value !== 'boolean') throw new TypeError(`${label} adapter must return a boolean`);
    return value;
}

function testPredicate(context, predicate, pos) {
    if (predicate?.type === 'minecraft:always_true') return true;
    if (typeof context.testBlockPredicate !== 'function') throw new TypeError('Block predicate placement requires testBlockPredicate(predicate, position)');
    return requireBoolean(context.testBlockPredicate(predicate, pos), 'Block predicate');
}

function findOnGround(context, x, topY, z, targetLayer) {
    if (typeof context.getBlockState !== 'function' || typeof context.isEmptyBlock !== 'function' || typeof context.isBedrock !== 'function') {
        throw new TypeError('count_on_every_layer requires getBlockState, isEmptyBlock and isBedrock adapters');
    }
    const minY = javaInt(context.minY, 'world minY');
    let above = context.getBlockState({ x, y: topY, z });
    let layer = 0;
    for (let y = topY; y >= minY + 1; y--) {
        const below = context.getBlockState({ x, y: y - 1, z });
        if (!context.isEmptyBlock(below) && context.isEmptyBlock(above) && !context.isBedrock(below)) {
            if (layer === targetLayer) return y;
            layer++;
        }
        above = below;
    }
    return null;
}

function applyModifier(modifier, pos, random, context, placedFeature, biomeCheck) {
    const type = modifier.type;
    const one = value => [value];
    switch (type) {
        case 'minecraft:random_chance': {
            if (!Number.isFinite(modifier.chance) || modifier.chance < 0 || modifier.chance > 1) throw new RangeError('Invalid placement chance');
            return randomFloat(random) < Math.fround(modifier.chance) ? one(pos) : [];
        }
        case 'minecraft:randomly_selected': {
            if (!Array.isArray(modifier.placements) || !modifier.placements.length) throw new TypeError('Randomly selected placement needs children');
            return applyModifier(modifier.placements[randomInt(random, modifier.placements.length)], pos, random, context, placedFeature, biomeCheck);
        }
        case 'minecraft:cuboid': {
            const ySize = sampleIntProvider(modifier.y_size, random);
            const xSize = sampleIntProvider(modifier.xz_size, random), zSize = sampleIntProvider(modifier.xz_size, random);
            if ([xSize, ySize, zSize].some(v => v < 0) || (xSize + 1) * (ySize + 1) * (zSize + 1) > 1_000_000) throw new RangeError('Invalid cuboid dimensions');
            const positions = [];
            for (let x = 0; x <= xSize; x++) for (let y = 0; y <= ySize; y++) for (let z = 0; z <= zSize; z++) {
                const edges = Number(x === 0 || x === xSize) + Number(y === 0 || y === ySize) + Number(z === 0 || z === zSize);
                if (!(modifier.include_edges ?? true) && edges >= 2 || !(modifier.include_interior ?? true) && edges === 0) continue;
                positions.push({ x: pos.x + x, y: pos.y + y, z: pos.z + z });
            }
            return positions;
        }
        case 'minecraft:count': {
            const count = sampleIntProvider(modifier.count, random);
            if (count > 1_000_000) throw new RangeError('Feature count exceeds the safety limit');
            return Array.from({ length: Math.max(0, count) }, () => pos);
        }
        case 'minecraft:rarity_filter': {
            const chance = javaInt(modifier.chance, 'rarity chance');
            if (chance <= 0) throw new RangeError('Rarity chance must be positive');
            return randomFloat(random) < 1 / chance ? one(pos) : [];
        }
        case 'minecraft:in_square':
            return one({ x: pos.x + randomInt(random, 16), y: pos.y, z: pos.z + randomInt(random, 16) });
        case 'minecraft:heightmap': {
            const y = height(context, modifier.heightmap, pos);
            return y > javaInt(context.minY, 'world minY') ? one({ x: pos.x, y, z: pos.z }) : [];
        }
        case 'minecraft:height_range':
            return one({ ...pos, y: sampleHeightProvider(modifier.height, random, context) });
        case 'minecraft:offset':
            return one({
                x: pos.x + sampleIntProvider(modifier.x, random),
                y: pos.y + sampleIntProvider(modifier.y, random),
                z: pos.z + sampleIntProvider(modifier.z, random)
            });
        case 'minecraft:biome': {
            if (!biomeCheck) throw new Error('Biome placement requires a top-level placed-feature check');
            if (typeof context.isBiomeFeature !== 'function') throw new TypeError('Biome placement requires isBiomeFeature(placedFeature, position)');
            return requireBoolean(context.isBiomeFeature(placedFeature, pos), 'Biome') ? one(pos) : [];
        }
        case 'minecraft:block_predicate_filter': {
            return testPredicate(context, modifier.predicate, pos) ? one(pos) : [];
        }
        case 'minecraft:surface_water_depth_filter': {
            const floor = height(context, 'OCEAN_FLOOR', pos);
            const surface = height(context, 'WORLD_SURFACE', pos);
            return surface - floor <= javaInt(modifier.max_water_depth, 'maximum water depth') ? one(pos) : [];
        }
        case 'minecraft:surface_relative_threshold_filter': {
            const top = height(context, modifier.heightmap, pos);
            const min = top + javaInt(modifier.min_inclusive ?? -0x80000000, 'surface minimum');
            const max = top + javaInt(modifier.max_inclusive ?? 0x7fffffff, 'surface maximum');
            return pos.y >= min && pos.y <= max ? one(pos) : [];
        }
        case 'minecraft:environment_scan': {
            const direction = modifier.direction_of_search;
            if (direction !== 'up' && direction !== 'down') throw new Error(`Unsupported environment scan direction: ${direction}`);
            const minY = javaInt(context.minY, 'world minY');
            const maxY = javaInt(context.maxY, 'world maxY');
            const maxSteps = javaInt(modifier.max_steps, 'environment scan steps');
            if (maxSteps < 1 || maxSteps > 32) throw new RangeError('Environment scan steps must be in 1..32');
            const step = direction === 'up' ? 1 : -1;
            let cursor = pos;
            const allowed = modifier.allowed_search_condition ?? { type: 'minecraft:always_true' };
            for (let i = 0; i < maxSteps; i++) {
                if (cursor.y < minY || cursor.y >= maxY || !testPredicate(context, allowed, cursor)) return [];
                if (testPredicate(context, modifier.target_condition, cursor)) return one(cursor);
                cursor = { ...cursor, y: cursor.y + step };
            }
            return [];
        }
        case 'minecraft:count_on_every_layer': {
            const minY = javaInt(context.minY, 'world minY');
            const maxY = javaInt(context.maxY, 'world maxY');
            if (maxY <= minY) throw new RangeError('Invalid build-height interval');
            let targetLayer = 0;
            const output = [];
            while (true) {
                const count = sampleIntProvider(modifier.count, random);
                if (count > 1_000_000) throw new RangeError('Layer feature count exceeds the safety limit');
                let foundLayer = false;
                for (let i = 0; i < count; i++) {
                    const x = pos.x + randomInt(random, 16);
                    const z = pos.z + randomInt(random, 16);
                    const surface = height(context, 'MOTION_BLOCKING', { x, y: pos.y, z });
                    const y = findOnGround(context, x, surface, z, targetLayer);
                    if (y !== null) {
                        output.push({ x, y, z });
                        foundLayer = true;
                    }
                }
                if (!foundLayer) break;
                targetLayer++;
                if (output.length > 1_000_000) throw new RangeError('Layer feature placement exceeds the safety limit');
                if (targetLayer > maxY - minY) break;
            }
            return output;
        }
        case 'minecraft:noise_based_count':
        case 'minecraft:noise_threshold_count': {
            if (typeof context.biomeInfoNoise !== 'function') throw new TypeError(`${type} requires biomeInfoNoise(x, z)`);
            const factor = type.endsWith('noise_based_count') ? modifier.noise_factor : 200;
            const value = Math.fround(context.biomeInfoNoise(pos.x / factor, pos.z / factor));
            if (!Number.isFinite(value)) throw new RangeError('Biome placement noise must be finite');
            let count;
            if (type.endsWith('noise_based_count')) {
                count = Math.ceil((value + (modifier.noise_offset ?? 0)) * modifier.noise_to_count_ratio);
            } else {
                count = value < modifier.noise_level ? modifier.below_noise : modifier.above_noise;
            }
            if (!Number.isInteger(count) || count > 1_000_000) throw new RangeError('Noise placement count is invalid or exceeds the safety limit');
            return Array.from({ length: Math.max(0, count) }, () => pos);
        }
        case 'minecraft:fixed_placement': {
            if (!Array.isArray(modifier.positions)) throw new TypeError('Fixed placement needs positions');
            return modifier.positions.map(position).filter(candidate => sameChunk(candidate, pos));
        }
        default: throw new Error(`Unsupported vanilla placement modifier: ${type}`);
    }
}

export function placeVanillaPlacedFeature(placedFeature, origin, {
    random, context = {}, placeFeature, biomeCheck = true, maxPlacements = 1_000_000
} = {}) {
    if (!placedFeature || typeof placedFeature !== 'object' || !Array.isArray(placedFeature.placement) || !placedFeature.feature) {
        throw new TypeError('Expected a resolved vanilla placed feature');
    }
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('Placed-feature execution requires a Java-compatible random source');
    if (typeof placeFeature !== 'function') throw new TypeError('Placed-feature execution requires a configured-feature callback');
    if (!Number.isSafeInteger(maxPlacements) || maxPlacements < 1) throw new RangeError('maxPlacements must be a positive safe integer');
    const start = position(origin);
    const name = placedFeature.name ?? placedFeature.featureName ?? '<inline-feature>';
    let attempted = 0;
    let succeeded = false;
    const place = pos => {
        attempted++;
        if (attempted > maxPlacements) throw new RangeError('Placed feature exceeded its placement safety limit');
        succeeded = !!placeFeature(placedFeature.featureName, placedFeature.feature, pos, random, context) || succeeded;
    };

    if (placedFeature.placement.length === 0) {
        place(start);
        return { name, attempted, succeeded };
    }

    const stack = [{ pos: start, modifierIndex: 0 }];
    const output = [];
    while (stack.length) {
        const current = stack.pop();
        output.length = 0;
        const modifier = placedFeature.placement[current.modifierIndex];
        const results = applyModifier(modifier, current.pos, random, context, placedFeature, biomeCheck);
        for (const candidate of results) output.push(position(candidate));
        const nextIndex = current.modifierIndex + 1;
        if (nextIndex === placedFeature.placement.length) {
            for (const candidate of output) place(candidate);
            continue;
        }
        for (let i = output.length - 1; i >= 0; i--) {
            stack.push({ pos: output[i], modifierIndex: nextIndex });
        }
    }
    return { name, attempted, succeeded };
}

export function placeVanillaPlacedFeatureById(registry, identifier, origin, options = {}) {
    if (!registry || typeof registry.getPlacedFeature !== 'function') throw new TypeError('Expected a vanilla worldgen feature registry');
    return placeVanillaPlacedFeature(registry.getPlacedFeature(identifier), origin, options);
}
