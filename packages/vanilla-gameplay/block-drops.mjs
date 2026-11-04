import gameplayData from './generated/recipes-26.3.json' with { type: 'json' };
import { isExcludedVanillithContent } from './content-policy.mjs';

const DOUBLE_PLANTS = new Set([
    'minecraft:sunflower', 'minecraft:lilac', 'minecraft:rose_bush', 'minecraft:peony',
    'minecraft:tall_grass', 'minecraft:large_fern', 'minecraft:tall_seagrass'
]);

function randomInt(random, maxExclusive) {
    return Math.floor(random() * Math.max(1, maxExclusive));
}

function countValue(value, random) {
    if (Number.isFinite(value)) return Math.max(0, Math.floor(value));
    if (value?.type === 'minecraft:uniform') {
        const min = Math.floor(value.min ?? 0), max = Math.floor(value.max ?? min);
        return min + randomInt(random, Math.max(1, max - min + 1));
    }
    return 1;
}

function matchesBlockCondition(condition, context) {
    const names = Array.isArray(condition.blocks) ? condition.blocks : [condition.blocks];
    if (names[0] && !names.includes(context.blockName)) return false;
    return Object.entries(condition.state ?? {}).every(([key, value]) => context.properties?.[key] === String(value));
}

function conditionPasses(condition, context) {
    if (!condition) return true;
    if (typeof condition === 'string') {
        if (condition === 'minecraft:tool/can_silk_touch') return !!context.silkTouch;
        if (condition === 'minecraft:tool/can_shear') return !!context.shears;
        return false;
    }
    switch (condition.type) {
        case 'minecraft:survives_explosion': return !context.explosion;
        case 'minecraft:random_chance': return context.random() < condition.chance;
        case 'minecraft:table_bonus': {
            const chance = condition.chances?.[Math.min(context.fortune ?? 0, (condition.chances?.length ?? 1) - 1)] ?? 0;
            return context.random() < chance;
        }
        case 'minecraft:all_of': return (condition.terms ?? []).every(term => conditionPasses(term, context));
        case 'minecraft:any_of': return (condition.terms ?? []).some(term => conditionPasses(term, context));
        case 'minecraft:inverted': return !conditionPasses(condition.term, context);
        case 'minecraft:match_block': return matchesBlockCondition(condition, context);
        case 'minecraft:location_check': {
            const block = condition.predicate?.block;
            if (!block || !context.world) return false;
            const x = context.x + (condition.offsetX ?? 0), y = context.y + (condition.offsetY ?? 0), z = context.z + (condition.offsetZ ?? 0);
            const state = context.world.getNativeBlockStateAt?.(x, y, z);
            return !!state && matchesBlockCondition({ blocks: block.blocks, state: block.state }, {
                blockName: state.name, properties: state.properties
            });
        }
        case 'minecraft:match_tool': {
            const items = condition.predicate?.items;
            return !!context.heldItemName && (!items || (Array.isArray(items) ? items : [items]).includes(context.heldItemName));
        }
        // Component-copy predicates and entity-context conditions need their
        // corresponding gameplay systems. Fail closed until those contexts exist.
        default: return false;
    }
}

function applyFunctions(drop, functions, context) {
    for (const fn of Array.isArray(functions) ? functions : functions ? [functions] : []) {
        switch (fn.type) {
            case 'minecraft:set_count': drop.count = countValue(fn.count, context.random); break;
            case 'minecraft:limit_count': {
                const min = fn.limit?.min ?? 0, max = fn.limit?.max ?? Infinity;
                drop.count = Math.max(min, Math.min(max, drop.count));
                break;
            }
            case 'minecraft:apply_bonus': {
                const level = Math.max(0, context.fortune ?? 0);
                if (fn.formula === 'minecraft:uniform_bonus_count') {
                    const multiplier = fn.parameters?.bonusMultiplier ?? 1;
                    drop.count += randomInt(context.random, level * multiplier + 1);
                } else if (fn.formula === 'minecraft:ore_drops' && level > 0) {
                    const bonus = Math.max(0, randomInt(context.random, level + 2) - 1);
                    if (bonus > 0) drop.count *= randomInt(context.random, bonus + 1) + 1;
                    drop.count = Math.min(64, drop.count);
                }
                break;
            }
            // Block drops in this client are not explosion-generated. These
            // functions only copy components/state that ItemStack cannot yet
            // represent and therefore intentionally do not change the count.
            case 'minecraft:explosion_decay':
            case 'minecraft:copy_components':
            case 'minecraft:copy_state':
                break;
            default:
                break;
        }
    }
    return drop;
}

function evaluateEntry(entry, context) {
    if (!conditionPasses(entry.condition, context)) return [];
    if (entry.type === 'minecraft:item') {
        const drop = { name: entry.name, count: 1 };
        applyFunctions(drop, entry.modifier ?? entry.functions, context);
        return drop.count > 0 ? [drop] : [];
    }
    if (entry.type === 'minecraft:alternatives') {
        for (const child of entry.children ?? []) {
            const drops = evaluateEntry(child, context);
            if (drops.length) return drops;
        }
        return [];
    }
    if (entry.type === 'minecraft:sequence') {
        const result = [];
        for (const child of entry.children ?? []) {
            const drops = evaluateEntry(child, context);
            if (!drops.length) return [];
            result.push(...drops);
        }
        return result;
    }
    if (entry.type === 'minecraft:group') return (entry.children ?? []).flatMap(child => evaluateEntry(child, context));
    return [];
}

export function getVanillaBlockDrops(name, properties = {}, context = {}) {
    if (isExcludedVanillithContent(name)) return [];
    const table = gameplayData.blockLootTables?.[name];
    if (!table) return [];
    const ctx = {
        blockName: name,
        properties,
        random: context.random ?? Math.random,
        fortune: context.fortune ?? 0,
        silkTouch: context.silkTouch ?? false,
        shears: context.shears ?? false,
        ...context
    };
    const drops = [];
    for (const pool of table.pools ?? []) {
        if (!conditionPasses(pool.condition, ctx)) continue;
        const rolls = Math.min(64, countValue(pool.rolls ?? 1, ctx.random));
        for (let roll = 0; roll < rolls; roll++) {
            for (const entry of pool.entries ?? []) drops.push(...evaluateEntry(entry, ctx));
        }
    }
    return drops;
}

export function hasVanillaBlockLootTable(name) {
    return Object.hasOwn(gameplayData.blockLootTables ?? {}, name);
}

// Compatibility for older single-drop blocks and tests. Native render blocks
// use getVanillaBlockDrops so multi-pool tables (e.g. leaves) keep every drop.
export function getVanillaBlockDrop(name, properties = {}, blockId, random = Math.random, context = {}) {
    if (DOUBLE_PLANTS.has(name) && properties.half === 'upper') return null;
    const drops = getVanillaBlockDrops(name, properties, { ...context, random });
    if (drops.length) return drops[0].name;
    if (hasVanillaBlockLootTable(name)) return null;
    return Number.isInteger(blockId) && blockId > 0 ? blockId : null;
}
