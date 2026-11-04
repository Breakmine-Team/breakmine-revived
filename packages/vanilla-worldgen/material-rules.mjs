const RESOURCE = /^minecraft:[a-z0-9_./-]+$/;

function resource(value, kind) {
    if (typeof value !== 'string' || !RESOURCE.test(value) || value.slice(value.indexOf(':') + 1).split('/').some(part => part === '.' || part === '..')) {
        throw new TypeError(`Invalid ${kind} resource: ${value}`);
    }
    return value;
}

function asset(data, category, id) {
    const key = `data/minecraft/worldgen/${category}/${id.slice('minecraft:'.length)}.json`;
    const value = data[key];
    if (!value) throw new Error(`Missing vanilla ${category.replaceAll('_', ' ')}: ${id}`);
    return value;
}

function resultState(rule, blockStates) {
    const id = resource(rule.result_state, 'block state');
    const state = blockStates[id];
    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) throw new Error(`Missing block-state mapping for ${id}`);
    return state >>> 0;
}

function integer(context, key) {
    const value = context[key];
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError(`Material context requires Java-int ${key}`);
    return value;
}

function surfaceSecondaryDepth(context, range) {
    if (range === 0) return 0;
    const value = context.surfaceSecondary;
    if (!Number.isFinite(value)) throw new TypeError('Material context requires finite surfaceSecondary');
    return Math.trunc(((value - -1) / (1 - -1)) * range);
}

function compileContextCondition(type, condition, extraHandlers) {
    switch (type) {
        case 'minecraft:above_preliminary_surface':
            return context => integer(context, 'blockY') >= integer(context, 'minSurfaceLevel');
        case 'minecraft:hole':
            return context => integer(context, 'surfaceDepth') <= 0;
        case 'minecraft:steep':
            return context => integer(context, 'surfaceGradientX') <= -4 || integer(context, 'surfaceGradientZ') >= 4;
        case 'minecraft:stone_depth': {
            const offset = integer(condition, 'offset');
            const range = integer(condition, 'secondary_depth_range');
            if (range < 0) throw new RangeError('stone_depth secondary_depth_range cannot be negative');
            const ceiling = condition.surface_type === 'ceiling';
            if (!ceiling && condition.surface_type !== 'floor') throw new TypeError(`Unknown cave surface: ${condition.surface_type}`);
            return context => {
                const depth = integer(context, ceiling ? 'stoneDepthBelow' : 'stoneDepthAbove');
                const surface = condition.add_surface_depth ? integer(context, 'surfaceDepth') : 0;
                return depth <= (1 + offset + surface + surfaceSecondaryDepth(context, range));
            };
        }
        case 'minecraft:water': {
            const offset = integer(condition, 'offset');
            const multiplier = integer(condition, 'surface_depth_multiplier');
            return context => {
                const waterHeight = integer(context, 'waterHeight');
                if (waterHeight === -0x80000000) return true;
                const y = integer(context, 'blockY') + (condition.add_stone_depth ? integer(context, 'stoneDepthAbove') : 0);
                const threshold = waterHeight + offset + integer(context, 'surfaceDepth') * multiplier;
                return (y | 0) >= (threshold | 0);
            };
        }
        case 'minecraft:biome': {
            const ids = condition.biome_is;
            const expected = (Array.isArray(ids) ? ids : [ids]).map(id => resource(id, 'biome'));
            return context => expected.includes(context.biome);
        }
        case 'minecraft:y_above': {
            const multiplier = integer(condition, 'surface_depth_multiplier');
            return context => {
                if (typeof context.resolveAnchorY !== 'function') throw new Error('Material context requires resolveAnchorY(anchor) for y_above');
                const anchor = context.resolveAnchorY(condition.anchor);
                if (!Number.isInteger(anchor) || anchor < -0x80000000 || anchor > 0x7fffffff) throw new TypeError('resolveAnchorY must return a Java int');
                const stone = condition.add_stone_depth ? integer(context, 'stoneDepthAbove') : 0;
                return ((integer(context, 'blockY') + stone) | 0) >= ((anchor + integer(context, 'surfaceDepth') * multiplier) | 0);
            };
        }
        case 'minecraft:noise_threshold':
            return context => {
                if (typeof context.sampleNoise !== 'function') throw new Error('Material context requires sampleNoise(noise, is3d) for noise_threshold');
                const value = context.sampleNoise(resource(condition.noise, 'noise'), condition.is_3d === true);
                if (!Number.isFinite(value)) throw new TypeError('sampleNoise must return a finite number');
                return value >= condition.min_threshold && value <= condition.max_threshold;
            };
        case 'minecraft:vertical_gradient':
            return context => {
                if (typeof context.verticalGradient !== 'function') throw new Error('Material context requires verticalGradient(condition) for vertical_gradient');
                const value = context.verticalGradient(condition);
                if (typeof value !== 'boolean') throw new TypeError('verticalGradient must return a boolean');
                return value;
            };
        case 'minecraft:temperature':
            return context => {
                if (typeof context.isColdAt !== 'function') throw new Error('Material context requires isColdAt(x, y, z) for temperature');
                const value = context.isColdAt(integer(context, 'blockX'), integer(context, 'blockY'), integer(context, 'blockZ'), integer(context, 'seaLevel'));
                if (typeof value !== 'boolean') throw new TypeError('isColdAt must return a boolean');
                return value;
            };
        default: {
            const handler = extraHandlers[type];
            if (typeof handler !== 'function') throw new Error(`Unsupported vanilla material condition: ${type}`);
            return context => {
                const value = handler(condition, context);
                if (typeof value !== 'boolean') throw new TypeError(`Condition handler ${type} must return a boolean`);
                return value;
            };
        }
    }
}

