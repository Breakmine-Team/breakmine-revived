import { relative } from './feature-world.mjs';

function requireCallback(context, name) {
    if (typeof context?.[name] !== 'function') throw new TypeError(`Beehive tree decorator requires context.${name}`);
    return context[name];
}

export function placeAttachedToLogsDecorator(decorator, logs, random, { context = {}, sampleState, setBlock } = {}) {
    validateProbability(decorator.probability, 'attached_to_logs');
    if (!Array.isArray(decorator.directions) || decorator.directions.length === 0) throw new TypeError('attached_to_logs requires directions');
    const shuffled = [...logs];
    for (let size = shuffled.length; size > 1; size--) {
        const index = random.nextInt(size);
        [shuffled[size - 1], shuffled[index]] = [shuffled[index], shuffled[size - 1]];
    }
    let count = 0;
    for (const log of shuffled) {
        const pos = relative(log, decorator.directions[random.nextInt(decorator.directions.length)]);
        if (Math.fround(random.nextFloat()) > Math.fround(decorator.probability) || !requireCallback(context, 'isAir')(pos)) continue;
        setBlock(sampleState(decorator.block_provider, pos), pos, 19); count++;
    }
    return count;
}

export function placeBeehiveDecorator(decorator, logs, leaves, random, {
    context = {}, setBlock, stateIdFor
} = {}) {
    if (!decorator || decorator.type !== 'minecraft:beehive') throw new TypeError('Expected a beehive tree decorator');
    if (!Number.isFinite(decorator.probability) || decorator.probability < 0 || decorator.probability > 1) throw new RangeError('Invalid beehive decorator probability');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function') throw new TypeError('Beehive tree decorator requires setBlock and stateIdFor');
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('Beehive tree decorator requires a Java-compatible random source');
    if (!Array.isArray(logs) || !Array.isArray(leaves)) throw new TypeError('Beehive tree decorator requires log and leaf positions');
    if (logs.length === 0 || Math.fround(random.nextFloat()) >= Math.fround(decorator.probability)) return null;

    const isAir = requireCallback(context, 'isAir');
    const hasBeeNestBlockEntity = requireCallback(context, 'hasBeeNestBlockEntity');
    const storeBeeOccupants = requireCallback(context, 'storeBeeOccupants');
    const sortedLogs = [...logs].sort((a, b) => a.y - b.y);
    const sortedLeaves = [...leaves].sort((a, b) => a.y - b.y);
    const targetY = sortedLeaves.length > 0
        ? Math.max(sortedLeaves[0].y - 1, sortedLogs[0].y + 1)
        : Math.min(sortedLogs[0].y + 1 + random.nextInt(3), sortedLogs.at(-1).y);
    const candidates = [];
    for (const log of sortedLogs) {
        if (log.y !== targetY) continue;
        for (const direction of [{ x: 1, z: 0 }, { x: 0, z: 1 }, { x: -1, z: 0 }]) {
            candidates.push({ x: log.x + direction.x, y: log.y, z: log.z + direction.z });
        }
    }
    if (candidates.length === 0) return null;

    for (let size = candidates.length; size > 1; size--) {
        const selected = random.nextInt(size);
        if (!Number.isInteger(selected) || selected < 0 || selected >= size) throw new RangeError('Random source returned an invalid shuffle index');
        [candidates[size - 1], candidates[selected]] = [candidates[selected], candidates[size - 1]];
    }
    const nest = candidates.find(pos => isAir(pos) && isAir({ x: pos.x, y: pos.y, z: pos.z + 1 }));
    if (!nest) return null;
    const stateId = stateIdFor('minecraft:bee_nest', { facing: 'south' });
    if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError('No vanilla state ID for minecraft:bee_nest facing south');
    setBlock({ stateId, name: 'minecraft:bee_nest', properties: { facing: 'south' } }, nest, 19);

    if (!hasBeeNestBlockEntity(nest)) return nest;
    const beeCount = 2 + random.nextInt(2);
    const ages = [];
    for (let i = 0; i < beeCount; i++) ages.push(random.nextInt(599));
    storeBeeOccupants(nest, ages);
    return nest;
}

