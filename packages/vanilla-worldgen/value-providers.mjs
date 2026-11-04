function javaInt(value, label) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError(`${label} must be a Java int`);
    return value;
}

function nextInt(random, bound) {
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('Provider sampling requires random.nextInt(bound)');
    return random.nextInt(bound);
}

function nextFloat(random) {
    if (!random || typeof random.nextFloat !== 'function') throw new TypeError('Float provider sampling requires random.nextFloat()');
    const value = random.nextFloat();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('random.nextFloat() must return [0, 1)');
    return Math.fround(value);
}

function intBetween(random, min, max) {
    min = javaInt(min, 'minimum'); max = javaInt(max, 'maximum');
    if (max < min) throw new RangeError('Provider maximum is below its minimum');
    const span = (max - min + 1) | 0;
    if (span <= 0) throw new RangeError('Provider range exceeds Java int sampling');
    return (min + nextInt(random, span)) | 0;
}

export function sampleIntProvider(provider, random) {
    if (Number.isInteger(provider)) return javaInt(provider, 'constant integer provider');
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new TypeError('Malformed integer provider');
    if (provider.type == null && Number.isInteger(provider.min_inclusive) && Number.isInteger(provider.max_inclusive)) {
        return intBetween(random, provider.min_inclusive, provider.max_inclusive);
    }
    switch (provider.type) {
        case 'minecraft:constant':
            return javaInt(provider.value, 'constant integer provider');
        case 'minecraft:uniform':
            return intBetween(random, provider.min_inclusive, provider.max_inclusive);
        case 'minecraft:biased_to_bottom': {
            const min = javaInt(provider.min_inclusive, 'minimum');
            const max = javaInt(provider.max_inclusive, 'maximum');
            if (max < min) throw new RangeError('Biased provider maximum is below its minimum');
            const first = nextInt(random, (max - min + 1) | 0) + 1;
            return (min + nextInt(random, first)) | 0;
        }
        case 'minecraft:very_biased_to_bottom': {
            const min = javaInt(provider.min_inclusive, 'minimum');
            const max = javaInt(provider.max_inclusive, 'maximum');
            if (max < min) throw new RangeError('Very-biased provider maximum is below its minimum');
            const first = nextInt(random, (max - min + 1) | 0) + 1;
            const second = nextInt(random, first) + 1;
            return (min + nextInt(random, second)) | 0;
        }
        case 'minecraft:trapezoid': {
            const min = javaInt(provider.min, 'trapezoid minimum');
            const max = javaInt(provider.max, 'trapezoid maximum');
            const plateau = javaInt(provider.plateau, 'trapezoid plateau');
            if (max < min || plateau < 0 || plateau > max - min) throw new RangeError('Invalid trapezoid integer provider');
            if (plateau === 0 && max === -min) return nextInt(random, max + 1) - nextInt(random, max + 1);
            if (plateau === max - min) return min + nextInt(random, max - min + 1);
            const lower = ((max - min - plateau) / 2) | 0;
            const upper = max - min - lower;
            return min + nextInt(random, upper + 1) + nextInt(random, lower + 1);
        }
        case 'minecraft:weighted_list': {
            if (!Array.isArray(provider.distribution) || provider.distribution.length === 0) throw new TypeError('Weighted integer provider needs a non-empty distribution');
            let total = 0;
            for (const entry of provider.distribution) {
                if (!Number.isSafeInteger(entry?.weight) || entry.weight <= 0) throw new RangeError('Invalid weighted integer entry');
                total += entry.weight;
                if (!Number.isSafeInteger(total) || total > 0x7fffffff) throw new RangeError('Weighted integer total exceeds Java int range');
            }
            let draw = nextInt(random, total);
            for (const entry of provider.distribution) {
                if (draw < entry.weight) return sampleIntProvider(entry.data, random);
                draw -= entry.weight;
            }
            throw new Error('Weighted integer selection fell through');
        }
        case 'minecraft:clamped': {
            const min = javaInt(provider.min_inclusive, 'clamped minimum');
            const max = javaInt(provider.max_inclusive, 'clamped maximum');
            if (max < min) throw new RangeError('Clamped integer maximum is below its minimum');
            return Math.min(max, Math.max(min, sampleIntProvider(provider.source, random)));
        }
        case 'minecraft:clamped_normal': {
            const mean = Math.fround(provider.mean);
            const deviation = Math.fround(provider.deviation);
            const min = javaInt(provider.min_inclusive, 'clamped-normal minimum');
            const max = javaInt(provider.max_inclusive, 'clamped-normal maximum');
            if (![mean, deviation].every(Number.isFinite) || deviation < 0 || max < min) throw new RangeError('Invalid clamped-normal integer provider');
            if (typeof random?.nextGaussian !== 'function') throw new TypeError('Clamped-normal sampling requires random.nextGaussian()');
            const normal = Math.fround(mean + Math.fround(Math.fround(random.nextGaussian()) * deviation));
            return Math.trunc(Math.min(max, Math.max(min, normal)));
        }
        default: throw new Error(`Unsupported vanilla integer provider: ${provider.type}`);
    }
}

