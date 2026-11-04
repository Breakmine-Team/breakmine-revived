import { sampleFloatProvider, sampleHeightProvider, sampleIntProvider } from './value-providers.mjs';

function javaInt(value, name) {
    if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) throw new TypeError(`${name} must be a Java int`);
    return value;
}

const LEGACY_MULTIPLIER = 0x5deece66dn;
const LEGACY_ADDEND = 0xbn;
const LEGACY_MASK = (1n << 48n) - 1n;
const SIN_TABLE = new Float32Array(65536);
for (let index = 0; index < SIN_TABLE.length; index++) SIN_TABLE[index] = Math.fround(Math.sin(index / 10430.378350470453));

class ThreadLocalLegacyRandom {
    constructor(seed) { this.setSeed(seed); }
    setSeed(seed) { this.state = (BigInt.asUintN(64, BigInt(seed)) ^ LEGACY_MULTIPLIER) & LEGACY_MASK; }
    next(bits) {
        this.state = (this.state * LEGACY_MULTIPLIER + LEGACY_ADDEND) & LEGACY_MASK;
        return Number(this.state >> BigInt(48 - bits));
    }
    nextInt(bound) {
        javaInt(bound, 'random bound');
        if (bound <= 0) throw new RangeError('Random bound must be positive');
        if ((bound & -bound) === bound) return Number((BigInt(bound) * BigInt(this.next(31))) >> 31n);
        for (;;) {
            const bits = this.next(31), value = bits % bound;
            if (bits - value + bound - 1 < 0x80000000) return value;
        }
    }
    nextFloat() { return Math.fround(this.next(24) / 0x1000000); }
    nextLong() {
        const high = BigInt.asIntN(32, BigInt(this.next(32)));
        const low = BigInt.asIntN(32, BigInt(this.next(32)));
        return BigInt.asIntN(64, (high << 32n) + low);
    }
}

export function largeFeatureRandom(worldSeed, chunkX, chunkZ, featureIndex) {
    const seed = BigInt.asIntN(64, BigInt(worldSeed) + BigInt(featureIndex));
    const random = new ThreadLocalLegacyRandom(seed);
    const xMultiplier = random.nextLong();
    const zMultiplier = random.nextLong();
    const featureSeed = BigInt.asIntN(64,
        (BigInt(chunkX) * xMultiplier) ^ (BigInt(chunkZ) * zMultiplier) ^ seed);
    random.setSeed(featureSeed);
    return random;
}

function mthSin(value, floatArgument = false) {
    const scaled = value * 10430.378350470453;
    return SIN_TABLE[Math.trunc(scaled) & 0xffff];
}

function mthCos(value) {
    return SIN_TABLE[(Math.trunc(value * 10430.378350470453) + 16384) & 0xffff];
}

function mthCosDouble(value) {
    return SIN_TABLE[(Math.trunc(value * 10430.378350470453) + 16384) & 0xffff];
}

function canReach(chunk, x, z, step, endStep, thickness) {
    const dx = x - (chunk.chunkX * 16 + 8);
    const dz = z - (chunk.chunkZ * 16 + 8);
    const remaining = endStep - step;
    const reach = Math.fround(Math.fround(thickness + 2) + 16);
    return dx * dx + dz * dz - remaining * remaining <= reach * reach;
}