export function placeOnGroundDecorator(decorator, leaves, random, {
    context = {}, sampleState, setBlock
} = {}) {
    if (!decorator || decorator.type !== 'minecraft:place_on_ground') throw new TypeError('Expected a place_on_ground tree decorator');
    const tries = decorator.tries ?? 128;
    const radius = decorator.radius ?? 2;
    const height = decorator.height ?? 1;
    if (!Number.isInteger(tries) || tries <= 0 || tries > 0x7fffffff) throw new RangeError('Invalid place_on_ground tries');
    if (!Number.isInteger(radius) || radius < 0 || radius > 0x7fffffff) throw new RangeError('Invalid place_on_ground radius');
    if (!Number.isInteger(height) || height < 0 || height > 0x7fffffff) throw new RangeError('Invalid place_on_ground height');
    if (!decorator.block_state_provider) throw new TypeError('place_on_ground decorator requires a block_state_provider');
    if (typeof sampleState !== 'function' || typeof setBlock !== 'function') throw new TypeError('place_on_ground decorator requires sampleState and setBlock');
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('place_on_ground decorator requires a Java-compatible random source');
    if (!Array.isArray(leaves)) throw new TypeError('place_on_ground decorator requires leaf positions');
    if (leaves.length === 0) return 0;

    const isAirOrVine = requireCallback(context, 'isAirOrVine');
    const isSolidRender = requireCallback(context, 'isSolidRender');
    const getMotionBlockingNoLeavesHeight = requireCallback(context, 'getMotionBlockingNoLeavesHeight');
    const lowestLeafY = Math.min(...leaves.map(pos => pos.y));
    const lowestLayer = leaves.filter(pos => pos.y === lowestLeafY);
    const minX = Math.min(...lowestLayer.map(pos => pos.x)) - radius;
    const maxX = Math.max(...lowestLayer.map(pos => pos.x)) + radius;
    const minY = lowestLeafY - height;
    const maxY = lowestLeafY + height;
    const minZ = Math.min(...lowestLayer.map(pos => pos.z)) - radius;
    const maxZ = Math.max(...lowestLayer.map(pos => pos.z)) + radius;
    let placed = 0;

    for (let attempt = 0; attempt < tries; attempt++) {
        const pos = {
            x: nextIntBetweenInclusive(random, minX, maxX),
            y: nextIntBetweenInclusive(random, minY, maxY),
            z: nextIntBetweenInclusive(random, minZ, maxZ)
        };
        const above = { x: pos.x, y: pos.y + 1, z: pos.z };
        if (!isAirOrVine(above)) continue;
        if (!isSolidRender(pos)) continue;
        const heightmapY = getMotionBlockingNoLeavesHeight(pos);
        if (!Number.isInteger(heightmapY)) throw new TypeError('Motion-blocking heightmap adapter must return an integer Y');
        if (heightmapY > above.y) continue;
        const state = sampleState(decorator.block_state_provider, above, random);
        setBlock(state, above, 19);
        placed++;
    }
    return placed;
}

export function placeTrunkVineDecorator(logs, random, { context = {}, setBlock, stateIdFor } = {}) {
    if (!Array.isArray(logs)) throw new TypeError('trunk_vine decorator requires log positions');
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('trunk_vine decorator requires a Java-compatible random source');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function') throw new TypeError('trunk_vine decorator requires setBlock and stateIdFor');
    const isAir = requireCallback(context, 'isAir');
    const directions = [
        { dx: -1, dz: 0, property: 'east' },
        { dx: 1, dz: 0, property: 'west' },
        { dx: 0, dz: -1, property: 'south' },
        { dx: 0, dz: 1, property: 'north' }
    ];
    let placed = 0;
    for (const log of logs) {
        for (const direction of directions) {
            const draw = random.nextInt(3);
            if (!Number.isInteger(draw) || draw < 0 || draw >= 3) throw new RangeError('Random source returned an invalid trunk_vine draw');
            if (draw === 0) continue;
            const pos = { x: log.x + direction.dx, y: log.y, z: log.z + direction.dz };
            if (!isAir(pos)) continue;
            setBlock(makeVineState(direction.property, stateIdFor), pos, 19);
            placed++;
        }
    }
    return placed;
}

