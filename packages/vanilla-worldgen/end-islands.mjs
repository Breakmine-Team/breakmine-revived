const MASK_48 = (1n << 48n) - 1n;
const MULTIPLIER = 0x5deece66dn;
const ADDEND = 0xbn;
const SQRT_3 = Math.sqrt(3);
const F2 = 0.5 * (SQRT_3 - 1);
const G2 = (3 - SQRT_3) / 6;
const GRADIENTS = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];

function createLegacyRandom(seed) {
    let state = (BigInt.asIntN(64, BigInt(seed)) ^ MULTIPLIER) & MASK_48;
    const next = bits => {
        state = (state * MULTIPLIER + ADDEND) & MASK_48;
        return Number(state >> BigInt(48 - bits));
    };
    return {
        nextIntRaw() { return next(32) | 0; },
        nextDouble() { return Number((BigInt(next(26)) << 27n) + BigInt(next(27))) / 9007199254740992; },
        nextInt(bound) {
            const mask = bound - 1;
            if ((bound & mask) === 0) return Math.floor((bound * next(31)) / 2147483648);
            let bits, value;
            do { bits = next(31); value = bits % bound; }
            while (((bits - value + mask) | 0) < 0);
            return value;
        }
    };
}

function simplexFromLegacyRandom(random) {
    random.nextDouble();
    random.nextDouble();
    random.nextDouble();
    const permutation = new Uint8Array(256);
    for (let i = 0; i < 256; i++) permutation[i] = i;
    for (let i = 0; i < 256; i++) {
        const j = random.nextInt(256 - i);
        const value = permutation[i];
        permutation[i] = permutation[i + j];
        permutation[i + j] = value;
    }
    const permute = value => permutation[value & 255];
    const corner = (gradient, x, y) => {
        const attenuation = 0.5 - x * x - y * y;
        return attenuation < 0 ? 0 : attenuation ** 4 * (GRADIENTS[gradient][0] * x + GRADIENTS[gradient][1] * y);
    };
    return (x, y) => {
        const skew = (x + y) * F2;
        const i = Math.floor(x + skew), j = Math.floor(y + skew);
        const unskew = (i + j) * G2;
        const x0 = x - (i - unskew), y0 = y - (j - unskew);
        const i1 = x0 > y0 ? 1 : 0, j1 = x0 > y0 ? 0 : 1;
        const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
        const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
        const g0 = permute(i + permute(j)) % 12;
        const g1 = permute(i + i1 + permute(j + j1)) % 12;
        const g2 = permute(i + 1 + permute(j + 1)) % 12;
        return Math.fround(70 * (corner(g0, x0, y0) + corner(g1, x1, y1) + corner(g2, x2, y2)));
    };
}

function int32(value, name) {
    if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new RangeError(`${name} must be a Java int`);
    return value;
}

export function createEndIslandSampler(seed) {
    if (typeof seed === 'number' && !Number.isSafeInteger(seed)) throw new RangeError('Use a string or bigint for 64-bit seeds');
    if (typeof seed === 'string' && !/^-?\d+$/.test(seed)) throw new TypeError('Expected a signed decimal seed');
    if (!['string', 'number', 'bigint'].includes(typeof seed)) throw new TypeError('Expected a signed decimal seed');
    const numericSeed = BigInt(seed);
    if (numericSeed < -(1n << 63n) || numericSeed > (1n << 63n) - 1n) throw new RangeError('Seed is outside signed 64-bit range');

    const random = createLegacyRandom(numericSeed);
    for (let i = 0; i < 17292; i++) random.nextIntRaw();
    const noise = simplexFromLegacyRandom(random);

    function heightValue(x, z) {
        int32(x, 'x'); int32(z, 'z');
        const centerX = Math.trunc(x / 2), centerZ = Math.trunc(z / 2);
        const oddX = x % 2, oddZ = z % 2;
        let best = Math.fround(-100);
        for (let islandX = -12; islandX <= 12; islandX++) {
            for (let islandZ = -12; islandZ <= 12; islandZ++) {
                const candidateX = centerX + islandX, candidateZ = centerZ + islandZ;
                if (candidateX * candidateX + candidateZ * candidateZ <= 4096 || noise(candidateX, candidateZ) >= -0.9) continue;
                let radius = Math.fround(Math.fround(Math.fround(Math.abs(candidateX)) * 3439) + Math.fround(Math.fround(Math.abs(candidateZ)) * 147));
                radius = Math.fround(Math.fround(radius % 13) + 9);
                const dx = Math.fround(oddX - islandX * 2), dz = Math.fround(oddZ - islandZ * 2);
                const distance = Math.fround(Math.sqrt(Math.fround(Math.fround(dx * dx) + Math.fround(dz * dz))));
                let height = Math.fround(100 - Math.fround(distance * radius));
                height = Math.max(-100, Math.min(80, height));
                best = Math.max(best, height);
            }
        }
        return best;
    }

    const outerIslands = (x, _y, z) => {
        int32(x, 'x'); int32(z, 'z');
        return Math.fround(Math.fround(heightValue(Math.trunc(x / 8), Math.trunc(z / 8)) - 8) / 128);
    };

    return { heightValue, outerIslands };
}
