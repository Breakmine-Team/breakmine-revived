const LONG_MASK = (1n << 64n) - 1n;
const LCG_MULTIPLIER = 6364136223846793005n;
const LCG_INCREMENT = 1442695040888963407n;
const worldCaches = new WeakMap();

function getWorldCache(world) {
    let cache = worldCaches.get(world);
    if (!cache) worldCaches.set(world, cache = { colors: new Map(), biomes: new Map() });
    return cache;
}

export function clearVanillaBiomeTintCache(world) {
    const cache = world && worldCaches.get(world);
    cache?.colors.clear();
    cache?.biomes.clear();
}

function trimCache(cache) {
    if (cache.size < 65536) return;
    const remove = Math.ceil(cache.size / 4);
    for (let index = 0; index < remove; index++) cache.delete(cache.keys().next().value);
}

function floorMod(value, divisor) {
    const remainder = value % divisor;
    return remainder < 0n ? remainder + divisor : remainder;
}

function nextRandom(value, addend) {
    return (value * (value * LCG_MULTIPLIER + LCG_INCREMENT) + addend) & LONG_MASK;
}

function fiddle(value) {
    const signed = BigInt.asIntN(64, value);
    return (Number(floorMod(signed >> 24n, 1024n)) / 1024 - 0.5) * 0.9;
}

function fiddledDistance(seed, x, y, z, dx, dy, dz) {
    let value = seed;
    value = nextRandom(value, BigInt(x));
    value = nextRandom(value, BigInt(y));
    value = nextRandom(value, BigInt(z));
    value = nextRandom(value, BigInt(x));
    value = nextRandom(value, BigInt(y));
    value = nextRandom(value, BigInt(z));
    const fiddleX = fiddle(value);
    value = nextRandom(value, seed);
    const fiddleY = fiddle(value);
    value = nextRandom(value, seed);
    const fiddleZ = fiddle(value);
    return (dz + fiddleZ) ** 2 + (dy + fiddleY) ** 2 + (dx + fiddleX) ** 2;
}

export async function obfuscateBiomeZoomSeed(seed) {
    const cryptoApi = globalThis.crypto;
    if (!cryptoApi?.subtle) throw new Error('Web Crypto is required to prepare the vanilla biome zoom seed');
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigInt64(0, BigInt(seed), true);
    const digest = await cryptoApi.subtle.digest('SHA-256', bytes);
    return BigInt.asIntN(64, new DataView(digest).getBigInt64(0, true));
}

export function vanillaBiomeAtBlock(world, x, y, z) {
    if (typeof world?.biomeZoomSeed !== 'bigint' || ![x, y, z].every(Number.isSafeInteger)) return null;
    const { biomes } = getWorldCache(world);
    const cacheKey = `${x},${y},${z}`;
    if (biomes.has(cacheKey)) return biomes.get(cacheKey);
    const absoluteX = x - 2, absoluteY = y - 2, absoluteZ = z - 2;
    const parentX = absoluteX >> 2, parentY = absoluteY >> 2, parentZ = absoluteZ >> 2;
    const fractionX = (absoluteX & 3) / 4, fractionY = (absoluteY & 3) / 4, fractionZ = (absoluteZ & 3) / 4;
    let best = Infinity, biome = null;
    for (let corner = 0; corner < 8; corner++) {
        const xEven = (corner & 4) === 0, yEven = (corner & 2) === 0, zEven = (corner & 1) === 0;
        const cornerX = parentX + (xEven ? 0 : 1);
        const cornerY = parentY + (yEven ? 0 : 1);
        const cornerZ = parentZ + (zEven ? 0 : 1);
        const distance = fiddledDistance(world.biomeZoomSeed, cornerX, cornerY, cornerZ,
            xEven ? fractionX : fractionX - 1, yEven ? fractionY : fractionY - 1, zEven ? fractionZ : fractionZ - 1);
        if (best > distance) {
            best = distance;
            biome = biomeAtQuart(world, cornerX, cornerY, cornerZ);
        }
    }
    trimCache(biomes);
    if (biome !== null) biomes.set(cacheKey, biome);
    return biome;
}

function biomeAtQuart(world, quartX, quartY, quartZ) {
    const chunkX = Math.floor(quartX / 4), chunkZ = Math.floor(quartZ / 4);
    const native = world.getChunkAt(chunkX, chunkZ)?.native;
    if (!native) return null;
    const localX = quartX - chunkX * 4, localZ = quartZ - chunkZ * 4;
    // LevelChunkSection biome containers clamp to the first/last vertical
    // section. Above-world rendering must not switch to a plains fallback.
    const localY = Math.max(0, Math.min(native.height / 4 - 1, quartY - native.minY / 4));
    return native.biomes[localY * 16 + localZ * 4 + localX] ?? null;
}

export function vanillaBlendedBiomeColor(world, x, y, z, radius, resolveColor, fallback) {
    if (!world || !Number.isSafeInteger(x) || !Number.isSafeInteger(y) || !Number.isSafeInteger(z)) return fallback;
    const blendRadius = Number.isInteger(radius) ? Math.max(0, Math.min(radius, 7)) : 2;
    const { colors: cache } = getWorldCache(world);
    const key = `${resolveColor.key}:${blendRadius}:${x},${y},${z}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    const sampleColor = (sampleX, sampleY, sampleZ) => {
        const biomeId = vanillaBiomeAtBlock(world, sampleX, sampleY, sampleZ);
        return biomeId === null ? null : resolveColor(biomeId, sampleX, sampleZ);
    };
    let color;
    if (blendRadius === 0) {
        color = sampleColor(x, y, z) ?? fallback;
    } else {
        const count = (blendRadius * 2 + 1) ** 2;
        let red = 0, green = 0, blue = 0;
        for (let sampleX = x - blendRadius; sampleX <= x + blendRadius; sampleX++) {
            for (let sampleZ = z - blendRadius; sampleZ <= z + blendRadius; sampleZ++) {
                const sample = sampleColor(sampleX, y, sampleZ) ?? sampleColor(x, y, z) ?? fallback;
                red += sample >> 16 & 255;
                green += sample >> 8 & 255;
                blue += sample & 255;
            }
        }
        color = Math.floor(red / count) << 16 | Math.floor(green / count) << 8 | Math.floor(blue / count);
    }
    trimCache(cache);
    cache.set(key, color);
    return color;
}