export function placeLeaveVineDecorator(decorator, leaves, random, { context = {}, setBlock, stateIdFor } = {}) {
    if (!decorator || decorator.type !== 'minecraft:leave_vine') throw new TypeError('Expected a leave_vine tree decorator');
    if (!Number.isFinite(decorator.probability) || decorator.probability < 0 || decorator.probability > 1) throw new RangeError('Invalid leave_vine probability');
    if (!Array.isArray(leaves)) throw new TypeError('leave_vine decorator requires leaf positions');
    if (!random || typeof random.nextFloat !== 'function') throw new TypeError('leave_vine decorator requires a Java-compatible random source');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function') throw new TypeError('leave_vine decorator requires setBlock and stateIdFor');
    const isAir = requireCallback(context, 'isAir');
    const directions = [
        { dx: -1, dz: 0, property: 'east' },
        { dx: 1, dz: 0, property: 'west' },
        { dx: 0, dz: -1, property: 'south' },
        { dx: 0, dz: 1, property: 'north' }
    ];
    let placed = 0;
    for (const leaf of leaves) {
        for (const direction of directions) {
            const draw = Math.fround(random.nextFloat());
            if (draw >= Math.fround(decorator.probability)) continue;
            let pos = { x: leaf.x + direction.dx, y: leaf.y, z: leaf.z + direction.dz };
            if (!isAir(pos)) continue;
            let remaining = 4;
            while (isAir(pos) && remaining > 0) {
                setBlock(makeVineState(direction.property, stateIdFor), pos, 19);
                placed++;
                pos = { x: pos.x, y: pos.y - 1, z: pos.z };
                remaining--;
            }
        }
    }
    return placed;
}

export function placeCocoaDecorator(decorator, logs, random, { context = {}, setBlock, stateIdFor } = {}) {
    validateProbability(decorator?.probability, 'cocoa');
    if (!Array.isArray(logs)) throw new TypeError('cocoa decorator requires log positions');
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('cocoa decorator requires a Java-compatible random source');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function') throw new TypeError('cocoa decorator requires setBlock and stateIdFor');
    if (Math.fround(random.nextFloat()) >= Math.fround(decorator.probability) || logs.length === 0) return 0;
    const isAir = requireCallback(context, 'isAir');
    const baseY = logs[0].y;
    const horizontal = [
        { dx: 0, dz: -1, facing: 'north', property: 'south' },
        { dx: 1, dz: 0, facing: 'east', property: 'west' },
        { dx: 0, dz: 1, facing: 'south', property: 'north' },
        { dx: -1, dz: 0, facing: 'west', property: 'east' }
    ];
    let placed = 0;
    for (const log of logs) {
        if (log.y - baseY > 2) continue;
        for (const direction of horizontal) {
            if (Math.fround(random.nextFloat()) > Math.fround(0.25)) continue;
            const pos = { x: log.x - direction.dx, y: log.y, z: log.z - direction.dz };
            if (!isAir(pos)) continue;
            const properties = { age: String(random.nextInt(3)), facing: direction.facing };
            const stateId = stateIdFor('minecraft:cocoa', properties);
            if (!validStateId(stateId)) throw new RangeError('No vanilla state ID for minecraft:cocoa');
            setBlock({ stateId, name: 'minecraft:cocoa', properties }, pos, 19);
            placed++;
        }
    }
    return placed;
}