function checkTunnelParameters({ seed, x, y, z, horizontalRadius, verticalRadius, thickness, yaw, pitch, startStep, endStep, verticalScale, floorLevel, carve }) {
    if (typeof seed !== 'bigint' && !Number.isSafeInteger(seed) && typeof seed !== 'string') throw new TypeError('Tunnel seed must be a signed 64-bit integer');
    let parsedSeed;
    try { parsedSeed = BigInt(seed); } catch { throw new TypeError('Tunnel seed must be a signed 64-bit integer'); }
    if (parsedSeed < -(1n << 63n) || parsedSeed > (1n << 63n) - 1n) throw new RangeError('Tunnel seed is outside signed 64-bit range');
    if (![x, y, z, horizontalRadius, verticalRadius, thickness, yaw, pitch, verticalScale, floorLevel].every(Number.isFinite)) throw new TypeError('Tunnel parameters must be finite');
    if (horizontalRadius <= 0 || verticalRadius <= 0 || thickness < 0 || verticalScale <= 0) throw new RangeError('Tunnel radii and scale must be positive, and thickness cannot be negative');
    javaInt(startStep, 'startStep'); javaInt(endStep, 'endStep');
    if (startStep < 0 || endStep < Math.max(startStep, 2) || endStep > 100000) throw new RangeError('Invalid tunnel step interval');
    if (typeof carve !== 'function') throw new TypeError('Expected a carve callback');
    return parsedSeed;
}

function nextFloat(random) {
    if (typeof random?.nextFloat !== 'function') throw new TypeError('Carver sampling requires random.nextFloat()');
    const value = random.nextFloat();
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new RangeError('random.nextFloat() must return [0, 1)');
    return Math.fround(value);
}

function nextLong(random) {
    if (typeof random?.nextLong !== 'function') throw new TypeError('Carver sampling requires random.nextLong()');
    return BigInt.asIntN(64, BigInt(random.nextLong()));
}

function caveFloorChecker(floorLevel) {
    return (normalizedX, normalizedY, normalizedZ) => normalizedY <= floorLevel || normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ >= 1;
}

function carveCaveRoom(chunk, x, y, z, roomRadius, roomVerticalMultiplier, floorLevel, carve) {
    const radius = 1.5 + Math.fround(mthSin(1.5707963705062866) * Math.fround(roomRadius));
    return carveEllipsoid(chunk, {
        x, y: y + 1, z,
        radiusX: radius, radiusY: radius * roomVerticalMultiplier, radiusZ: radius,
        shouldSkip: caveFloorChecker(floorLevel), carve
    });
}

function caveThickness(config, random) {
    let thickness = sampleFloatProvider(config.thickness, random);
    if (config.weird_thickness_bias && random.nextInt(10) === 0) {
        const scale = Math.fround(Math.fround(Math.fround(nextFloat(random) * nextFloat(random)) * Math.fround(3)) + Math.fround(1));
        thickness = Math.fround(thickness * scale);
    }
    return thickness;
}

export function isCarverStartChunk(config, random) {
    if (!config || !['minecraft:cave', 'minecraft:canyon'].includes(config.type) || !Number.isFinite(config.probability) || config.probability < 0 || config.probability > 1) throw new TypeError('Expected a valid vanilla cave or canyon configuration');
    return nextFloat(random) <= Math.fround(config.probability);
}

