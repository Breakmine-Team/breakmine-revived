import { placeTrunkByType, sampleTrunkHeight } from './tree-trunk.mjs';
import { getRootTrunkOrigin, placeMangroveRoots } from './root-placer.mjs';
import {
    getFoliageHeight,
    placeAcaciaFoliage,
    placeBlobFoliage,
    placeBushFoliage,
    placeCherryFoliage,
    placeDarkOakFoliage,
    placeFancyFoliage,
    placeMegaJungleFoliage,
    placeMegaPineFoliage,
    placePineFoliage,
    placePoplarFoliage,
    placeRandomSpreadFoliage,
    placeSpruceFoliage,
    sampleFoliageRadius
} from './tree-foliage.mjs';
import {
    placeBeehiveDecorator,
    placeAlterGroundDecorator,
    placeAttachedToLeavesDecorator,
    placeAttachedToLogsDecorator,
    placeCocoaDecorator,
    placeCreakingHeartDecorator,
    placeLeaveVineDecorator,
    placeOnGroundDecorator,
    placePaleMossDecorator,
    placeShelfMushroomDecorator,
    placeTrunkVineDecorator
} from './tree-decorators.mjs';

function requireCallback(context, name) {
    if (typeof context?.[name] !== 'function') throw new TypeError(`Tree feature requires context.${name}`);
    return context[name];
}

function featureSizeWidth(size, treeHeight, y) {
    if (size?.type === 'minecraft:three_layers_feature_size') {
        const limit = size.limit ?? 1;
        const upperLimit = size.upper_limit ?? 1;
        const lower = size.lower_size ?? 0;
        const middle = size.middle_size ?? 1;
        const upper = size.upper_size ?? 1;
        if (![limit, upperLimit, lower, middle, upper].every(Number.isInteger) || limit < 0 || limit > 80 || upperLimit < 0 || upperLimit > 80 || [lower, middle, upper].some(value => value < 0 || value > 16)) {
            throw new RangeError('Invalid three-layers tree feature size');
        }
        if (y < limit) return lower;
        if (y >= treeHeight - upperLimit) return upper;
        return middle;
    }
    if (size?.type !== 'minecraft:two_layers_feature_size') throw new Error(`Unsupported tree minimum size: ${size?.type ?? '<missing type>'}`);
    const limit = size.limit ?? 1;
    const lower = size.lower_size ?? 0;
    const upper = size.upper_size ?? 1;
    if (![limit, lower, upper].every(Number.isInteger) || limit < 0 || limit > 81 || lower < 0 || lower > 16 || upper < 0 || upper > 16) {
        throw new RangeError('Invalid two-layers tree feature size');
    }
    return y < limit ? lower : upper;
}