export function placeCreakingHeartDecorator(decorator, logs, random, { context = {}, setBlock, stateIdFor } = {}) {
    validateProbability(decorator?.probability, 'creaking_heart');
    if (!Array.isArray(logs)) throw new TypeError('creaking_heart decorator requires log positions');
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('creaking_heart decorator requires a Java-compatible random source');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function') throw new TypeError('creaking_heart decorator requires setBlock and stateIdFor');
    if (logs.length === 0 || Math.fround(random.nextFloat()) >= Math.fround(decorator.probability)) return null;
    const isLog = requireCallback(context, 'isLog');
    const shuffled = shuffledCopy(logs, random);
    const center = shuffled.find(pos => DIRECTIONS_6.every(direction => isLog(offsetPos(pos, direction))));
    if (!center) return null;
    const properties = { axis: 'y', natural: 'true', state: 'dormant' };
    const stateId = stateIdFor('minecraft:creaking_heart', properties);
    if (!validStateId(stateId)) throw new RangeError('No vanilla state ID for minecraft:creaking_heart');
    setBlock({ stateId, name: 'minecraft:creaking_heart', properties }, center, 19);
    return center;
}

export function placeAttachedToLeavesDecorator(decorator, leaves, random, { context = {}, sampleState, setBlock } = {}) {
    validateProbability(decorator?.probability, 'attached_to_leaves');
    for (const key of ['exclusion_radius_xz', 'exclusion_radius_y', 'required_empty_blocks']) {
        const value = decorator[key];
        const min = key === 'required_empty_blocks' ? 1 : 0;
        if (!Number.isInteger(value) || value < min || value > 16) throw new RangeError(`Invalid attached_to_leaves ${key}`);
    }
    if (!decorator.block_provider || !Array.isArray(decorator.directions) || decorator.directions.length === 0) throw new TypeError('Malformed attached_to_leaves decorator');
    if (!Array.isArray(leaves)) throw new TypeError('attached_to_leaves decorator requires leaf positions');
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('attached_to_leaves decorator requires a Java-compatible random source');
    if (typeof sampleState !== 'function' || typeof setBlock !== 'function') throw new TypeError('attached_to_leaves decorator requires sampleState and setBlock');
    const isAir = requireCallback(context, 'isAir');
    const shuffled = shuffledCopy(leaves, random);
    const excluded = new Set();
    let placed = 0;
    for (const leaf of shuffled) {
        const choice = random.nextInt(decorator.directions.length);
        if (!Number.isInteger(choice) || choice < 0 || choice >= decorator.directions.length) throw new RangeError('Random source returned an invalid attached_to_leaves direction');
        const direction = directionByName(decorator.directions[choice]);
        if (!direction) throw new Error(`Unsupported attached_to_leaves direction: ${decorator.directions[choice]}`);
        const target = offsetPos(leaf, direction);
        const targetKey = positionKey(target);
        if (excluded.has(targetKey)) continue;
        if (Math.fround(random.nextFloat()) >= Math.fround(decorator.probability)) continue;
        let enoughAir = true;
        for (let distance = 1; distance <= decorator.required_empty_blocks; distance++) {
            if (!isAir(offsetPos(leaf, scaleDirection(direction, distance)))) {
                enoughAir = false;
                break;
            }
        }
        if (!enoughAir) continue;
        for (let dx = -decorator.exclusion_radius_xz; dx <= decorator.exclusion_radius_xz; dx++) {
            for (let dy = -decorator.exclusion_radius_y; dy <= decorator.exclusion_radius_y; dy++) {
                for (let dz = -decorator.exclusion_radius_xz; dz <= decorator.exclusion_radius_xz; dz++) {
                    excluded.add(positionKey({ x: target.x + dx, y: target.y + dy, z: target.z + dz }));
                }
            }
        }
        setBlock(sampleState(decorator.block_provider, target, random), target, 19);
        placed++;
    }
    return placed;
}