export function carveConfiguredCave(chunk, originChunk, context, random, config, carve) {
    if (!config || config.type !== 'minecraft:cave') throw new Error(`Unsupported configured carver: ${config?.type}`);
    if (!originChunk || !Number.isInteger(originChunk.chunkX) || !Number.isInteger(originChunk.chunkZ)) throw new TypeError('Expected an origin chunk position');
    if (typeof random?.nextInt !== 'function') throw new TypeError('Carver sampling requires random.nextInt(bound)');
    if (typeof carve !== 'function') throw new TypeError('Expected a carve callback');
    const maxStep = 112;
    const attemptCount = sampleIntProvider(config.count, random);
    let carved = 0;
    for (let attempt = 0; attempt < attemptCount; attempt++) {
        const x = originChunk.chunkX * 16 + random.nextInt(16);
        const y = sampleHeightProvider(config.y, random, context);
        const z = originChunk.chunkZ * 16 + random.nextInt(16);
        const horizontalRadius = sampleFloatProvider(config.horizontal_radius_multiplier ?? 1, random);
        const verticalRadius = sampleFloatProvider(config.vertical_radius_multiplier ?? 1, random);
        const startVerticalRadius = sampleFloatProvider(config.start_vertical_radius_multiplier ?? 1, random);
        const floorLevel = sampleFloatProvider(config.floor_level ?? 0, random);
        const skip = caveFloorChecker(floorLevel);
        let tunnelCount = 1;

        if (random.nextInt(4) === 0) {
            const roomVertical = sampleFloatProvider(config.room_vertical_radius_multiplier ?? 1, random);
            const roomRadius = Math.fround(Math.fround(1) + Math.fround(nextFloat(random) * Math.fround(6)));
            carved += carveCaveRoom(chunk, x, y, z, roomRadius, roomVertical, floorLevel, carve);
            tunnelCount += random.nextInt(4);
        }

        for (let tunnel = 0; tunnel < tunnelCount; tunnel++) {
            const yaw = Math.fround(nextFloat(random) * Math.fround(6.2831855));
            const pitch = Math.fround(Math.fround(nextFloat(random) - Math.fround(0.5)) / Math.fround(4));
            const thickness = caveThickness(config, random);
            const endStep = maxStep - random.nextInt(maxStep / 4);
            carved += carveCaveTunnel(chunk, {
                seed: nextLong(random), x, y, z, horizontalRadius, verticalRadius,
                thickness, yaw, pitch, startStep: 0, endStep,
                verticalScale: startVerticalRadius, floorLevel, carve
            });
        }
    }
    return carved;
}

function initCanyonWidthFactors(random, context, smoothness) {
    const height = context.maxY - context.minY;
    javaInt(height, 'generation height');
    javaInt(smoothness, 'canyon width smoothness');
    if (height <= 0 || smoothness <= 0) throw new RangeError('Invalid canyon width-factor dimensions');
    const factors = new Float32Array(height);
    let factor = Math.fround(1);
    for (let y = 0; y < height; y++) {
        if (y === 0 || random.nextInt(smoothness) === 0) {
            factor = Math.fround(Math.fround(1) + Math.fround(nextFloat(random) * nextFloat(random)));
        }
        factors[y] = Math.fround(factor * factor);
    }
    return factors;
}

function carveCanyonTunnel(chunk, context, seed, x, y, z, thickness, yaw, verticalRotation, startStep, endStep, yScale, shape, carve) {
    const random = new ThreadLocalLegacyRandom(seed);
    const widthFactors = initCanyonWidthFactors(random, context, shape.width_smoothness);
    let yawDrift = Math.fround(0), rotationDrift = Math.fround(0);
    let centerX = x, centerY = y, centerZ = z;
    let currentYaw = Math.fround(yaw), currentRotation = Math.fround(verticalRotation);
    let carved = 0;

    for (let step = startStep; step < endStep; step++) {
        const progress = Math.fround(Math.fround(Math.fround(Math.fround(Math.PI)) * Math.fround(step)) / Math.fround(endStep));
        const baseRadius = 1.5 + Math.fround(mthSin(progress) * Math.fround(thickness));
        const verticalBase = baseRadius * yScale;
        const horizontalRadius = baseRadius * sampleFloatProvider(shape.horizontal_radius_factor, random);
        const distanceFromCenter = Math.fround(Math.fround(0.5) - Math.fround(Math.fround(step) / Math.fround(endStep)));
        const centerShape = Math.fround(Math.fround(1) - Math.fround(Math.fround(Math.abs(distanceFromCenter)) * Math.fround(2)));
        const verticalShape = Math.fround(Math.fround(shape.vertical_radius_default_factor) + Math.fround(Math.fround(shape.vertical_radius_center_factor) * centerShape));
        const randomVerticalScale = Math.fround(Math.fround(0.75) + Math.fround(nextFloat(random) * Math.fround(0.25)));
        const verticalRadius = verticalShape * verticalBase * randomVerticalScale;
        const cosRotation = mthCosDouble(currentRotation);
        const sinRotation = mthSin(currentRotation);
        centerX += Math.fround(mthCos(currentYaw) * cosRotation);
        centerY += sinRotation;
        centerZ += Math.fround(mthSin(currentYaw, true) * cosRotation);

        currentRotation = Math.fround(currentRotation * Math.fround(0.7));
        currentRotation = Math.fround(currentRotation + Math.fround(rotationDrift * Math.fround(0.05)));
        currentYaw = Math.fround(currentYaw + Math.fround(yawDrift * Math.fround(0.05)));
        rotationDrift = Math.fround(rotationDrift * Math.fround(0.8));
        yawDrift = Math.fround(yawDrift * Math.fround(0.5));
        const rotationNoise = Math.fround(Math.fround(random.nextFloat() - random.nextFloat()) * random.nextFloat());
        rotationDrift = Math.fround(rotationDrift + Math.fround(rotationNoise * Math.fround(2)));
        const yawNoise = Math.fround(Math.fround(random.nextFloat() - random.nextFloat()) * random.nextFloat());
        yawDrift = Math.fround(yawDrift + Math.fround(Math.fround(yawNoise * Math.fround(4))));

        if (random.nextInt(4) === 0) continue;
        if (!canReach(chunk, centerX, centerZ, step, endStep, thickness)) return carved;
        carved += carveEllipsoid(chunk, {
            x: centerX, y: centerY, z: centerZ,
            radiusX: horizontalRadius, radiusY: verticalRadius, radiusZ: horizontalRadius,
            shouldSkip: (normalizedX, normalizedY, normalizedZ, blockY) => {
                const widthFactor = widthFactors[blockY - context.minY - 1];
                return normalizedX * normalizedX + normalizedZ * normalizedZ * widthFactor + normalizedY * normalizedY / 6 >= 1;
            },
            carve
        });
    }
    return carved;
}

