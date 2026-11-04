export function worldSeed(value) {
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new TypeError('World seed must be an exact integer');
    if (!['string', 'bigint', 'number'].includes(typeof value) || typeof value === 'string' && !/^-?\d+$/.test(value)) throw new TypeError('Expected context.seed for vanilla world generation');
    return BigInt.asIntN(64, BigInt(value));
}

export function createJavaLegacyRandom(seed) {
    const mask = (1n << 48n) - 1n;
    let state = (worldSeed(seed) ^ 0x5deece66dn) & mask;
    const next = bits => {
        state = (state * 0x5deece66dn + 11n) & mask;
        return Number(state >> BigInt(48 - bits));
    };
    return {
        nextInt(bound) {
            if (!Number.isInteger(bound) || bound < 1 || bound > 0x7fffffff) throw new RangeError('Invalid Java random bound');
            if ((bound & -bound) === bound) return Number(BigInt(bound) * BigInt(next(31)) >> 31n);
            let bits, value;
            do { bits = next(31); value = bits % bound; } while ((bits - value + bound - 1 | 0) < 0);
            return value;
        },
        nextLong: () => BigInt.asIntN(64, (BigInt(next(32) | 0) << 32n) + BigInt(next(32) | 0)),
        nextFloat: () => next(24) / 16777216,
        nextDouble: () => (next(26) * 134217728 + next(27)) / 9007199254740992
    };
}

export function shuffled(values, random) {
    const result = [...values];
    for (let size = result.length; size > 1; size--) {
        const index = random.nextInt(size);
        [result[size - 1], result[index]] = [result[index], result[size - 1]];
    }
    return result;
}