export function placeAlterGroundDecorator(decorator, logs, random, { context = {}, sampleOptionalState, setBlock } = {}) {
    if (decorator?.type !== 'minecraft:alter_ground' || !decorator.provider) throw new TypeError('Expected an alter_ground decorator with a provider');
    if (!Array.isArray(logs)) throw new TypeError('alter_ground decorator requires log positions');
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('alter_ground decorator requires a Java-compatible random source');
    if (typeof sampleOptionalState !== 'function' || typeof setBlock !== 'function') throw new TypeError('alter_ground decorator requires sampleOptionalState and setBlock');
    if (logs.length === 0) return 0;
    const lowestY = Math.min(...logs.map(pos => pos.y));
    const roots = logs.filter(pos => pos.y === lowestY);
    let placed = 0;
    for (const root of roots) {
        const circles = [
            { x: -1, z: -1 }, { x: 1, z: -1 }, { x: -1, z: 1 }, { x: 1, z: 1 }
        ];
        for (const offset of circles) placed += placeAlterGroundCircle(decorator, { x: root.x + offset.x, y: root.y, z: root.z + offset.z }, random, context, sampleOptionalState, setBlock);
        for (let attempt = 0; attempt < 5; attempt++) {
            const draw = random.nextInt(64);
            if (!Number.isInteger(draw) || draw < 0 || draw >= 64) throw new RangeError('Random source returned an invalid alter_ground draw');
            const x = draw % 8;
            const z = Math.trunc(draw / 8);
            if (x === 0 || x === 7 || z === 0 || z === 7) {
                placed += placeAlterGroundCircle(decorator, { x: root.x - 3 + x, y: root.y, z: root.z - 3 + z }, random, context, sampleOptionalState, setBlock);
            }
        }
    }
    return placed;
}

export function placeShelfMushroomDecorator(decorator, logs, random, { context = {}, setBlock, stateIdFor } = {}) {
    validateProbability(decorator?.probability, 'shelf_mushroom');
    if (!Array.isArray(logs)) throw new TypeError('shelf_mushroom decorator requires log positions');
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('shelf_mushroom decorator requires a Java-compatible random source');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function') throw new TypeError('shelf_mushroom decorator requires setBlock and stateIdFor');
    if (Math.fround(random.nextFloat()) > Math.fround(decorator.probability) || logs.length === 0) return 0;
    const isReplaceable = requireCallback(context, 'isReplaceable');
    const isWaterOrWaterNearby = requireCallback(context, 'isWaterOrWaterNearby');
    const hasShelfMushroomAt = requireCallback(context, 'hasShelfMushroomAt');
    const baseY = logs[0].y;
    let placed = 0;
    const putMushroom = (pos, facing) => {
        const properties = { age: String(random.nextInt(2)), facing };
        const stateId = stateIdFor('minecraft:shelf_mushroom', properties);
        if (!validStateId(stateId)) throw new RangeError('No vanilla state ID for minecraft:shelf_mushroom');
        setBlock({ stateId, name: 'minecraft:shelf_mushroom', properties }, pos, 19);
        placed++;
    };
    const canPlaceAt = pos => isReplaceable(pos) && !isWaterOrWaterNearby(pos);
    if (logs[0].y === logs.at(-1).y) {
        const perpendicular = logs[0].x !== logs.at(-1).x
            ? [{ x: 0, z: -1, facing: 'north' }, { x: 0, z: 1, facing: 'south' }]
            : [{ x: 1, z: 0, facing: 'east' }, { x: -1, z: 0, facing: 'west' }];
        for (const log of logs) {
            for (const direction of perpendicular) {
                if (Math.fround(random.nextFloat()) > Math.fround(0.25)) continue;
                const pos = { x: log.x + direction.x, y: log.y, z: log.z + direction.z };
                if (!canPlaceAt(pos)) continue;
                if (hasHorizontalShelfMushroom(pos, hasShelfMushroomAt) || hasHorizontalShelfMushroom(log, hasShelfMushroomAt)) continue;
                putMushroom(pos, direction.facing);
            }
        }
        return placed;
    }

    const firstDirection = random.nextInt(4);
    if (!Number.isInteger(firstDirection) || firstDirection < 0 || firstDirection >= 4) throw new RangeError('Random source returned an invalid shelf_mushroom orientation');
    const horizontal = [
        { x: 0, z: -1, facing: 'north' }, { x: 1, z: 0, facing: 'east' },
        { x: 0, z: 1, facing: 'south' }, { x: -1, z: 0, facing: 'west' }
    ];
    const directions = [horizontal[firstDirection], horizontal[(firstDirection + 1) % 4]];
    for (const log of logs) {
        const difference = log.y - baseY;
        if (difference < 1 || difference > 4) continue;
        for (const direction of directions) {
            if (Math.fround(random.nextFloat()) > Math.fround(0.25)) continue;
            const pos = { x: log.x + direction.x, y: log.y, z: log.z + direction.z };
            if (!canPlaceAt(pos) || hasShelfMushroomAt({ x: pos.x, y: pos.y - 1, z: pos.z })) continue;
            putMushroom(pos, direction.facing);
            break;
        }
    }
    return placed;
}