export function carveConfiguredCanyon(chunk, originChunk, context, random, config, carve) {
    if (!config || config.type !== 'minecraft:canyon') throw new Error(`Unsupported configured carver: ${config?.type}`);
    if (!originChunk || !Number.isInteger(originChunk.chunkX) || !Number.isInteger(originChunk.chunkZ)) throw new TypeError('Expected an origin chunk position');
    if (typeof random?.nextInt !== 'function') throw new TypeError('Carver sampling requires random.nextInt(bound)');
    if (typeof carve !== 'function') throw new TypeError('Expected a carve callback');
    const shape = config.shape;
    if (!shape || !Number.isInteger(shape.width_smoothness) || shape.width_smoothness <= 0) throw new TypeError('Malformed canyon shape configuration');
    const maxStep = 112;
    const x = originChunk.chunkX * 16 + random.nextInt(16);
    const y = sampleHeightProvider(config.y, random, context);
    const z = originChunk.chunkZ * 16 + random.nextInt(16);
    const yaw = Math.fround(nextFloat(random) * Math.fround(6.2831855));
    const verticalRotation = sampleFloatProvider(config.vertical_rotation, random);
    const yScale = sampleFloatProvider(shape.y_scale, random);
    const thickness = sampleFloatProvider(shape.thickness, random);
    const endStep = Math.trunc(Math.fround(Math.fround(maxStep) * sampleFloatProvider(shape.distance_factor, random)));
    return carveCanyonTunnel(chunk, context, nextLong(random), x, y, z, thickness, yaw, verticalRotation, 0, endStep, yScale, shape, carve);
}

