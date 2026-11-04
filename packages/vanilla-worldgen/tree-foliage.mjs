import { sampleIntProvider } from './value-providers.mjs';

const BLOB = 'minecraft:blob_foliage_placer';
const ACACIA = 'minecraft:acacia_foliage_placer';
const BUSH = 'minecraft:bush_foliage_placer';
const DARK_OAK = 'minecraft:dark_oak_foliage_placer';
const FANCY = 'minecraft:fancy_foliage_placer';
const PINE = 'minecraft:pine_foliage_placer';
const RANDOM_SPREAD = 'minecraft:random_spread_foliage_placer';
const SPRUCE = 'minecraft:spruce_foliage_placer';
const JUNGLE = 'minecraft:jungle_foliage_placer';
const CHERRY = 'minecraft:cherry_foliage_placer';
const POPLAR = 'minecraft:poplar_foliage_placer';
const MEGA_PINE = 'minecraft:mega_pine_foliage_placer';

const integer = (value, name, min = 0, max = 512) => {
    if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(`Invalid ${name}`);
    return value;
};

function validatePlacer(placer, types) {
    if (!placer || !types.includes(placer.type)) throw new TypeError(`Unsupported foliage placer: ${placer?.type ?? '<missing type>'}`);
    if (!Number.isInteger(placer.radius) && (!placer.radius || typeof placer.radius !== 'object')) throw new TypeError('Foliage placer is missing radius');
    if (!Number.isInteger(placer.offset) && (!placer.offset || typeof placer.offset !== 'object')) throw new TypeError('Foliage placer is missing offset');
}

export function getFoliageHeight(placer, random, treeHeight) {
    validatePlacer(placer, [BLOB, ACACIA, BUSH, DARK_OAK, FANCY, PINE, RANDOM_SPREAD, SPRUCE, JUNGLE, CHERRY, POPLAR, MEGA_PINE]);
    switch (placer.type) {
        case ACACIA: return 0;
        case DARK_OAK: return 4;
        case JUNGLE: return integer(placer.height, 'jungle foliage height', 0, 16);
        case CHERRY: return sampleIntProvider(placer.height, random);
        case POPLAR: return sampleIntProvider(placer.height, random);
        case MEGA_PINE: return sampleIntProvider(placer.crown_height, random);
        case BLOB:
        case FANCY: return integer(placer.height, 'blob foliage height', 0, 16);
        case BUSH:
        case RANDOM_SPREAD:
        case SPRUCE:
        case PINE: return sampleIntProvider(placer.type === RANDOM_SPREAD ? placer.foliage_height : placer.type === SPRUCE ? placer.trunk_height : placer.height, random);
        default: throw new Error(`Unsupported foliage height: ${placer.type}`);
    }
}

export function sampleFoliageRadius(placer, random, foliageHeightInput) {
    validatePlacer(placer, [BLOB, ACACIA, BUSH, DARK_OAK, FANCY, PINE, RANDOM_SPREAD, SPRUCE, JUNGLE, CHERRY, POPLAR, MEGA_PINE]);
    const radius = sampleIntProvider(placer.radius, random);
    if (placer.type === PINE) return radius + random.nextInt(Math.max(1, foliageHeightInput + 1));
    return radius;
}

export function getBlobFoliageHeight(placer) {
    if (placer?.type !== BLOB) throw new TypeError('Expected a blob foliage placer');
    return integer(placer.height, 'blob foliage height', 0, 16);
}

export function sampleBlobFoliageRadius(placer, random) {
    if (placer?.type !== BLOB) throw new TypeError('Expected a blob foliage placer');
    return sampleIntProvider(placer.radius, random);
}

function foliageOffset(placer, random) {
    return sampleIntProvider(placer.offset, random);
}