export function placeStraightBlobTree(feature, origin, random, {
    context = {}, sampleState, sampleOptionalState, setBlock, stateIdFor, placeNestedFeature
} = {}) {
    if (!feature || feature.type !== 'minecraft:tree') throw new TypeError('Expected a minecraft:tree feature');
    const supportedTrunks = [
        'minecraft:straight_trunk_placer', 'minecraft:forking_trunk_placer',
        'minecraft:bending_trunk_placer', 'minecraft:giant_trunk_placer',
        'minecraft:upwards_branching_trunk_placer', 'minecraft:dark_oak_trunk_placer',
        'minecraft:mega_jungle_trunk_placer', 'minecraft:cherry_trunk_placer',
        'minecraft:poplar_trunk_placer', 'minecraft:fancy_trunk_placer'
    ];
    const supportedFoliage = [
        'minecraft:blob_foliage_placer', 'minecraft:acacia_foliage_placer',
        'minecraft:bush_foliage_placer', 'minecraft:dark_oak_foliage_placer',
        'minecraft:fancy_foliage_placer', 'minecraft:jungle_foliage_placer', 'minecraft:pine_foliage_placer',
        'minecraft:random_spread_foliage_placer', 'minecraft:spruce_foliage_placer',
        'minecraft:cherry_foliage_placer', 'minecraft:poplar_foliage_placer',
        'minecraft:mega_pine_foliage_placer'
    ];
    if (!supportedTrunks.includes(feature.trunk_placer?.type) || !supportedFoliage.includes(feature.foliage_placer?.type)) {
        throw new Error('Tree feature requires a supported trunk placer and foliage placer');
    }
    if (feature.root_placer != null && feature.root_placer.type !== 'minecraft:mangrove_root_placer') {
        throw new Error(`Unsupported tree root placer: ${feature.root_placer.type}`);
    }
    const supportedDecorators = [
        'minecraft:beehive', 'minecraft:place_on_ground', 'minecraft:trunk_vine',
        'minecraft:leave_vine', 'minecraft:cocoa', 'minecraft:shelf_mushroom',
        'minecraft:alter_ground', 'minecraft:attached_to_leaves', 'minecraft:attached_to_logs', 'minecraft:pale_moss',
        'minecraft:creaking_heart'
    ];
    if (feature.decorators != null && (!Array.isArray(feature.decorators) || feature.decorators.some(decorator => !supportedDecorators.includes(decorator?.type)))) {
        throw new Error('Tree feature contains an unsupported decorator');
    }
    if (!feature.trunk_provider || !feature.foliage_provider || !feature.minimum_size) throw new TypeError('Tree feature is missing a provider or minimum size');
    for (const [name, callback] of Object.entries({ sampleState, setBlock, stateIdFor })) {
        if (typeof callback !== 'function') throw new TypeError(`Tree feature placement requires ${name}`);
    }
    const isValidTreePos = requireCallback(context, 'isValidTreePos');
    const isTreeFreePos = requireCallback(context, 'isTreeFreePos');
    const isVine = requireCallback(context, 'isVine');
    const isAirOrLeaves = requireCallback(context, 'isAirOrLeaves');
    const isWater = requireCallback(context, 'isWater');
    if (feature.foliage_placer.type === 'minecraft:poplar_foliage_placer') requireCallback(context, 'getBlockState');
    if (feature.root_placer != null) {
        requireCallback(context, 'canMangroveRootGrowThrough');
        requireCallback(context, 'isMuddyRootsIn');
    }
    const minY = context.minY;
    const maxY = context.maxY;
    if (!Number.isInteger(minY) || !Number.isInteger(maxY) || maxY <= minY) throw new TypeError('Tree feature requires valid context.minY and context.maxY');
    if (feature.below_trunk_provider != null && typeof sampleOptionalState !== 'function') {
        throw new TypeError('Tree feature requires sampleOptionalState for below_trunk_provider');
    }

    const treeHeight = sampleTrunkHeight(feature.trunk_placer, random);
    const foliageHeight = getFoliageHeight(feature.foliage_placer, random, treeHeight);
    const foliageRadius = sampleFoliageRadius(feature.foliage_placer, random, treeHeight - foliageHeight);
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new TypeError('Tree origin must be an integer block position');
    const trunkOrigin = feature.root_placer == null ? origin : getRootTrunkOrigin(feature.root_placer, origin, random);
    if (Math.min(origin.y, trunkOrigin.y) < minY + 1 || Math.max(origin.y, trunkOrigin.y) + treeHeight + 1 > maxY + 1) return false;

    let freeHeight = treeHeight;
    for (let y = 0; y <= treeHeight; y++) {
        const width = featureSizeWidth(feature.minimum_size, treeHeight, y);
        let blocked = false;
        for (let dx = -width; dx <= width && !blocked; dx++) {
            for (let dz = -width; dz <= width; dz++) {
                const pos = { x: trunkOrigin.x + dx, y: trunkOrigin.y + y, z: trunkOrigin.z + dz };
                if (!isTreeFreePos(pos) || (!feature.ignore_vines && isVine(pos))) {
                    blocked = true;
                    break;
                }
            }
        }
        if (blocked) {
            freeHeight = y - 2;
            break;
        }
    }
    if (freeHeight < treeHeight && (feature.minimum_size.min_clipped_height == null || freeHeight < feature.minimum_size.min_clipped_height)) return false;

    let trunkBlocks = 0;
    const logPositions = [];
    if (feature.root_placer != null) {
        const placedRoots = placeMangroveRoots(feature.root_placer, origin, trunkOrigin, random, {
            isValidTreePos,
            canGrowThrough: (pos, tag) => context.canMangroveRootGrowThrough(pos, tag),
            isMuddyRootsIn: pos => context.isMuddyRootsIn(pos, feature.root_placer.mangrove_root_placement.muddy_roots_in),
            isWater,
            isAir: requireCallback(context, 'isAir'),
            sampleState,
            stateIdFor,
            setBlock: (state, pos, flags) => setBlock(state, pos, flags, context)
        });
        if (!placedRoots) return false;
    }

    const attachments = placeTrunkByType(feature, trunkOrigin, freeHeight, random, {
        sampleTrunkState: (provider, pos, source) => sampleState(provider, pos, source),
        sampleBelowTrunkState: (provider, pos, source) => sampleOptionalState(provider, pos, source),
        isValidTreePos,
        stateIdFor,
        isLog: context.isLog ?? (() => false),
        canGrowThrough: context.canGrowThrough ?? (() => false),
        setBlock(state, pos, flags) {
            setBlock(state, pos, flags, context);
            if (pos.y >= origin.y) {
                trunkBlocks++;
                logPositions.push(pos);
            }
        }
    });

    let foliageBlocks = 0;
    const leafPositions = [];
    const leafPositionKeys = new Set();
    for (const attachment of attachments) {
        const foliageCallbacks = {
            canPlaceLeaf: pos => isAirOrLeaves(pos) || isValidTreePos(pos),
            placeLeaf(pos) {
                const state = sampleState(feature.foliage_provider, pos, random);
                let placedState = state;
                if (Object.hasOwn(state.properties ?? {}, 'waterlogged')) {
                    const properties = { ...state.properties, waterlogged: String(Boolean(isWater(pos))) };
                    const stateId = stateIdFor(state.name, properties);
                    if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError(`No vanilla state ID for ${state.name}`);
                    placedState = { ...state, stateId, properties };
                }
                setBlock(placedState, pos, 19, context);
                foliageBlocks++;
                leafPositions.push(pos);
                leafPositionKeys.add(`${pos.x},${pos.y},${pos.z}`);
            },
            isLeafPlaced: (x, y, z) => leafPositionKeys.has(`${x},${y},${z}`),
            sampleFoliageState: (pos, source) => sampleState(feature.foliage_provider, pos, source),
            getBlockState: pos => context.getBlockState(pos),
            replaceLeafWithLog(pos, axis, source) {
                let state = sampleState(feature.trunk_provider, pos, source);
                if (Object.hasOwn(state.properties ?? {}, 'axis')) {
                    const properties = { ...state.properties, axis };
                    const stateId = stateIdFor(state.name, properties);
                    if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError(`No vanilla state ID for ${state.name} axis=${axis}`);
                    state = { ...state, stateId, properties };
                }
                setBlock(state, pos, 19, context);
                trunkBlocks++;
                logPositions.push(pos);
            }
        };
        const placer = feature.foliage_placer.type;
        const placeFoliage = placer === 'minecraft:blob_foliage_placer' ? placeBlobFoliage
            : placer === 'minecraft:acacia_foliage_placer' ? placeAcaciaFoliage
                : placer === 'minecraft:bush_foliage_placer' ? placeBushFoliage
                    : placer === 'minecraft:dark_oak_foliage_placer' ? placeDarkOakFoliage
                        : placer === 'minecraft:fancy_foliage_placer' ? placeFancyFoliage
                        : placer === 'minecraft:jungle_foliage_placer' ? placeMegaJungleFoliage
                            : placer === 'minecraft:cherry_foliage_placer' ? placeCherryFoliage
                        : placer === 'minecraft:poplar_foliage_placer' ? placePoplarFoliage
                            : placer === 'minecraft:mega_pine_foliage_placer' ? placeMegaPineFoliage
                                : placer === 'minecraft:pine_foliage_placer' ? placePineFoliage
                                    : placer === 'minecraft:random_spread_foliage_placer' ? placeRandomSpreadFoliage
                                        : placeSpruceFoliage;
        placeFoliage(feature.foliage_placer, attachment, foliageHeight, foliageRadius, random, foliageCallbacks);
    }
    if (trunkBlocks > 0 || foliageBlocks > 0) {
        for (const decorator of feature.decorators ?? []) {
            if (decorator.type === 'minecraft:beehive') {
                placeBeehiveDecorator(decorator, logPositions, leafPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:place_on_ground') {
                placeOnGroundDecorator(decorator, leafPositions, random, {
                    context,
                    sampleState: (provider, position, source) => sampleState(provider, position, source),
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:trunk_vine') {
                placeTrunkVineDecorator(logPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:leave_vine') {
                placeLeaveVineDecorator(decorator, leafPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:cocoa') {
                placeCocoaDecorator(decorator, logPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:shelf_mushroom') {
                placeShelfMushroomDecorator(decorator, logPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:alter_ground') {
                placeAlterGroundDecorator(decorator, logPositions, random, {
                    context,
                    sampleOptionalState,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:attached_to_logs') {
                placeAttachedToLogsDecorator(decorator, logPositions, random, {
                    context, sampleState: (provider, position) => sampleState(provider, position, random),
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:attached_to_leaves') {
                placeAttachedToLeavesDecorator(decorator, leafPositions, random, {
                    context,
                    sampleState: (provider, position, source) => sampleState(provider, position, source),
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            } else if (decorator.type === 'minecraft:pale_moss') {
                if (typeof placeNestedFeature !== 'function') throw new TypeError('Pale moss decorator requires placeNestedFeature');
                placePaleMossDecorator(decorator, logPositions, leafPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context),
                    placeFeature: (name, position) => placeNestedFeature(name, position)
                });
            } else {
                placeCreakingHeartDecorator(decorator, logPositions, random, {
                    context,
                    stateIdFor,
                    setBlock: (state, position, flags) => setBlock(state, position, flags, context)
                });
            }
        }
    }
    return trunkBlocks > 0 || foliageBlocks > 0;
}