export function carveBiomeCarvers(chunk, { seed, context, biomeAtQuart, carversForBiome, carverConfigs, carve }) {
    if (typeof biomeAtQuart !== 'function' || typeof carversForBiome !== 'function') throw new TypeError('Carver scheduling requires biome and biome-carver resolvers');
    if (typeof carve !== 'function') throw new TypeError('Expected a carve callback');
    const worldSeed = BigInt(seed);
    if (worldSeed < -(1n << 63n) || worldSeed > (1n << 63n) - 1n) throw new RangeError('World seed is outside signed 64-bit range');
    const resolveConfig = id => carverConfigs instanceof Map ? carverConfigs.get(id) : carverConfigs?.[id];
    let starts = 0, carved = 0;
    for (let offsetX = -8; offsetX <= 8; offsetX++) {
        for (let offsetZ = -8; offsetZ <= 8; offsetZ++) {
            const originChunk = { chunkX: chunk.chunkX + offsetX, chunkZ: chunk.chunkZ + offsetZ };
            const biome = biomeAtQuart(originChunk.chunkX * 4, 0, originChunk.chunkZ * 4);
            const carverIds = carversForBiome(biome);
            if (!Array.isArray(carverIds)) throw new TypeError(`Biome ${biome} did not resolve to an ordered carver list`);
            for (let index = 0; index < carverIds.length; index++) {
                const id = carverIds[index];
                const config = resolveConfig(id);
                if (!config) throw new Error(`Missing vanilla carver configuration: ${id}`);
                const random = largeFeatureRandom(worldSeed, originChunk.chunkX, originChunk.chunkZ, index);
                if (!isCarverStartChunk(config, random)) continue;
                starts++;
                if (config.type === 'minecraft:cave') {
                    carved += carveConfiguredCave(chunk, originChunk, context, random, config, carve);
                } else if (config.type === 'minecraft:canyon') {
                    carved += carveConfiguredCanyon(chunk, originChunk, context, random, config, carve);
                } else {
                    throw new Error(`Unsupported vanilla carver type ${config.type} (${id})`);
                }
            }
        }
    }
    return { starts, carved };
}

export function carveCaveTunnel(chunk, parameters) {
    if (!chunk || !Number.isInteger(chunk.chunkX) || !Number.isInteger(chunk.chunkZ)) throw new TypeError('Expected a chunk with integer chunk coordinates');
    const seed = checkTunnelParameters(parameters);
    const { x, y, z, horizontalRadius, verticalRadius, thickness, yaw, pitch, startStep, endStep, verticalScale, floorLevel, carve } = parameters;
    const random = new ThreadLocalLegacyRandom(seed);
    const splitAt = random.nextInt(Math.floor(endStep / 2)) + Math.floor(endStep / 4);
    const gentle = random.nextInt(6) === 0;
    let yawDrift = Math.fround(0), pitchDrift = Math.fround(0);
    let centerX = x, centerY = y, centerZ = z;
    let currentYaw = Math.fround(yaw), currentPitch = Math.fround(pitch);
    let carved = 0;

    for (let step = startStep; step < endStep; step++) {
        const progress = Math.fround(Math.fround(Math.fround(Math.fround(Math.PI)) * Math.fround(step)) / Math.fround(endStep));
        const radius = 1.5 + Math.fround(mthSin(progress) * Math.fround(thickness));
        const radiusY = radius * verticalScale;
        const cosPitch = mthCos(currentPitch);
        centerX += Math.fround(mthCos(currentYaw) * cosPitch);
        centerY += mthSin(currentPitch, true);
        centerZ += Math.fround(mthSin(currentYaw, true) * cosPitch);

        currentPitch = Math.fround(currentPitch * (gentle ? Math.fround(0.92) : Math.fround(0.7)));
        currentPitch = Math.fround(currentPitch + Math.fround(pitchDrift * Math.fround(0.1)));
        currentYaw = Math.fround(currentYaw + Math.fround(yawDrift * Math.fround(0.1)));
        pitchDrift = Math.fround(pitchDrift * Math.fround(0.9));
        yawDrift = Math.fround(yawDrift * Math.fround(0.75));
        const pitchNoise = Math.fround(Math.fround(random.nextFloat() - random.nextFloat()) * random.nextFloat());
        pitchDrift = Math.fround(pitchDrift + Math.fround(pitchNoise * Math.fround(2)));
        const yawNoise = Math.fround(Math.fround(random.nextFloat() - random.nextFloat()) * random.nextFloat());
        yawDrift = Math.fround(yawDrift + Math.fround(yawNoise * Math.fround(4)));

        if (step === splitAt && thickness > 1) {
            for (const direction of [-1, 1]) {
                const branchSeed = random.nextLong();
                const branchThickness = Math.fround(Math.fround(random.nextFloat() * Math.fround(0.5)) + Math.fround(0.5));
                carved += carveCaveTunnel(chunk, {
                    seed: branchSeed, x: centerX, y: centerY, z: centerZ,
                    horizontalRadius, verticalRadius, thickness: branchThickness,
                    yaw: Math.fround(currentYaw + Math.fround(direction * Math.fround(1.5707964))),
                    pitch: Math.fround(currentPitch / Math.fround(3)), startStep: step, endStep,
                    verticalScale: 1, floorLevel, carve
                });
            }
            return carved;
        }

        if (random.nextInt(4) === 0) continue;
        if (!canReach(chunk, centerX, centerZ, step, endStep, thickness)) return carved;
        carved += carveEllipsoid(chunk, {
            x: centerX, y: centerY, z: centerZ,
            radiusX: radius * horizontalRadius, radiusY: radiusY * verticalRadius, radiusZ: radius * horizontalRadius,
            shouldSkip: caveFloorChecker(floorLevel),
            carve
        });
    }
    return carved;
}