function placeRow(attachment, radius, y, random, shouldSkip, canPlaceLeaf, placeLeaf, skipY = y, signed = true) {
    const extra = attachment.doubleTrunk ? 1 : 0;
    let placed = 0;
    for (let x = -radius; x <= radius + extra; x++) {
        for (let z = -radius; z <= radius + extra; z++) {
            const sx = signed ? attachment.doubleTrunk ? Math.min(Math.abs(x), Math.abs(x - 1)) : Math.abs(x) : x;
            const sz = signed ? attachment.doubleTrunk ? Math.min(Math.abs(z), Math.abs(z - 1)) : Math.abs(z) : z;
            if (shouldSkip(random, sx, skipY, sz, radius)) continue;
            const pos = { x: attachment.position.x + x, y: attachment.position.y + y, z: attachment.position.z + z };
            if (canPlaceLeaf(pos)) {
                placeLeaf(pos);
                placed++;
            }
        }
    }
    return placed;
}

function placeRows(placer, attachment, rows, random, skip, callbacks) {
    const offset = foliageOffset(placer, random);
    let count = 0;
    for (const [radius, y] of rows) count += placeRow(attachment, radius, offset + y, random, skip, callbacks.canPlaceLeaf, callbacks.placeLeaf, y);
    return count;
}

const skipPineSpruceCorner = (_random, x, _y, z, radius) => radius > 0 && x === radius && z === radius;
const skipBushCorner = (random, x, _y, z, radius) => radius > 0 && x === radius && z === radius && random.nextInt(2) === 0;

export function placeBlobFoliage(placer, attachment, foliageHeight, foliageRadius, random, callbacks = {}) {
    if (placer?.type !== BLOB) throw new TypeError('Expected a blob foliage placer');
    return placeLayeredBlob(placer, attachment, foliageHeight, foliageRadius, random, callbacks);
}

function placeLayeredBlob(placer, attachment, foliageHeight, foliageRadius, random, { canPlaceLeaf, placeLeaf } = {}) {
    for (const [name, callback] of Object.entries({ canPlaceLeaf, placeLeaf })) if (typeof callback !== 'function') throw new TypeError(`Blob foliage placement requires ${name}`);
    if (!attachment?.position || ![attachment.position.x, attachment.position.y, attachment.position.z].every(Number.isInteger)) throw new TypeError('Foliage requires an integer attachment position');
    integer(foliageHeight, 'foliage height', 0, 512);
    integer(foliageRadius, 'foliage radius', 0, 512);
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('Foliage placement requires a Java-compatible random source');
    const heightOffset = attachment.foliageHeightOffset ?? 0;
    const radiusOffset = attachment.radiusOffsetXZ ?? 0;
    if (!Number.isInteger(heightOffset) || !Number.isInteger(radiusOffset)) throw new TypeError('Invalid foliage attachment offsets');
    const offset = foliageOffset(placer, random);
    const bottom = offset - (foliageHeight + heightOffset);
    let placed = 0;
    for (let y = offset; y >= bottom; y--) {
        const radius = Math.max(0, foliageRadius + radiusOffset - 1 - Math.trunc(y / 2));
        placed += placeRow(attachment, radius, y, random,
            (rng, x, _worldY, z, rowRadius) => x === rowRadius && z === rowRadius && (rng.nextInt(2) === 0 || y === 0),
            canPlaceLeaf, placeLeaf);
    }
    return placed;
}

export function placeAcaciaFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== ACACIA) throw new TypeError('Expected an acacia foliage placer');
    const offset = attachment.foliageHeightOffset ?? 0;
    const radiusOffset = attachment.radiusOffsetXZ ?? 0;
    return placeRows(placer, attachment, [[radius + radiusOffset, -1 - offset], [radius - 1, -offset], [radius + radiusOffset - 1, 0]], random,
        (_rng, x, y, z, _radius) => y === 0
            ? (x > 1 || z > 1) && x !== 0 && z !== 0
            : x === _radius && z === _radius && _radius > 0,
        callbacks);
}

