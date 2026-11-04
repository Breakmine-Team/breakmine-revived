import { placeVanillaPlacedFeature } from './placed-features.mjs';
import { createWorldgenFeatureRegistry } from './feature-resources.mjs';
import { placeVegetationPatch } from './vegetation-patch.mjs';
import { placeStraightBlobTree } from './tree-feature.mjs';
import { sampleIntProvider } from './value-providers.mjs';
import { createBlockPredicateTester, DIRECTIONS, requireContext, blockName } from './feature-world.mjs';
import { TERRAIN_FEATURE_TYPES, placeTerrainFeature } from './terrain-features.mjs';
import { placeOreFeature, testOreRule } from './ore-features.mjs';
import { ENVIRONMENT_FEATURE_TYPES, placeEnvironmentFeature } from './environment-features.mjs';
import { SHAPE_FEATURE_TYPES, placeShapeFeature } from './shape-features.mjs';
import { placeHugeFungus } from './huge-fungus-feature.mjs';
import { placeChorusPlant } from './chorus-plant-feature.mjs';
import { SPELEOTHEM_FEATURE_TYPES } from './speleothem-utils.mjs';
import { placeSpeleothem } from './speleothem-feature.mjs';
import { placeSpeleothemCluster } from './speleothem-cluster-feature.mjs';
import { placeLargeDripstone } from './large-dripstone-feature.mjs';
import { placeIceberg } from './iceberg-feature.mjs';
import { PORTAL_FEATURE_TYPES, placePortalFeature } from './portal-features.mjs';
import { placeLake } from './lake-feature.mjs';
import { placeRootSystem } from './root-system-feature.mjs';
import { placeFallenTree } from './fallen-tree-feature.mjs';
import { placeGeode } from './geode-feature.mjs';
import { placeMultifaceGrowth } from './multiface-growth-feature.mjs';
import { DUNGEON_FEATURE_TYPES, placeDungeonFeature } from './dungeon-features.mjs';
import { placeEndSpike } from './end-spike-feature.mjs';
import { placeFossil } from './fossil-feature.mjs';
import { placeSculkPatch } from './sculk-patch-feature.mjs';

function blockStateName(name) {
    if (typeof name !== 'string' || !name) throw new TypeError('Expected a block-state resource name');
    return name.includes(':') ? name : `minecraft:${name}`;
}