export function carveEllipsoid(chunk, { x, y, z, radiusX, radiusY, radiusZ, shouldSkip = () => false, carve }) {
    if (!chunk || !Number.isInteger(chunk.chunkX) || !Number.isInteger(chunk.chunkZ)) throw new TypeError('Expected a chunk with integer chunk coordinates');
    javaInt(chunk.chunkX, 'chunkX'); javaInt(chunk.chunkZ, 'chunkZ');
    javaInt(chunk.minY, 'minY'); javaInt(chunk.minY + chunk.height, 'maxY');
    if (![x, y, z, radiusX, radiusY, radiusZ].every(Number.isFinite) || radiusX <= 0 || radiusY <= 0 || radiusZ <= 0) throw new RangeError('Ellipsoid coordinates and radii must be finite and positive');
    if (typeof shouldSkip !== 'function' || typeof carve !== 'function') throw new TypeError('Expected carver callbacks');

    const minX = chunk.chunkX * 16, minZ = chunk.chunkZ * 16;
    const maxY = chunk.minY + chunk.height - (chunk.maxYInclusive ? 0 : 1);
    if (Math.abs(x - (minX + 8)) > 16 + radiusX * 2 || Math.abs(z - (minZ + 8)) > 16 + radiusX * 2) return 0;

    const x0 = Math.max(Math.floor(x - radiusX) - minX - 1, 0);
    const x1 = Math.min(Math.floor(x + radiusX) - minX, 15);
    const y0 = Math.max(Math.floor(y - radiusY) - 1, chunk.minY);
    const y1 = Math.min(Math.floor(y + radiusY) + 1, maxY);
    const z0 = Math.max(Math.floor(z - radiusZ) - minZ - 1, 0);
    const z1 = Math.min(Math.floor(z + radiusZ) - minZ, 15);
    let carved = 0;

    for (let localX = x0; localX <= x1; localX++) {
        const normalizedX = (minX + localX + 0.5 - x) / radiusX;
        for (let localZ = z0; localZ <= z1; localZ++) {
            const normalizedZ = (minZ + localZ + 0.5 - z) / radiusZ;
            if (normalizedX * normalizedX + normalizedZ * normalizedZ >= 1) continue;
            for (let blockY = y1; blockY > y0; blockY--) {
                const normalizedY = (blockY - 0.5 - y) / radiusY;
                const normSquared = normalizedX * normalizedX + normalizedY * normalizedY + normalizedZ * normalizedZ;
                if (normSquared < 1 && !shouldSkip(normalizedX, normalizedY, normalizedZ, blockY)) {
                    carve(localX, blockY, localZ);
                    carved++;
                }
            }
        }
    }
    return carved;
}