export function placeBushFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== BUSH) throw new TypeError('Expected a bush foliage placer');
    const foliageHeight = height + (attachment.foliageHeightOffset ?? 0);
    const offset = foliageOffset(placer, random);
    let count = 0;
    for (let y = offset; y >= offset - foliageHeight; y--) {
        const layerRadius = radius + (attachment.radiusOffsetXZ ?? 0) - 1 - y;
        count += placeRow(attachment, layerRadius, y, random, skipBushCorner, callbacks.canPlaceLeaf, callbacks.placeLeaf);
    }
    return count;
}

export function placeDarkOakFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== DARK_OAK) throw new TypeError('Expected a dark oak foliage placer');
    const offset = foliageOffset(placer, random);
    const doubleTrunk = Boolean(attachment.doubleTrunk);
    const rows = doubleTrunk ? [[radius + 2, -1], [radius + 3, 0], [radius + 2, 1]] : [[radius + 2, -1], [radius + 1, 0]];
    let count = 0;
    for (const [rowRadius, rowY] of rows) {
        count += placeRow(attachment, rowRadius, offset + rowY, random, (_rng, x, y, z, currentRadius) => {
            if (y === 0 && doubleTrunk) {
                const edgeX = x === -currentRadius || x >= currentRadius;
                const edgeZ = z === -currentRadius || z >= currentRadius;
                return edgeX && edgeZ;
            }
            const sx = doubleTrunk ? Math.min(Math.abs(x), Math.abs(x - 1)) : Math.abs(x);
            const sz = doubleTrunk ? Math.min(Math.abs(z), Math.abs(z - 1)) : Math.abs(z);
            if (y === -1 && !doubleTrunk) return sx === currentRadius && sz === currentRadius;
            if (y === 1) return sx + sz > currentRadius * 2 - 2;
            return false;
        }, callbacks.canPlaceLeaf, callbacks.placeLeaf, rowY, false);
    }
    if (doubleTrunk && random.nextBoolean()) {
        count += placeRow(attachment, radius + 2, offset + 2, random, () => false,
            callbacks.canPlaceLeaf, callbacks.placeLeaf, 2, false);
    }
    return count;
}

export function placeFancyFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== FANCY) throw new TypeError('Expected a fancy foliage placer');
    const offset = foliageOffset(placer, random);
    const top = offset;
    let count = 0;
    for (let y = top; y >= top - height; y--) {
        const layerRadius = radius + (y === top || y === top - height ? 0 : 1);
        count += placeRow(attachment, layerRadius, y, random,
            (_rng, x, _rowY, z) => (x + 0.5) ** 2 + (z + 0.5) ** 2 > layerRadius * layerRadius,
            callbacks.canPlaceLeaf, callbacks.placeLeaf);
    }
    return count;
}

export function placePineFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== PINE) throw new TypeError('Expected a pine foliage placer');
    const offset = foliageOffset(placer, random);
    const foliageHeight = height + (attachment.foliageHeightOffset ?? 0);
    let layerRadius = 0;
    let count = 0;
    for (let y = offset; y >= offset - foliageHeight; y--) {
        count += placeRow(attachment, layerRadius, y, random, skipPineSpruceCorner, callbacks.canPlaceLeaf, callbacks.placeLeaf);
        if (layerRadius >= 1 && y === offset - foliageHeight + 1) layerRadius--;
        else if (layerRadius < radius + (attachment.radiusOffsetXZ ?? 0)) layerRadius++;
    }
    return count;
}

export function placeSpruceFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== SPRUCE) throw new TypeError('Expected a spruce foliage placer');
    const offset = foliageOffset(placer, random);
    const foliageHeight = height + (attachment.foliageHeightOffset ?? 0);
    let layerRadius = random.nextInt(2);
    let maxRadius = 1;
    let minRadius = 0;
    let count = 0;
    for (let y = offset; y >= -foliageHeight; y--) {
        count += placeRow(attachment, layerRadius, y, random, skipPineSpruceCorner, callbacks.canPlaceLeaf, callbacks.placeLeaf);
        if (layerRadius >= maxRadius) {
            layerRadius = minRadius;
            minRadius = 1;
            maxRadius = Math.min(maxRadius + 1, radius + (attachment.radiusOffsetXZ ?? 0));
        } else {
            layerRadius++;
        }
    }
    return count;
}

