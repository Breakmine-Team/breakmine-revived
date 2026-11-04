const MASK_48 = (1n << 48n) - 1n;
const MULTIPLIER = 0x5deece66dn;
const ADDEND = 0xbn;
const GRADIENTS = [
    [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
    [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
    [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1]
];
const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;

function legacyRandom(seed) {
    let state = (BigInt(seed) ^ MULTIPLIER) & MASK_48;
    const next = bits => {
        state = (state * MULTIPLIER + ADDEND) & MASK_48;
        return Number(state >> BigInt(48 - bits));
    };
    return {
        nextDouble() { return Number((BigInt(next(26)) << 27n) + BigInt(next(27))) / 9007199254740992; },
        nextInt(bound) {
            const mask = bound - 1;
            if ((bound & mask) === 0) return Math.floor((bound * next(31)) / 2147483648);
            let bits, value;
            do {
                bits = next(31);
                value = bits % bound;
            } while (((bits - value + mask) | 0) < 0);
            return value;
        }
    };
}

function simplexFromRandom(random) {
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
        const corner = (g, a, b) => {
            let attenuation = 0.5 - a * a - b * b;
            if (attenuation < 0) return 0;
            attenuation *= attenuation;
            return attenuation * attenuation * (GRADIENTS[g][0] * a + GRADIENTS[g][1] * b);
        };
        return Math.fround(70 * (corner(g0, x0, y0) + corner(g1, x1, y1) + corner(g2, x2, y2)));
    };
}

const temperatureNoise = simplexFromRandom(legacyRandom(1234n));
const frozenRandom = legacyRandom(3456n);
const frozenLayers = [
    [simplexFromRandom(frozenRandom), 1, Math.fround(1 / 7)],
    [simplexFromRandom(frozenRandom), Math.fround(0.5), Math.fround(2 / 7)],
    [simplexFromRandom(frozenRandom), Math.fround(0.25), Math.fround(4 / 7)]
];
const frozenTemperatureNoise = (x, z) => {
    let value = 0;
    for (const [noise, amplitude, frequency] of frozenLayers) {
        value = Math.fround(value + Math.fround(amplitude * noise(x * frequency, z * frequency)));
    }
    return value;
};
export const biomeInfoNoise = simplexFromRandom(legacyRandom(2345n));

function biomeData(data, id) {
    if (typeof id !== 'string' || !id.startsWith('minecraft:')) throw new TypeError(`Invalid biome id: ${id}`);
    const biome = data[`data/minecraft/worldgen/biome/${id.slice(10)}.json`];
    if (!biome || !Number.isFinite(biome.temperature)) throw new Error(`Missing biome temperature data: ${id}`);
    return biome;
}

export function createBiomeTemperatureSampler(data) {
    return {
        temperature(biomeId, x, y, z, seaLevel) {
            const biome = biomeData(data, biomeId);
            if (![x, y, z, seaLevel].every(Number.isInteger)) throw new TypeError('Biome temperature coordinates and sea level must be integers');
            let temperature = Math.fround(biome.temperature);
            if (biome.temperature_modifier === 'frozen') {
                const frozen = Math.fround(frozenTemperatureNoise(x * 0.05, z * 0.05) * 7) + biomeInfoNoise(x * 0.2, z * 0.2);
                if (frozen < 0.3 && biomeInfoNoise(x * 0.09, z * 0.09) < 0.8) temperature = Math.fround(0.2);
            } else if (biome.temperature_modifier !== undefined && biome.temperature_modifier !== 'none') {
                throw new Error(`Unsupported biome temperature modifier: ${biome.temperature_modifier}`);
            }
            const heightThreshold = (seaLevel + 17) | 0;
            if (y > heightThreshold) {
                const noiseX = Math.fround(Math.fround(x) / Math.fround(8));
                const noiseZ = Math.fround(Math.fround(z) / Math.fround(8));
                const variation = Math.fround(temperatureNoise(noiseX, noiseZ) * 8);
                const altitude = Math.fround(Math.fround(variation + Math.fround(y)) - Math.fround(heightThreshold));
                const lapse = Math.fround(Math.fround(altitude * Math.fround(0.05)) / Math.fround(40));
                temperature = Math.fround(temperature - lapse);
            }
            return temperature;
        },
        isColdAt(biomeId, x, y, z, seaLevel) {
            return this.temperature(biomeId, x, y, z, seaLevel) < Math.fround(0.15);
        }
    };
}