export function placePaleMossDecorator(decorator, logs, leaves, random, { context = {}, setBlock, stateIdFor, placeFeature } = {}) {
    for (const name of ['leaves_probability', 'trunk_probability', 'ground_probability']) validateProbability(decorator?.[name], `pale_moss ${name}`);
    if (!Array.isArray(logs) || !Array.isArray(leaves)) throw new TypeError('pale_moss decorator requires log and leaf positions');
    if (!random || typeof random.nextFloat !== 'function' || typeof random.nextInt !== 'function') throw new TypeError('pale_moss decorator requires a Java-compatible random source');
    if (typeof setBlock !== 'function' || typeof stateIdFor !== 'function' || typeof placeFeature !== 'function') throw new TypeError('pale_moss decorator requires setBlock, stateIdFor and placeFeature');
    const isAir = requireCallback(context, 'isAir');
    const shuffledLogs = shuffledCopy(logs, random);
    if (shuffledLogs.length === 0) return 0;
    const lowestLog = shuffledLogs.reduce((lowest, pos) => pos.y < lowest.y ? pos : lowest);
    let placed = 0;
    if (Math.fround(random.nextFloat()) < Math.fround(decorator.ground_probability)) {
        placeFeature('minecraft:pale_moss_patch', { x: lowestLog.x, y: lowestLog.y + 1, z: lowestLog.z });
    }
    for (const log of logs) {
        if (Math.fround(random.nextFloat()) < Math.fround(decorator.trunk_probability)) {
            const start = { x: log.x, y: log.y - 1, z: log.z };
            if (isAir(start)) placed += tryAddPaleMossHanger(start, random, isAir, stateIdFor, setBlock);
        }
    }
    for (const leaf of leaves) {
        if (Math.fround(random.nextFloat()) < Math.fround(decorator.leaves_probability)) {
            const below = { x: leaf.x, y: leaf.y - 1, z: leaf.z };
            if (isAir(below)) placed += tryAddPaleMossHanger(below, random, isAir, stateIdFor, setBlock);
        }
    }
    return placed;
}

const DIRECTIONS_6 = [
    { x: 0, y: -1, z: 0 }, { x: 0, y: 1, z: 0 },
    { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }
];

function placeAlterGroundCircle(decorator, center, random, context, sampleOptionalState, setBlock) {
    let placed = 0;
    for (let dx = -2; dx <= 2; dx++) {
        for (let dz = -2; dz <= 2; dz++) {
            if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
            const base = { x: center.x + dx, y: center.y, z: center.z + dz };
            for (let yOffset = 2; yOffset >= -3; yOffset--) {
                const pos = { x: base.x, y: base.y + yOffset, z: base.z };
                const state = sampleOptionalState(decorator.provider, pos, random);
                if (state != null) {
                    setBlock(state, pos, 19);
                    placed++;
                    break;
                }
                if (yOffset < 0 && !requireCallback(context, 'isAir')(pos)) break;
            }
        }
    }
    return placed;
}