export function placeRandomSpreadFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== RANDOM_SPREAD) throw new TypeError('Expected a random spread foliage placer');
    const attempts = integer(placer.leaf_placement_attempts, 'leaf placement attempts', 0, 256);
    if (radius < 1 || height < 1) throw new RangeError('Random spread foliage radius and height must be positive');
    foliageOffset(placer, random);
    let count = 0;
    for (let i = 0; i < attempts; i++) {
        const pos = {
            x: attachment.position.x + random.nextInt(radius) - random.nextInt(radius),
            y: attachment.position.y + random.nextInt(height) - random.nextInt(height),
            z: attachment.position.z + random.nextInt(radius) - random.nextInt(radius)
        };
        if (callbacks.canPlaceLeaf(pos)) {
            callbacks.placeLeaf(pos);
            count++;
        }
    }
    return count;
}

export function placeMegaJungleFoliage(placer, attachment, height, radius, random, callbacks) {
    if (placer?.type !== JUNGLE) throw new TypeError('Expected a jungle foliage placer');
    const offset = foliageOffset(placer, random);
    const foliageHeight = attachment.doubleTrunk ? height : 1 + random.nextInt(2);
    const totalHeight = foliageHeight + (attachment.foliageHeightOffset ?? 0);
    let count = 0;
    for (let y = offset; y >= offset - totalHeight; y--) {
        const layerRadius = radius + (attachment.radiusOffsetXZ ?? 0) + 1 - y;
        count += placeRow(attachment, layerRadius, y, random,
            (_rng, x, _rowY, z, r) => x + z >= 7 || x * x + z * z > r * r,
            callbacks.canPlaceLeaf, callbacks.placeLeaf);
    }
    return count;
}

