import gameplayData from './generated/recipes-26.3.json' with { type: 'json' };

const TOOL_SPEED = Object.freeze({ wood: 2, gold: 12, stone: 4, iron: 6, diamond: 8, netherite: 9 });
const TOOL_TIER = Object.freeze({ wood: 0, gold: 0, stone: 1, iron: 2, diamond: 3, netherite: 4 });
const nativeTagCache = new Map();

function expandBlockTag(tag, visiting = new Set()) {
    if (nativeTagCache.has(tag)) return nativeTagCache.get(tag);
    if (visiting.has(tag)) return new Set();
    const next = new Set(visiting);
    next.add(tag);
    const values = gameplayData.blockTags?.[tag]?.values ?? [];
    const result = new Set();
    for (const value of values) {
        const id = typeof value === 'string' ? value : value?.id;
        if (typeof id !== 'string') continue;
        if (id.startsWith('#')) for (const child of expandBlockTag(id.slice(1), next)) result.add(child);
        else result.add(id);
    }
    nativeTagCache.set(tag, result);
    return result;
}

export function getVanillaMiningRule(blockName) {
    const tools = ['pickaxe', 'axe', 'shovel', 'hoe'];
    const toolType = tools.find(tool => expandBlockTag(`minecraft:mineable/${tool}`).has(blockName)) ?? null;
    const minimumToolLevel = ['diamond', 'iron', 'stone'].find(tier =>
        expandBlockTag(`minecraft:needs_${tier}_tool`).has(blockName)) ?? null;
    return { toolType, minimumToolLevel, requiresToolForDrops: minimumToolLevel !== null };
}

export function canHarvestBlock(block, tool) {
    if (!block) return false;
    const minimum = block.minimumToolLevel?.();
    if (!block.requiresToolForDrops && !minimum) return true;
    const name = block.nativeBlockName ?? block.descriptor?.name;
    if (name && tool?.nativeTool) {
        const rule = tool.nativeTool.rules.find(rule => rule.correctForDrops !== undefined && matchesToolRule(rule, name));
        return rule?.correctForDrops ?? false;
    }
    if (!tool || tool.toolType !== block.getPreferredToolType?.()) return false;
    return !minimum || (TOOL_TIER[tool.material] ?? -1) >= (TOOL_TIER[minimum] ?? Infinity);
}

function matchesToolRule(rule, name) {
    return rule.tag ? expandBlockTag(rule.tag).has(name) : rule.blocks?.includes(name);
}

export function getBlockMiningTicks(block, tool, context = {}) {
    const hardness = Number(block?.getHardness?.());
    if (!Number.isFinite(hardness) || hardness < 0) return Infinity;
    if (hardness === 0) return 0;
    const preferred = block.getPreferredToolType?.();
    let speed = tool && preferred && tool.toolType === preferred ? TOOL_SPEED[tool.material] ?? 1 : 1;
    const name = block.nativeBlockName ?? block.descriptor?.name;
    if (name && tool?.nativeTool) {
        const rule = tool.nativeTool.rules.find(rule => rule.speed !== undefined && matchesToolRule(rule, name));
        speed = rule?.speed ?? tool.nativeTool.defaultMiningSpeed;
    }
    const efficiency = context.efficiency ?? 0;
    if (speed > 1 && efficiency > 0) speed += efficiency * efficiency + 1;
    if (context.haste >= 0) speed *= 1 + .2 * (context.haste + 1);
    if (context.fatigue >= 0) speed *= [0.3, 0.09, 0.0027, 0.00081][Math.min(3, context.fatigue)];
    if (context.underwater && !context.aquaAffinity) speed /= 5;
    if (context.onGround === false) speed /= 5;
    return Math.max(1, Math.ceil(hardness * (canHarvestBlock(block, tool) ? 30 : 100) / speed));
}