function hasHorizontalShelfMushroom(pos, hasShelfMushroomAt) {
    const horizontal = [
        { x: 0, y: 0, z: -1 }, { x: 1, y: 0, z: 0 },
        { x: 0, y: 0, z: 1 }, { x: -1, y: 0, z: 0 }
    ];
    return horizontal.some(direction => hasShelfMushroomAt(offsetPos(pos, direction)));
}

function tryAddPaleMossHanger(start, random, isAir, stateIdFor, setBlock) {
    let pos = start;
    let placed = 0;
    while (isAir({ x: pos.x, y: pos.y - 1, z: pos.z })) {
        if (Math.fround(random.nextFloat()) < 0.5) break;
        setBlock(makePaleMossState(false, stateIdFor), pos, 19);
        placed++;
        pos = { x: pos.x, y: pos.y - 1, z: pos.z };
    }
    setBlock(makePaleMossState(true, stateIdFor), pos, 19);
    return placed + 1;
}

function makePaleMossState(tip, stateIdFor) {
    const properties = { tip: String(tip) };
    const stateId = stateIdFor('minecraft:pale_hanging_moss', properties);
    if (!validStateId(stateId)) throw new RangeError('No vanilla state ID for minecraft:pale_hanging_moss');
    return { stateId, name: 'minecraft:pale_hanging_moss', properties };
}

function directionByName(name) {
    return {
        down: { x: 0, y: -1, z: 0 }, up: { x: 0, y: 1, z: 0 },
        north: { x: 0, y: 0, z: -1 }, south: { x: 0, y: 0, z: 1 },
        west: { x: -1, y: 0, z: 0 }, east: { x: 1, y: 0, z: 0 }
    }[name];
}

function offsetPos(pos, direction) {
    return { x: pos.x + direction.x, y: pos.y + direction.y, z: pos.z + direction.z };
}

function scaleDirection(direction, amount) {
    return { x: direction.x * amount, y: direction.y * amount, z: direction.z * amount };
}

function positionKey(pos) {
    return `${pos.x},${pos.y},${pos.z}`;
}

function shuffledCopy(values, random) {
    const copy = [...values];
    for (let size = copy.length; size > 1; size--) {
        const selected = random.nextInt(size);
        if (!Number.isInteger(selected) || selected < 0 || selected >= size) throw new RangeError('Random source returned an invalid shuffle index');
        [copy[size - 1], copy[selected]] = [copy[selected], copy[size - 1]];
    }
    return copy;
}

function validateProbability(probability, name) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) throw new RangeError(`Invalid ${name} probability`);
}

function validStateId(stateId) {
    return Number.isInteger(stateId) && stateId >= 0 && stateId <= 0xffffffff;
}

function makeVineState(property, stateIdFor) {
    const properties = { east: 'false', west: 'false', north: 'false', south: 'false', up: 'false', [property]: 'true' };
    const stateId = stateIdFor('minecraft:vine', properties);
    if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError('No vanilla state ID for minecraft:vine');
    return { stateId, name: 'minecraft:vine', properties };
}

function nextIntBetweenInclusive(random, min, max) {
    if (max < min) throw new RangeError('Invalid inclusive random range');
    const bound = max - min + 1;
    if (!Number.isSafeInteger(bound) || bound > 0x7fffffff) throw new RangeError('Inclusive random range exceeds a Java int');
    const value = random.nextInt(bound);
    if (!Number.isInteger(value) || value < 0 || value >= bound) throw new RangeError('Random source returned an invalid bounded integer');
    return min + value;
}