export function placeCherryFoliage(placer, attachment, height, radius, random, callbacks = {}) {
    if (placer?.type !== CHERRY) throw new TypeError('Expected a cherry foliage placer');
    for (const name of ['wide_bottom_layer_hole_chance', 'corner_hole_chance', 'hanging_leaves_chance', 'hanging_leaves_extension_chance']) {
        if (!Number.isFinite(placer[name]) || placer[name] < 0 || placer[name] > 1) throw new RangeError(`Invalid cherry foliage ${name}`);
    }
    for (const name of ['canPlaceLeaf', 'placeLeaf']) if (typeof callbacks[name] !== 'function') throw new TypeError(`Cherry foliage placement requires ${name}`);
    const base = attachment.position;
    const top = { x: base.x, y: base.y + sampleIntProvider(placer.offset, random), z: base.z };
    const r = radius + (attachment.radiusOffsetXZ ?? 0) - 1;
    const h = height + (attachment.foliageHeightOffset ?? 0);
    const doubleTrunk = Boolean(attachment.doubleTrunk);
    let count = 0;
    const placed = new Set();
    const row = (rowRadius, y, wideBottom = false) => {
        const extra = doubleTrunk ? 1 : 0;
        for (let dx = -rowRadius; dx <= rowRadius + extra; dx++) {
            for (let dz = -rowRadius; dz <= rowRadius + extra; dz++) {
                const ax = doubleTrunk ? Math.min(Math.abs(dx), Math.abs(dx - 1)) : Math.abs(dx);
                const az = doubleTrunk ? Math.min(Math.abs(dz), Math.abs(dz - 1)) : Math.abs(dz);
                const corner = ax === rowRadius && az === rowRadius;
                if (wideBottom && (ax === rowRadius || az === rowRadius) && random.nextFloat() < placer.wide_bottom_layer_hole_chance) continue;
                if (corner) {
                    if (random.nextFloat() < placer.corner_hole_chance) continue;
                } else if (wideBottom && rowRadius > 2 && ax + az > rowRadius * 2 - 2
                    && random.nextFloat() < placer.corner_hole_chance) continue;
                const pos = { x: top.x + dx, y: top.y + y, z: top.z + dz };
                if (!callbacks.canPlaceLeaf(pos)) continue;
                callbacks.placeLeaf(pos);
                placed.add(`${pos.x},${pos.y},${pos.z}`);
                count++;
            }
        }
    };

    row(r - 2, h - 3);
    row(r - 1, h - 4);
    for (let y = h - 5; y >= 0; y--) row(r, y);
    row(r, -1, true);

    const directions = [
        { x: 0, z: -1, clockwise: { x: 1, z: 0 } },
        { x: 1, z: 0, clockwise: { x: 0, z: 1 } },
        { x: 0, z: 1, clockwise: { x: -1, z: 0 } },
        { x: -1, z: 0, clockwise: { x: 0, z: -1 } }
    ];
    for (let index = 0; index < directions.length; index++) {
        const direction = directions[index];
        const clockwise = direction.clockwise;
        const extra = doubleTrunk ? 1 : 0;
        let x = top.x + clockwise.x * (clockwise.x > 0 || clockwise.z > 0 ? r + extra : r) - direction.x * r;
        let z = top.z + clockwise.z * (clockwise.x > 0 || clockwise.z > 0 ? r + extra : r) - direction.z * r;
        for (let side = -r; side < r + extra; side++) {
            const start = { x, y: top.y - 2, z };
            const above = `${start.x},${start.y + 1},${start.z}`;
            const hasLeafAbove = placed.has(above) || callbacks.isLeafPlaced?.(start.x, start.y + 1, start.z);
            if (hasLeafAbove && Math.abs(start.x - top.x) + Math.abs(start.y - (top.y - 1)) + Math.abs(start.z - top.z) < 7
                && random.nextFloat() <= placer.hanging_leaves_chance && callbacks.canPlaceLeaf(start)) {
                callbacks.placeLeaf(start);
                placed.add(`${start.x},${start.y},${start.z}`);
                count++;
                const extension = { ...start, y: start.y - 1 };
                if (Math.abs(extension.x - top.x) + Math.abs(extension.y - (top.y - 1)) + Math.abs(extension.z - top.z) < 7
                    && random.nextFloat() <= placer.hanging_leaves_extension_chance && callbacks.canPlaceLeaf(extension)) {
                    callbacks.placeLeaf(extension);
                    placed.add(`${extension.x},${extension.y},${extension.z}`);
                    count++;
                }
            }
            x += direction.x;
            z += direction.z;
        }
    }
    return count;
}

export function placePoplarFoliage(placer, attachment, height, radius, random, callbacks = {}) {
    if (placer?.type !== POPLAR) throw new TypeError('Expected a poplar foliage placer');
    if (!Number.isFinite(placer.side_hole_chance) || placer.side_hole_chance < 0 || placer.side_hole_chance > 1) {
        throw new RangeError('Invalid poplar side-hole chance');
    }
    for (const name of ['canPlaceLeaf', 'placeLeaf', 'sampleFoliageState', 'getBlockState', 'replaceLeafWithLog']) {
        if (typeof callbacks[name] !== 'function') throw new TypeError(`Poplar foliage placement requires ${name}`);
    }
    const base = attachment.position;
    const top = { x: base.x, y: base.y + sampleIntProvider(placer.offset, random), z: base.z };
    const r = radius + (attachment.radiusOffsetXZ ?? 0) - 1;
    const h = height + (attachment.foliageHeightOffset ?? 0);
    const doubleTrunk = Boolean(attachment.doubleTrunk);
    const orientation = Boolean(random.nextBoolean());
    let count = 0;
    const row = (rowRadius, y, partialHeight = h, orientationFlag = orientation) => {
        const extra = doubleTrunk ? 1 : 0;
        for (let dx = -rowRadius; dx <= rowRadius + extra; dx++) {
            for (let dz = -rowRadius; dz <= rowRadius + extra; dz++) {
                if (shouldSkipPoplar(random, dx, y, dz, rowRadius, partialHeight, orientationFlag, placer.side_hole_chance)) continue;
                const pos = { x: top.x + dx, y: top.y + y, z: top.z + dz };
                if (!callbacks.canPlaceLeaf(pos)) continue;
                callbacks.placeLeaf(pos);
                count++;
            }
        }
    };

    row(r - 2, h - 1);
    row(r - 1, h - 2);
    row(r - 1, h - 3);
    for (let y = h - 4; y >= 1; y--) row(r, y);
    replacePoplarLeavesWithLogs(top, r, h - 4, doubleTrunk, orientation, random, callbacks);
    row(r - 1, 0);
    row(Math.max(1, Math.min(2, r - 2)), -1, h);
    return count;
}