export function createBlockStateProviderSampler(data, { stateIdFor, random, context } = {}) {
    if (!data || typeof data !== 'object') throw new TypeError('Expected imported vanilla worldgen resources');
    if (typeof stateIdFor !== 'function') throw new TypeError('Expected a vanilla block-state ID resolver');
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('Expected a JAR-compatible random source');

    function directState(value) {
        const state = typeof value === 'string' ? { id: value } : value;
        if (!state || typeof state !== 'object' || typeof state.id !== 'string') throw new TypeError('Malformed block-state provider entry');
        const name = blockStateName(state.id);
        let properties = state.properties ?? {};
        if (!properties || typeof properties !== 'object' || Array.isArray(properties)) throw new TypeError(`Malformed block properties for ${name}`);
        if (typeof context?.normalizeBlockProperties === 'function') properties = context.normalizeBlockProperties(name, properties);
        const stateId = stateIdFor(name, properties);
        if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError(`No vanilla state ID for ${name}`);
        return { stateId, name, properties: { ...properties } };
    }

    function optional(provider, position, inlineState = false) {
        if (typeof provider === 'string') {
            const name = blockStateName(provider);
            const resource = data[`data/minecraft/worldgen/block_state_provider/${name.slice('minecraft:'.length)}.json`];
            if (resource) return optional(resource, position);
            if (inlineState) return directState(provider);
            throw new Error(`Missing vanilla block-state provider: ${name}`);
        }
        if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new TypeError('Malformed vanilla block-state provider');
        if (typeof provider.id === 'string') return directState(provider);

        const type = String(provider.type || '').replace(/^minecraft:/, '');
        if (type === 'random_block') {
            const blocks = typeof provider.blocks === 'string' && provider.blocks.startsWith('#')
                ? requireContext(context, 'resolveBlockTag')(provider.blocks.slice(1))
                : Array.isArray(provider.blocks) ? provider.blocks : [provider.blocks];
            if (!Array.isArray(blocks)) throw new TypeError('Block tag resolver must preserve registry holder order');
            if (!blocks.length) return null;
            const index = random.nextInt(blocks.length);
            if (!Number.isInteger(index) || index < 0 || index >= blocks.length) throw new RangeError('Random source returned an invalid block-provider draw');
            const selected = blocks[index];
            const state = requireContext(context, 'getDefaultBlockState')(blockName(selected));
            return directState({ id: blockName(state), properties: state.properties ?? {} });
        }
        if (type === 'weighted') {
            if (!Array.isArray(provider.entries) || provider.entries.length === 0) throw new Error('Weighted block-state provider has no entries');
            let total = 0;
            for (const entry of provider.entries) {
                if (!Number.isSafeInteger(entry?.weight) || entry.weight <= 0) throw new RangeError('Invalid weighted block-state entry');
                total += entry.weight;
                if (!Number.isSafeInteger(total) || total > 0x7fffffff) throw new RangeError('Weighted block-state provider total is too large');
            }
            let choice = random.nextInt(total);
            if (!Number.isInteger(choice) || choice < 0 || choice >= total) throw new RangeError('Random source returned an invalid weighted-provider draw');
            for (const entry of provider.entries) {
                if (choice < entry.weight) return optional(entry.data, position, true);
                choice -= entry.weight;
            }
            throw new Error('Weighted block-state selection fell through');
        }
        if (type === 'randomized_int') {
            const source = sample(provider.source, position);
            if (typeof provider.property !== 'string' || !provider.property) throw new TypeError('Randomized block-state provider is missing its property');
            const value = sampleIntProvider(provider.values, random);
            return directState({ id: source.name, properties: { ...source.properties, [provider.property]: String(value) } });
        }
        if (type === 'rotated') {
            const direction = provider.direction ?? DIRECTIONS[random.nextInt(6)];
            if (!DIRECTIONS.includes(direction)) throw new TypeError('Invalid rotated provider direction');
            const source = sample(provider.state, position);
            const properties = { ...source.properties };
            if (Object.hasOwn(properties, 'axis')) properties.axis = ['up', 'down'].includes(direction) ? 'y' : ['east', 'west'].includes(direction) ? 'x' : 'z';
            if (Object.hasOwn(properties, 'facing')) {
                const vertical = ['up', 'down'].includes(direction);
                if (!vertical || ['up', 'down'].includes(properties.facing) || context?.hasSixWayFacing?.(source)) properties.facing = direction;
                else if (typeof context?.hasSixWayFacing !== 'function') throw new TypeError('Rotated vertical facing requires context.hasSixWayFacing()');
            }
            return directState({ id: source.name, properties });
        }
        if (type === 'rule_based') {
            const test = context?.testBlockPredicate?.bind(context) ?? createBlockPredicateTester(context);
            for (const rule of provider.rules) if (test(rule.if_true, position)) {
                const state = optional(rule.then, position, true);
                if (state != null) return state;
            }
            return provider.fallback == null ? null : optional(provider.fallback, position, true);
        }
        if (type === 'noise') {
            if (!Array.isArray(provider.states) || provider.states.length === 0 || !provider.noise ||
                !Number.isFinite(provider.scale) || provider.scale <= 0 || !Number.isInteger(provider.seed)) {
                throw new TypeError('Malformed noise block-state provider');
            }
            const value = requireContext(context, 'sampleNoiseProvider')(provider, position);
            if (!Number.isFinite(value)) throw new TypeError('Noise provider returned a non-finite sample');
            const normalized = Math.max(0, Math.min(0.9999, (1 + value) / 2));
            return directState(provider.states[Math.floor(normalized * provider.states.length)]);
        }
        if (type === 'noise_threshold') {
            const { noise, scale, threshold, high_chance: highChance, default_state: defaultState,
                low_states: lowStates, high_states: highStates } = provider;
            if (!noise || !Number.isFinite(scale) || !Number.isFinite(threshold) || !Number.isFinite(highChance) ||
                !Array.isArray(lowStates) || !lowStates.length || !Array.isArray(highStates) || !highStates.length) {
                throw new TypeError('Malformed noise-threshold block-state provider');
            }
            const value = requireContext(context, 'sampleNoiseProvider')(provider, position);
            if (!Number.isFinite(value)) throw new TypeError('Noise-threshold provider returned a non-finite sample');
            if (value < threshold) return directState(defaultState);
            const selected = random.nextFloat() < highChance ? highStates : lowStates;
            const index = random.nextInt(selected.length);
            if (!Number.isInteger(index) || index < 0 || index >= selected.length) throw new RangeError('Random source returned an invalid noise-threshold draw');
            return directState(selected[index]);
        }
        if (type === 'dual_noise') {
            const states = provider.states;
            const variety = provider.variety;
            if (!Array.isArray(states) || states.length === 0 || !Array.isArray(variety) || variety.length !== 2 ||
                !variety.every(Number.isInteger) || variety[0] < 1 || variety[1] < variety[0] ||
                !Number.isFinite(provider.scale) || provider.scale <= 0 ||
                !Number.isFinite(provider.slow_scale) || provider.slow_scale <= 0 ||
                !Number.isInteger(provider.seed) || !provider.noise || !provider.slow_noise) {
                throw new TypeError('Malformed dual-noise block-state provider');
            }
            const sampleDual = requireContext(context, 'sampleDualNoiseProvider');
            const slowValue = sampleDual(provider, position, 'slow');
            if (!Number.isFinite(slowValue)) throw new TypeError('Dual-noise provider returned a non-finite slow sample');
            // DualNoiseProvider uses Mth.clampedMap(slow, -1, 1, min, max + 1),
            // then Java's float-to-int truncation. This determines candidate count.
            const varietyProgress = Math.max(0, Math.min(1, (slowValue + 1) / 2));
            const varietyCount = Math.trunc(variety[0] + varietyProgress * (variety[1] + 1 - variety[0]));
            const candidates = new Array(varietyCount);
            for (let index = 0; index < varietyCount; index++) {
                const sampleX = (position.x + Math.imul(index, 54545)) | 0;
                const sampleZ = (position.z + Math.imul(index, 34234)) | 0;
                const noiseValue = sampleDual(provider, { x: sampleX, y: position.y, z: sampleZ }, 'slow');
                candidates[index] = provider.states[noiseStateIndex(noiseValue, states.length)];
            }
            const value = sampleDual(provider, position, 'fast');
            if (!Number.isFinite(value)) throw new TypeError('Dual-noise provider returned a non-finite sample');
            return directState(candidates[noiseStateIndex(value, candidates.length)]);
        }
        throw new Error(`Unsupported vanilla block-state provider: ${provider.type || '<missing type>'}`);
    }

    function noiseStateIndex(value, length) {
        const normalized = Math.max(0, Math.min(0.9999, Math.fround(Math.fround(1 + Math.fround(value)) / 2)));
        return Math.trunc(Math.fround(normalized * length));
    }

    function sample(provider, position, inlineState = false) {
        return optional(provider, position, inlineState) ?? requireContext(context, 'getBlockState')(position);
    }
    return { sample, sampleOptional: optional, directState };
}

