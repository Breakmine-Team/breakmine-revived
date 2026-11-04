import { createJavaLegacyRandom, shuffled, worldSeed } from './java-legacy-random.mjs';
import { blockName, matchesHolderSet, requireContext } from './feature-world.mjs';
import { testOreRule } from './ore-features.mjs';
import { sampleIntProvider } from './value-providers.mjs';

function equalTag(a, b) {
    if (Object.is(a,b)) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    if (Array.isArray(a) !== Array.isArray(b) || (a instanceof Uint8Array) !== (b instanceof Uint8Array)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(k => Object.hasOwn(b,k) && equalTag(a[k],b[k]));
}

export function structurePositionSeed({ x, y, z }) {
    if (![x, y, z].every(v => Number.isInteger(v) && v >= -2147483648 && v <= 2147483647)) throw new RangeError('Structure position must use Java ints');
    const n = BigInt(Math.imul(x, 3129871)) ^ (BigInt(z) * 116129781n) ^ BigInt(y);
    return BigInt.asIntN(64, n * n * 42317861n + n * 11n) >> 16n;
}

export function resolveStructureProcessors(data, value) {
    if (typeof value === 'string') {
        if (!/^minecraft:[a-z0-9_/]+$/.test(value)) throw new TypeError('Invalid processor-list resource ID');
        const definition = data[`data/minecraft/worldgen/processor_list/${value.slice(10)}.json`];
        if (!definition) throw new Error(`Missing processor list: ${value}`);
        return resolveStructureProcessors(data, definition);
    }
    const processors = Array.isArray(value) ? value : value?.processors;
    if (!Array.isArray(processors)) throw new TypeError('Expected structure processor list');
    return processors;
}

export function testStructurePositionRule(rule, local, world, origin, random) {
    const type = rule?.predicate_type?.replace(/^minecraft:/, '') ?? 'always_true';
    if (type === 'always_true') return true;
    if (!['linear_pos', 'axis_aligned_linear_pos'].includes(type)) throw new Error(`Unsupported structure position predicate: ${type}`);
    const min = rule.min_dist ?? 0, max = rule.max_dist ?? 0;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min >= max) throw new RangeError('Invalid structure position interval');
    const distance = type === 'linear_pos' ? Math.abs(world.x - origin.x) + Math.abs(world.y - origin.y) + Math.abs(world.z - origin.z)
        : Math.abs(world[rule.axis ?? 'y'] - origin[rule.axis ?? 'y']);
    const f = Math.fround, t = f(f(distance - min) / f(max - min));
    const a = f(rule.min_chance ?? 0), b = f(rule.max_chance ?? 0);
    const chance = t < 0 ? a : t > 1 ? b : f(a + f(t * f(b - a)));
    return random.nextFloat() <= chance;
}

export function processStructureBlocks(blocks, processors, origin, pivot, { context, random, directState }) {
    const f = Math.fround;
    const settingsRandom = pos => random ?? createJavaLegacyRandom(structurePositionSeed(pos));
    const defaultState = value => {
        const name = blockName(value), supplied = typeof value === 'string' ? {} : value.properties ?? {};
        const defaults = requireContext(context, 'getDefaultBlockState')(name);
        return directState({ id: name, properties: { ...defaults.properties, ...supplied } });
    };
    function tagOutput(modifier, nbt, rng) {
        function merge(target, source) {
            const compound = value => value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array);
            for (const [key,value] of Object.entries(source)) {
                if (compound(value) && Object.hasOwn(target,key) && compound(target[key])) merge(target[key],value);
                else Object.defineProperty(target,key,{value:structuredClone(value),enumerable:true,writable:true,configurable:true});
            }
            return target;
        }
        switch (modifier?.type?.replace(/^minecraft:/, '') ?? 'passthrough') {
            case 'passthrough': return nbt;
            case 'clear': return Object.create(null);
            case 'append_static': return merge(nbt ?? Object.create(null), modifier.data);
            case 'append_loot': return Object.assign(nbt ? structuredClone(nbt) : Object.create(null), { LootTable: modifier.loot_table, LootTableSeed: rng.nextLong() });
            default: throw new Error(`Unsupported structure NBT modifier: ${modifier.type}`);
        }
    }
    function process(processor, local, info) {
        switch (processor.processor_type?.replace(/^minecraft:/, '')) {
            case 'block_rot': {
                const integrity = f(processor.integrity);
                if (!(integrity >= 0 && integrity <= 1)) throw new RangeError('Invalid structure integrity');
                return processor.rottable_blocks !== undefined && !matchesHolderSet(processor.rottable_blocks, info.state, context) || settingsRandom(info.pos).nextFloat() <= integrity ? info : null;
            }
            case 'protected_blocks': return matchesHolderSet(processor.value, requireContext(context, 'getBlockState')(info.pos), context) ? null : info;
            case 'rule': {
                const rng = createJavaLegacyRandom(structurePositionSeed(info.pos));
                for (const rule of processor.rules) {
                    if (!testOreRule(rule.input_predicate, info.state, info.pos, rng, context)) continue;
                    const loc = rule.location_predicate;
                    const locationMatch = loc?.predicate_type === 'minecraft:always_true' || testOreRule(loc, requireContext(context, 'getBlockState')(info.pos), info.pos, rng, context);
                    if (locationMatch && testStructurePositionRule(rule.position_predicate, local, info.pos, pivot, rng)) {
                        return { ...info, state: defaultState(rule.output_state), nbt: tagOutput(rule.block_entity_modifier, info.nbt, rng) };
                    }
                }
                return info;
            }
            case 'capped': return info;
            case 'block_ignore': return matchesHolderSet(processor.blocks, info.state, context) ? null : info;
            case 'nop': return info;
            default: throw new Error(`Unsupported structure processor: ${processor.processor_type}`);
        }
    }
    const originals = [], result = [];
    for (const block of blocks) {
        let info = { ...block, nbt: block.nbt ? structuredClone(block.nbt) : null };
        for (const processor of processors) { if (!info) break; info = process(processor, block.local, info); }
        if (info) { originals.push(block); result.push(info); }
    }
    for (const processor of processors) {
        if (processor.processor_type !== 'minecraft:capped' || !result.length) continue;
        const forkSeed = createJavaLegacyRandom(worldSeed(context?.seed)).nextLong();
        const rng = createJavaLegacyRandom(forkSeed ^ structurePositionSeed(origin));
        const limit = Math.min(sampleIntProvider(processor.limit, rng), result.length);
        if (limit < 1) continue;
        let changed = 0;
        for (const index of shuffled(result.keys(), rng)) {
            if (changed >= limit) break;
            const before = result[index], after = process(processor.delegate, originals[index].local, before);
            if (after && (after.state.name !== before.state.name || !equalTag(after.pos,before.pos) || !equalTag(after.state.properties,before.state.properties) || !equalTag(after.nbt,before.nbt))) {
                result[index] = after; changed++;
            }
        }
    }
    return result;
}