export function placeMegaPineFoliage(placer, attachment, crownHeight, radius, random, callbacks = {}) {
    if (placer?.type !== MEGA_PINE) throw new TypeError('Expected a mega pine foliage placer');
    integer(crownHeight, 'mega pine crown height', 1, 512);
    const offset = foliageOffset(placer, random);
    const height = crownHeight + (attachment.foliageHeightOffset ?? 0);
    let previousRadius = 0;
    let count = 0;
    for (let y = -height + offset; y <= offset; y++) {
        const relativeHeight = -y;
        const layerRadius = radius + (attachment.radiusOffsetXZ ?? 0) + Math.floor(relativeHeight / crownHeight * 3.5);
        const rowRadius = relativeHeight > 0 && layerRadius === previousRadius && (attachment.position.y + y) % 2 === 0
            ? layerRadius + 1 : layerRadius;
        count += placeRow(attachment, rowRadius, y, random,
            (_rng, x, _rowY, z, currentRadius) => x + z >= 7 || x * x + z * z > currentRadius * currentRadius,
            callbacks.canPlaceLeaf, callbacks.placeLeaf);
        previousRadius = layerRadius;
    }
    return count;
}

function shouldSkipPoplar(random, x, y, z, radius, height, orientation, sideHoleChance) {
    const partial = height - 1 === y || height - 2 === y;
    const ax = Math.abs(x);
    const az = Math.abs(z);
    const corner = orientation
        ? (x > 0 && z > 0) || (x < 0 && z < 0)
        : (x > 0 && z < 0) || (x <= 0 && z > 0);
    const cut = corner ? radius - 1 : partial ? radius + 1 : radius;
    const edge = ax === radius || az === radius;
    if (partial && edge) return true;
    const sideHole = random.nextFloat() <= sideHoleChance ? 1 : 0;
    return ax + az > radius * 2 - cut + sideHole;
}

function replacePoplarLeavesWithLogs(top, radius, y, doubleTrunk, orientation, random, callbacks) {
    const extra = doubleTrunk ? 1 : 0;
    for (let dx = -radius; dx <= radius + extra; dx++) {
        for (let dz = -radius; dz <= radius + extra; dz++) {
            const ax = Math.abs(dx);
            const az = Math.abs(dz);
            const partial = false;
            const corner = orientation
                ? (dx > 0 && dz > 0) || (dx < 0 && dz < 0)
                : (dx > 0 && dz < 0) || (dx <= 0 && dz > 0);
            const cut = corner ? radius - 1 : partial ? radius + 1 : radius;
            if (ax + az > radius * 2 - cut + 2) continue;
            if (ax === 0 ? radius - az < 4 : az !== 0 || radius - ax < 4) continue;
            const pos = { x: top.x + dx, y: top.y + y, z: top.z + dz };
            const expected = callbacks.sampleFoliageState(pos, random);
            const actual = callbacks.getBlockState(pos);
            if (!sameBlockState(expected, actual)) continue;
            callbacks.replaceLeafWithLog(pos, ax === 0 ? 'x' : 'z', random);
        }
    }
}

function sameBlockState(first, second) {
    if (!first || !second) return false;
    if (Number.isInteger(first.stateId) && Number.isInteger(second.stateId)) return first.stateId === second.stateId;
    if (first.name !== second.name) return false;
    const a = first.properties ?? {};
    const b = second.properties ?? {};
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => String(a[key]) === String(b[key]));
}