export function sampleFloatProvider(provider, random) {
    if (typeof provider === 'number') return Math.fround(provider);
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new TypeError('Malformed float provider');
    switch (provider.type) {
        case 'minecraft:constant':
            if (!Number.isFinite(provider.value)) throw new TypeError('Invalid constant float provider');
            return Math.fround(provider.value);
        case 'minecraft:uniform': {
            const min = Math.fround(provider.min_inclusive);
            const max = Math.fround(provider.max_exclusive);
            if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) throw new RangeError('Invalid uniform float bounds');
            return Math.fround(min + Math.fround(nextFloat(random) * Math.fround(max - min)));
        }
        case 'minecraft:trapezoid': {
            const min = Math.fround(provider.min), max = Math.fround(provider.max), plateau = Math.fround(provider.plateau);
            if (![min, max, plateau].every(Number.isFinite) || max < min || plateau > max - min) throw new RangeError('Invalid trapezoid float bounds');
            const range = Math.fround(max - min);
            const half = Math.fround(Math.fround(range - plateau) / Math.fround(2));
            const full = Math.fround(range - half);
            const first = Math.fround(nextFloat(random) * full);
            const second = Math.fround(nextFloat(random) * half);
            return Math.fround(Math.fround(min + first) + second);
        }
        case 'minecraft:clamped_normal': {
            const mean = Math.fround(provider.mean), deviation = Math.fround(provider.deviation);
            const min = Math.fround(provider.min), max = Math.fround(provider.max);
            if (![mean, deviation, min, max].every(Number.isFinite) || max < min) throw new RangeError('Invalid clamped-normal float provider');
            if (typeof random?.nextGaussian !== 'function') throw new TypeError('Clamped-normal sampling requires random.nextGaussian()');
            const value = Math.fround(mean + Math.fround(Math.fround(random.nextGaussian()) * deviation));
            return Math.min(max, Math.max(min, value));
        }
        default: throw new Error(`Unsupported vanilla float provider: ${provider.type}`);
    }
}

export function intProviderBounds(provider) {
    if (Number.isInteger(provider)) return { min: javaInt(provider, 'constant integer provider'), max: provider };
    if (!provider || typeof provider !== 'object') throw new TypeError('Malformed integer provider bounds');
    switch (provider.type) {
        case 'minecraft:constant': return intProviderBounds(provider.value);
        case 'minecraft:uniform': case 'minecraft:biased_to_bottom': case 'minecraft:very_biased_to_bottom': case 'minecraft:clamped_normal':
            return { min: javaInt(provider.min_inclusive, 'provider minimum'), max: javaInt(provider.max_inclusive, 'provider maximum') };
        case 'minecraft:trapezoid': return { min: javaInt(provider.min, 'provider minimum'), max: javaInt(provider.max, 'provider maximum') };
        case 'minecraft:clamped': {
            const source = intProviderBounds(provider.source);
            return { min: Math.max(javaInt(provider.min_inclusive, 'clamped minimum'), source.min), max: Math.min(javaInt(provider.max_inclusive, 'clamped maximum'), source.max) };
        }
        case 'minecraft:weighted_list': {
            if (!Array.isArray(provider.distribution) || !provider.distribution.length) throw new TypeError('Weighted provider bounds need entries');
            const bounds = provider.distribution.map(entry => intProviderBounds(entry.data));
            return { min: Math.min(...bounds.map(v => v.min)), max: Math.max(...bounds.map(v => v.max)) };
        }
        default: throw new Error(`Unsupported vanilla integer provider bounds: ${provider.type}`);
    }
}