export function createMaterialRuleEvaluator(data, { blockStates, conditionHandlers = {}, ruleHandlers = {} } = {}) {
    if (!data || typeof data !== 'object') throw new TypeError('Expected imported vanilla worldgen data');
    if (!blockStates || typeof blockStates !== 'object') throw new TypeError('Expected blockStates mapping');

    const ruleCache = new Map();
    const conditionCache = new Map();
    const activeRules = new Set();
    const activeConditions = new Set();

    function resolveRule(value) {
        if (typeof value === 'string') {
            const id = resource(value, 'material rule');
            if (ruleCache.has(id)) return ruleCache.get(id);
            if (activeRules.has(id)) throw new Error(`Cyclic vanilla material rule reference: ${id}`);
            activeRules.add(id);
            try {
                const resolved = compileRule(asset(data, 'material_rule', id));
                ruleCache.set(id, resolved);
                return resolved;
            } finally { activeRules.delete(id); }
        }
        return compileRule(value);
    }

    function resolveCondition(value) {
        if (typeof value === 'string') {
            const id = resource(value, 'material condition');
            if (conditionCache.has(id)) return conditionCache.get(id);
            if (activeConditions.has(id)) throw new Error(`Cyclic vanilla material condition reference: ${id}`);
            activeConditions.add(id);
            try {
                const resolved = compileCondition(asset(data, 'material_condition', id));
                conditionCache.set(id, resolved);
                return resolved;
            } finally { activeConditions.delete(id); }
        }
        return compileCondition(value);
    }

    function compileCondition(condition) {
        if (!condition || typeof condition !== 'object' || Array.isArray(condition)) throw new TypeError('Malformed vanilla material condition');
        const type = resource(condition.type, 'material condition type');
        if (type === 'minecraft:not') {
            const child = resolveCondition(condition.invert);
            return context => !child(context);
        }
        return compileContextCondition(type, condition, conditionHandlers);
    }

    function compileRule(rule) {
        if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new TypeError('Malformed vanilla material rule');
        const type = resource(rule.type, 'material rule type');
        switch (type) {
            case 'minecraft:block': {
                const state = resultState(rule, blockStates);
                return () => state;
            }
            case 'minecraft:sequence': {
                if (!Array.isArray(rule.sequence)) throw new TypeError('Vanilla material sequence must be an array');
                const children = rule.sequence.map(resolveRule);
                return context => {
                    for (const child of children) {
                        const state = child(context);
                        if (state !== null && state !== undefined) return state;
                    }
                    return null;
                };
            }
            case 'minecraft:condition': {
                const condition = resolveCondition(rule.if_true);
                const child = resolveRule(rule.then_run);
                return context => condition(context) ? child(context) : null;
            }
            case 'minecraft:ore_vein': {
                const ore = resultState({ result_state: rule.ore_block }, blockStates);
                const raw = resultState({ result_state: rule.raw_ore_block }, blockStates);
                const filler = resultState({ result_state: rule.filler_block }, blockStates);
                const chance = Math.fround(rule.raw_ore_chance);
                if (!(chance >= 0 && chance <= 1)) throw new RangeError('Invalid ore-vein raw ore chance');
                const density = resource(rule.density, 'density function');
                const richness = resource(rule.richness, 'density function');
                const gap = resource(rule.filler_gap, 'density function');
                return context => {
                    if (typeof context.sampleDensity !== 'function' || typeof context.randomFloat !== 'function') {
                        throw new Error('Ore-vein context requires sampleDensity(id) and randomFloat(name, drawIndex)');
                    }
                    const vein = Math.fround(context.sampleDensity(density));
                    if (!(vein > 0)) return null;
                    if (context.randomFloat('minecraft:ore', 0) > vein) return null;
                    const richnessValue = Math.fround(context.sampleDensity(richness));
                    if (context.randomFloat('minecraft:ore', 1) < richnessValue && Math.fround(context.sampleDensity(gap)) < 0) {
                        return context.randomFloat('minecraft:ore', 2) < chance ? raw : ore;
                    }
                    return filler;
                };
            }
            case 'minecraft:bandlands':
                return context => {
                    if (typeof context.getBadlandsBand !== 'function') throw new Error('Material context requires getBadlandsBand(x, y, z) for bandlands');
                    const state = context.getBadlandsBand(integer(context, 'blockX'), integer(context, 'blockY'), integer(context, 'blockZ'));
                    if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) throw new TypeError('getBadlandsBand must return a block-state ID');
                    return state >>> 0;
                };
            default: {
                const handler = ruleHandlers[type];
                if (typeof handler !== 'function') throw new Error(`Unsupported vanilla material rule: ${type}`);
                return context => {
                    const state = handler(rule, context);
                    if (state !== null && state !== undefined && (!Number.isInteger(state) || state < 0 || state > 0xffffffff)) {
                        throw new TypeError(`Rule handler ${type} must return a block-state ID or null`);
                    }
                    return state == null ? null : state >>> 0;
                };
            }
        }
    }

    return {
        evaluate(ruleId, context) {
            if (!context || typeof context !== 'object') throw new TypeError('Expected material-rule context');
            return resolveRule(typeof ruleId === 'string' ? resource(ruleId, 'material rule') : ruleId)(context);
        },
        evaluateCondition(conditionId, context) {
            if (!context || typeof context !== 'object') throw new TypeError('Expected material-rule context');
            return resolveCondition(typeof conditionId === 'string' ? resource(conditionId, 'material condition') : conditionId)(context);
        }
    };
}