export function placeSimpleBlock(feature, position, {
    sampleState,
    canSurvive,
    setBlock,
    scheduleTick = () => {},
    canPlaceDoublePlant,
    placeDoublePlant,
    isDoublePlant = () => false
} = {}) {
    if (!feature || feature.type !== 'minecraft:simple_block') throw new Error('Expected a minecraft:simple_block feature');
    for (const [name, callback] of Object.entries({ sampleState, canSurvive, setBlock })) {
        if (typeof callback !== 'function') throw new TypeError(`Simple block placement requires ${name}`);
    }
    if (!position || ![position.x, position.y, position.z].every(Number.isInteger)) throw new TypeError('Expected integer feature coordinates');

    const state = sampleState(feature.to_place, position);
    if (state == null || !canSurvive(state, position)) return false;
    if (isDoublePlant(state)) {
        if (typeof canPlaceDoublePlant !== 'function' || typeof placeDoublePlant !== 'function' || !canPlaceDoublePlant(state, position)) return false;
        placeDoublePlant(state, position, 2);
    } else {
        setBlock(state, position, 2);
    }
    if (feature.schedule_tick) scheduleTick(state, position, 1);
    return true;
}

export function createConfiguredFeaturePlacer(data, {
    stateIdFor,
    canSurvive,
    setBlock,
    scheduleTick,
    isDoublePlant,
    canPlaceDoublePlant,
    placeDoublePlant,
    handlers = {}
} = {}) {
    if (typeof stateIdFor !== 'function') throw new TypeError('Configured feature placement requires stateIdFor(block, properties)');
    for (const name of ['canSurvive', 'setBlock']) {
        if (typeof ({ canSurvive, setBlock })[name] !== 'function') throw new TypeError(`Configured feature placement requires ${name}`);
    }
    if (!handlers || typeof handlers !== 'object' || Array.isArray(handlers)) throw new TypeError('Configured feature handlers must be an object');

    const featureRegistry = createWorldgenFeatureRegistry(data);
    function resolvePlacedFeature(value) {
        if (typeof value === 'string') return featureRegistry.getPlacedFeature(value);
        if (!value || typeof value !== 'object' || !Array.isArray(value.placement)) throw new TypeError('Malformed nested placed feature');
        const reference = typeof value.feature === 'string' ? blockStateName(value.feature) : null;
        const configured = reference ? featureRegistry.getFeature(reference) : value.feature;
        if (!configured || typeof configured !== 'object' || typeof configured.type !== 'string') throw new TypeError('Nested placed feature has no configured feature');
        return { name: reference || '<inline>', featureName: reference || '<inline>', feature: configured, placement: value.placement };
    }
    function placeNested(value, pos, random, context, biomeCheck = true) {
        return placeVanillaPlacedFeature(resolvePlacedFeature(value), pos, {
            random, context, placeFeature: placeConfiguredFeature, biomeCheck
        }).succeeded;
    }
    function placeConfiguredFeature(name, feature, pos, random, context) {
        const handler = handlers[feature?.type];
        if (handler) return handler(name, feature, pos, random, context);
        if (TERRAIN_FEATURE_TYPES.has(feature?.type) || ENVIRONMENT_FEATURE_TYPES.has(feature?.type) || SHAPE_FEATURE_TYPES.has(feature?.type) || SPELEOTHEM_FEATURE_TYPES.has(feature?.type) || PORTAL_FEATURE_TYPES.has(feature?.type) || DUNGEON_FEATURE_TYPES.has(feature?.type) || ['minecraft:ore', 'minecraft:scattered_ore', 'minecraft:lake', 'minecraft:root_system', 'minecraft:fallen_tree', 'minecraft:huge_fungus', 'minecraft:chorus_plant', 'minecraft:iceberg', 'minecraft:geode', 'minecraft:multiface_growth', 'minecraft:end_spike', 'minecraft:fossil', 'minecraft:sculk_patch'].includes(feature?.type)) {
            const providers = createBlockStateProviderSampler(data, { stateIdFor, random, context });
            const options = {
                context, sampleState: providers.sample, sampleOptionalState: providers.sampleOptional,
                directState: providers.directState, setBlock: (state, position, flags) => setBlock(state, position, flags, context),
                canSurvive: (state, position) => canSurvive(state, position, context),
                ...(scheduleTick ? { scheduleTick: (state, position, delay) => scheduleTick(state, position, delay, context) } : {})
            };
            if (feature.type === 'minecraft:lake') return placeLake(feature, pos, random, options);
            if (feature.type === 'minecraft:huge_fungus') return placeHugeFungus(feature, pos, random, options);
            if (feature.type === 'minecraft:chorus_plant') return placeChorusPlant(feature, pos, random, options);
            if (feature.type === 'minecraft:speleothem') return placeSpeleothem(feature, pos, random, options);
            if (feature.type === 'minecraft:speleothem_cluster') return placeSpeleothemCluster(feature, pos, random, options);
            if (feature.type === 'minecraft:large_dripstone') return placeLargeDripstone(feature, pos, random, options);
            if (feature.type === 'minecraft:iceberg') return placeIceberg(feature, pos, random, options);
            if (feature.type === 'minecraft:geode') return placeGeode(feature, pos, random, options);
            if (feature.type === 'minecraft:sculk_patch') return placeSculkPatch(feature, pos, random, options);
            if (feature.type === 'minecraft:multiface_growth') return placeMultifaceGrowth(feature, pos, random, options);
            if (feature.type === 'minecraft:end_spike') return placeEndSpike(feature, pos, random, options);
            if (feature.type === 'minecraft:fossil') return placeFossil(feature, pos, random, { ...options, data });
            if (DUNGEON_FEATURE_TYPES.has(feature.type)) return placeDungeonFeature(feature, pos, random, options);
            if (PORTAL_FEATURE_TYPES.has(feature.type)) return placePortalFeature(feature, pos, random, options);
            if (SHAPE_FEATURE_TYPES.has(feature.type)) return placeShapeFeature(feature, pos, random, {
                ...options, placeNested: (placed, position) => placeNested(placed, position, random, context, false)
            });
            if (feature.type === 'minecraft:fallen_tree') return placeFallenTree(feature, pos, random, { ...options, stateIdFor });
            if (feature.type === 'minecraft:root_system') return placeRootSystem(feature, pos, random, {
                ...options, placeTree: (placed, position) => placeNested(placed, position, random, context, false)
            });
            if (ENVIRONMENT_FEATURE_TYPES.has(feature.type)) return placeEnvironmentFeature(feature, pos, random, options);
            return TERRAIN_FEATURE_TYPES.has(feature.type) ? placeTerrainFeature(feature, pos, random, options) : placeOreFeature(feature, pos, random, options);
        }
        switch (feature?.type) {
            case 'minecraft:replace_single_block': {
                for (const target of feature.targets) {
                    if (!testOreRule(target.target, requireContext(context, 'getBlockState')(pos), pos, random, context)) continue;
                    const providers = createBlockStateProviderSampler(data, { stateIdFor, random, context });
                    setBlock(providers.directState(target.state), pos, 2, context);
                    break;
                }
                return true;
            }
            case 'minecraft:no_op': return true;
            case 'minecraft:overlay':
            case 'minecraft:sequence': {
                const values = Array.isArray(feature.features) ? feature.features : [feature.features];
                let succeeded = false;
                for (const value of values) {
                    const placed = placeNested(value, pos, random, context);
                    if (feature.type === 'minecraft:sequence' && !placed) return false;
                    succeeded = placed || succeeded;
                }
                return feature.type === 'minecraft:sequence' || succeeded;
            }
            case 'minecraft:random_selector': {
                if (!Array.isArray(feature.features) || !feature.default) throw new TypeError('Malformed random selector feature');
                for (const entry of feature.features) {
                    if (!Number.isFinite(entry?.chance) || entry.chance < 0 || entry.chance > 1) throw new RangeError('Invalid random selector chance');
                    if (Math.fround(random.nextFloat()) < Math.fround(entry.chance)) return placeNested(entry.feature, pos, random, context);
                }
                return placeNested(feature.default, pos, random, context);
            }
            case 'minecraft:simple_random_selector': {
                if (!Array.isArray(feature.features) || feature.features.length === 0) throw new TypeError('Simple random selector needs at least one placed feature');
                const selected = random.nextInt(feature.features.length);
                if (!Number.isInteger(selected) || selected < 0 || selected >= feature.features.length) throw new RangeError('Random source returned an invalid selector index');
                return placeNested(feature.features[selected], pos, random, context);
            }
            case 'minecraft:weighted_random_selector': {
                if (!Array.isArray(feature.features) || feature.features.length === 0) throw new TypeError('Weighted random selector needs at least one entry');
                let total = 0;
                for (const entry of feature.features) {
                    if (!Number.isInteger(entry?.weight) || entry.weight <= 0) throw new RangeError('Invalid weighted selector weight');
                    total += entry.weight;
                    if (!Number.isSafeInteger(total) || total > 0x7fffffff) throw new RangeError('Weighted selector total exceeds a Java int');
                }
                let choice = random.nextInt(total);
                if (!Number.isInteger(choice) || choice < 0 || choice >= total) throw new RangeError('Random source returned an invalid weighted selector choice');
                for (const entry of feature.features) {
                    if (choice < entry.weight) return placeNested(entry.data, pos, random, context);
                    choice -= entry.weight;
                }
                throw new Error('Weighted selector selection fell through');
            }
            case 'minecraft:random_boolean_selector': {
                if (typeof random.nextBoolean !== 'function') throw new TypeError('Random boolean selector requires nextBoolean()');
                const selected = random.nextBoolean() ? feature.feature_true : feature.feature_false;
                if (!selected) throw new TypeError('Malformed random boolean selector feature');
                return placeNested(selected, pos, random, context);
            }
            case 'minecraft:vegetation_patch':
            case 'minecraft:waterlogged_vegetation_patch': {
                const providers = createBlockStateProviderSampler(data, { stateIdFor, random, context });
                return placeVegetationPatch(feature, pos, random, {
                    context,
                    sampleGroundState: (provider, position) => providers.sample(provider, position),
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context),
                    placeVegetation: (placed, position) => placeNested(placed, position, random, context)
                });
            }
            case 'minecraft:tree': {
                const providers = createBlockStateProviderSampler(data, { stateIdFor, random, context });
                return placeStraightBlobTree(feature, pos, random, {
                    context,
                    sampleState: (provider, position) => providers.sample(provider, position),
                    sampleOptionalState: (provider, position) => typeof context?.sampleOptionalBlockState === 'function'
                        ? context.sampleOptionalBlockState(provider, position, random) : providers.sampleOptional(provider, position),
                    setBlock: (state, position, flags, treeContext) => setBlock(state, position, flags, treeContext),
                    stateIdFor,
                    placeNestedFeature: (nestedName, nestedPos) => {
                        const resourceName = String(nestedName).replace(/^minecraft:/, '');
                        const nested = data[`data/minecraft/worldgen/feature/${resourceName}.json`];
                        if (!nested) throw new Error(`Missing vanilla configured feature: ${nestedName}`);
                        return placeConfiguredFeature(nestedName, nested, nestedPos, random, context);
                    }
                });
            }
        }
        if (feature?.type !== 'minecraft:simple_block') throw new Error(`Unsupported configured feature type: ${feature?.type ?? '<missing type>'}`);
        if (feature.schedule_tick && typeof scheduleTick !== 'function') throw new TypeError('Scheduled simple-block features require scheduleTick');
        const providers = createBlockStateProviderSampler(data, { stateIdFor, random, context });
        return placeSimpleBlock(feature, pos, {
            sampleState: (provider, position) => providers.sampleOptional(provider, position),
            canSurvive: (state, position) => canSurvive(state, position, context),
            setBlock: (state, position, flags) => setBlock(state, position, flags, context),
            ...(scheduleTick ? { scheduleTick: (state, position, delay) => scheduleTick(state, position, delay, context) } : {}),
            ...(isDoublePlant ? { isDoublePlant } : {}),
            ...(canPlaceDoublePlant ? { canPlaceDoublePlant: (state, position) => canPlaceDoublePlant(state, position, context) } : {}),
            ...(placeDoublePlant ? { placeDoublePlant: (state, position, flags) => placeDoublePlant(state, position, flags, context) } : {})
        });
    }
    return placeConfiguredFeature;
}