export function resolveVerticalAnchor(anchor, { minY, maxY, seaLevel } = {}) {
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor) || Object.keys(anchor).length !== 1) throw new TypeError('Malformed vertical anchor');
    const [kind, value] = Object.entries(anchor)[0];
    javaInt(value, `vertical anchor ${kind}`);
    switch (kind) {
        case 'absolute': return value;
        case 'above_bottom': return (javaInt(minY, 'world minY') + value) | 0;
        case 'below_top': return (javaInt(maxY, 'world maxY') - 1 - value) | 0;
        case 'above_sea_level': return (javaInt(seaLevel, 'sea level') + value) | 0;
        case 'below_sea_level': return (javaInt(seaLevel, 'sea level') - value) | 0;
        case 'relative_to_sea_level': return (javaInt(seaLevel, 'sea level') + value) | 0;
        default: throw new Error(`Unsupported vanilla vertical anchor: ${kind}`);
    }
}

export function sampleHeightProvider(provider, random, context) {
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) throw new Error(`Unsupported vanilla height provider: ${provider?.type}`);
    const minY = javaInt(context?.minY, 'world minY');
    const maxY = javaInt(context?.maxY, 'world maxY');
    const seaLevel = javaInt(context?.seaLevel, 'sea level');
    if (maxY <= minY) throw new RangeError('Invalid world height');
    const min = resolveVerticalAnchor(provider.min_inclusive, { minY, maxY, seaLevel });
    const max = resolveVerticalAnchor(provider.max_inclusive, { minY, maxY, seaLevel });
    if (provider.type === 'minecraft:very_biased_to_bottom') {
        const min = resolveVerticalAnchor(provider.min_inclusive, context);
        const max = resolveVerticalAnchor(provider.max_inclusive, context);
        const inner = javaInt(provider.inner ?? 1, 'height inner');
        if (inner < 1) throw new RangeError('Height inner must be positive');
        if (max - min - inner + 1 <= 0) return min;
        const inclusive = (a, b) => a >= b ? a : a + nextInt(random, b - a + 1);
        const first = inclusive(min + inner, max);
        const second = inclusive(min, first - 1);
        return inclusive(min, second - 1 + inner);
    }
    if (provider.type === 'minecraft:biased_to_bottom') {
        const inner = javaInt(provider.inner ?? 1, 'biased height inner');
        if (inner < 1) throw new RangeError('Biased height inner must be positive');
        const bound = (max - min - inner + 1) | 0;
        if (bound <= 0) return min;
        const first = nextInt(random, bound);
        return (min + nextInt(random, (first + inner) | 0)) | 0;
    }
    if (provider.type === 'minecraft:uniform') return min > max ? min : intBetween(random, min, max);
    if (provider.type === 'minecraft:trapezoid') {
        const plateau = javaInt(provider.plateau ?? 0, 'height trapezoid plateau');
        if (min > max) return min;
        const range = max - min;
        if (plateau < 0 || plateau > range) throw new RangeError('Height trapezoid plateau is outside its range');
        if (plateau >= range) return min + intBetween(random, 0, range);
        const lower = ((range - plateau) / 2) | 0;
        const upper = range - lower;
        return min + intBetween(random, 0, upper) + intBetween(random, 0, lower);
    }
    throw new Error(`Unsupported vanilla height provider: ${provider.type}`);
}
