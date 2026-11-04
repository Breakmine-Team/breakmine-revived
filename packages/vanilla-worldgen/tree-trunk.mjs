import { sampleIntProvider } from './value-providers.mjs';

export function sampleTrunkHeight(placer, random) {
    if (!placer || !placer.type?.endsWith('_trunk_placer')) throw new TypeError('Expected a vanilla trunk placer');
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('Tree trunk height requires a Java-compatible random source');
    for (const name of ['base_height', 'height_rand_a', 'height_rand_b']) {
        if (!Number.isInteger(placer[name]) || placer[name] < 0 || placer[name] > (name === 'base_height' ? 32 : 24)) {
            throw new RangeError(`Invalid straight trunk placer ${name}`);
        }
    }
    return placer.base_height + random.nextInt(placer.height_rand_a + 1) + random.nextInt(placer.height_rand_b + 1);
}

export function placeStraightTrunk(treeConfig, origin, height, random, {
    sampleTrunkState, sampleBelowTrunkState, isValidTreePos, setBlock
} = {}) {
    const placer = treeConfig?.trunk_placer;
    if (!placer || typeof placer !== 'object' || typeof placer.type !== 'string') throw new TypeError('Tree configuration is missing a trunk placer');
    if (placer.type !== 'minecraft:straight_trunk_placer') throw new Error(`Unsupported trunk placer: ${placer.type}`);
    if (!treeConfig.trunk_provider || typeof treeConfig.trunk_provider !== 'object') throw new TypeError('Tree configuration is missing a trunk state provider');
    for (const [name, callback] of Object.entries({ sampleTrunkState, isValidTreePos, setBlock })) {
        if (typeof callback !== 'function') throw new TypeError(`Straight trunk placement requires ${name}`);
    }
    if (treeConfig.below_trunk_provider != null && typeof sampleBelowTrunkState !== 'function') {
        throw new TypeError('Straight trunk placement requires sampleBelowTrunkState');
    }
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new TypeError('Tree trunk origin must be an integer block position');
    if (!Number.isInteger(height) || height < 0 || height > 80) throw new RangeError('Invalid straight trunk height');
    if (!random) throw new TypeError('Straight trunk placement requires a Java-compatible random source');

    const below = { x: origin.x, y: origin.y - 1, z: origin.z };
    if (treeConfig.below_trunk_provider != null) {
        const belowState = sampleBelowTrunkState(treeConfig.below_trunk_provider, below, random);
        if (belowState != null) setBlock(belowState, below, 19);
    }
    for (let dy = 0; dy < height; dy++) {
        const pos = { x: origin.x, y: origin.y + dy, z: origin.z };
        if (isValidTreePos(pos)) {
            const state = sampleTrunkState(treeConfig.trunk_provider, pos, random);
            if (state == null) throw new TypeError('Trunk state provider returned no block state');
            setBlock(state, pos, 19);
        }
    }
    return [{ position: { x: origin.x, y: origin.y + height, z: origin.z }, radius: 0, doubleTrunk: false }];
}

export function placeForkingTrunk(treeConfig, origin, height, random, {
    sampleTrunkState, sampleBelowTrunkState, isValidTreePos, setBlock
} = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, { sampleTrunkState, isValidTreePos, setBlock });
    placeBelow(treeConfig, origin, random, sampleBelowTrunkState, setBlock);
    const attachments = [];
    const firstDirection = horizontalDirection(random);
    let branchStart = height - random.nextInt(4) - 1;
    let branchLength = 3 - random.nextInt(3);
    let x = origin.x;
    let z = origin.z;
    let lastPlacedY = null;
    for (let y = 0; y < height; y++) {
        if (y >= branchStart && branchLength > 0) {
            x += firstDirection.x;
            z += firstDirection.z;
            branchLength--;
        }
        const pos = { x, y: origin.y + y, z };
        if (placeLogAt(treeConfig, pos, random, sampleTrunkState, isValidTreePos, setBlock)) lastPlacedY = pos.y + 1;
    }
    if (lastPlacedY != null) attachments.push({ position: { x, y: lastPlacedY, z }, radiusOffsetXZ: 1, foliageHeightOffset: 0, doubleTrunk: false });

    const secondDirection = horizontalDirection(random);
    if (secondDirection.name !== firstDirection.name) {
        const secondStart = branchStart - random.nextInt(2) - 1;
        let secondLength = 1 + random.nextInt(3);
        let secondPlacedY = null;
        x = origin.x;
        z = origin.z;
        for (let y = secondStart; y < height && secondLength > 0; y++, secondLength--) {
            if (y < 1) continue;
            x += secondDirection.x;
            z += secondDirection.z;
            const pos = { x, y: origin.y + y, z };
            if (placeLogAt(treeConfig, pos, random, sampleTrunkState, isValidTreePos, setBlock)) secondPlacedY = pos.y + 1;
        }
        if (secondPlacedY != null) attachments.push({ position: { x, y: secondPlacedY, z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
    }
    return attachments;
}

export function placeBendingTrunk(treeConfig, origin, height, random, {
    sampleTrunkState, sampleBelowTrunkState, isValidTreePos, setBlock
} = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, { sampleTrunkState, isValidTreePos, setBlock });
    const placer = treeConfig.trunk_placer;
    if (!Number.isInteger(placer.min_height_for_leaves) || placer.min_height_for_leaves < 0 || !placer.bend_length) throw new TypeError('Malformed bending trunk placer');
    const direction = horizontalDirection(random);
    const lastTrunkY = height - 1;
    let pos = { ...origin };
    placeBelow(treeConfig, origin, random, sampleBelowTrunkState, setBlock);
    const attachments = [];
    for (let y = 0; y <= lastTrunkY; y++) {
        const bendGate = random.nextInt(2);
        if (y + 1 >= lastTrunkY + bendGate) pos = { x: pos.x + direction.x, y: pos.y, z: pos.z + direction.z };
        if (isValidTreePos(pos)) placeLogAt(treeConfig, pos, random, sampleTrunkState, isValidTreePos, setBlock);
        if (y >= placer.min_height_for_leaves) attachments.push({ position: { ...pos }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
        pos = { x: pos.x, y: pos.y + 1, z: pos.z };
    }
    const bendLength = sampleIntProvider(placer.bend_length, random);
    for (let step = 0; step <= bendLength; step++) {
        if (isValidTreePos(pos)) placeLogAt(treeConfig, pos, random, sampleTrunkState, isValidTreePos, setBlock);
        attachments.push({ position: { ...pos }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
        pos = { x: pos.x + direction.x, y: pos.y, z: pos.z + direction.z };
    }
    return attachments;
}

export function placeGiantTrunk(treeConfig, origin, height, random, {
    sampleTrunkState, sampleBelowTrunkState, isValidTreePos, isLog, setBlock
} = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, { sampleTrunkState, isValidTreePos, setBlock });
    if (typeof isLog !== 'function') throw new TypeError('Giant trunk placement requires isLog');
    for (const offset of [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]) {
        const pos = { x: origin.x + offset.x, y: origin.y, z: origin.z + offset.z };
        placeBelow(treeConfig, pos, random, sampleBelowTrunkState, setBlock);
    }
    for (let y = 0; y < height; y++) {
        const offsets = y === height - 1
            ? [{ x: 0, z: 0 }]
            : [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }];
        for (const offset of offsets) {
            const pos = { x: origin.x + offset.x, y: origin.y + y, z: origin.z + offset.z };
            const free = isValidTreePos(pos) || isLog(pos);
            if (free) placeLogAt(treeConfig, pos, random, sampleTrunkState, isValidTreePos, setBlock);
        }
    }
    return [{ position: { x: origin.x, y: origin.y + height, z: origin.z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: true }];
}

export function placeUpwardsBranchingTrunk(treeConfig, origin, height, random, {
    sampleTrunkState, sampleBelowTrunkState, isValidTreePos, canGrowThrough, setBlock
} = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, { sampleTrunkState, isValidTreePos, setBlock });
    const placer = treeConfig.trunk_placer;
    if (!placer.extra_branch_steps || !placer.extra_branch_length || !Number.isFinite(placer.place_branch_per_log_probability)) throw new TypeError('Malformed upwards branching trunk placer');
    if (typeof canGrowThrough !== 'function') throw new TypeError('Upwards branching trunk placement requires canGrowThrough');
    const valid = pos => isValidTreePos(pos) || canGrowThrough(pos);
    placeBelow(treeConfig, origin, random, sampleBelowTrunkState, setBlock);
    const attachments = [];
    let current = { ...origin };
    for (let y = 0; y < height; y++) {
        const pos = { x: origin.x, y: origin.y + y, z: origin.z };
        current = pos;
        if (placeLogAt(treeConfig, pos, random, sampleTrunkState, valid, setBlock) && y < height - 1 && Math.fround(random.nextFloat()) < Math.fround(placer.place_branch_per_log_probability)) {
            const direction = horizontalDirection(random);
            const firstLength = sampleIntProvider(placer.extra_branch_length, random);
            const branchLength = Math.max(0, firstLength - sampleIntProvider(placer.extra_branch_length, random) - 1);
            const branchSteps = sampleIntProvider(placer.extra_branch_steps, random);
            placeUpwardBranch(treeConfig, origin, height, current, direction, branchLength, branchSteps, random, sampleTrunkState, valid, setBlock, attachments);
        }
        if (y === height - 1) attachments.push({ position: { x: origin.x, y: origin.y + y + 1, z: origin.z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
    }
    return attachments;
}

export function placeDarkOakTrunk(treeConfig, origin, height, random, {
    sampleTrunkState, sampleBelowTrunkState, isValidTreePos, setBlock
} = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, { sampleTrunkState, isValidTreePos, setBlock });
    if (treeConfig.trunk_placer.type !== 'minecraft:dark_oak_trunk_placer') throw new Error('Expected a dark oak trunk placer');
    for (const offset of [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]) {
        placeBelow(treeConfig, { x: origin.x + offset.x, y: origin.y, z: origin.z + offset.z }, random, sampleBelowTrunkState, setBlock);
    }
    const direction = horizontalDirection(random);
    let branchStart = height - random.nextInt(4);
    let branchLength = 2 - random.nextInt(3);
    let x = origin.x;
    let z = origin.z;
    for (let y = 0; y < height; y++) {
        if (y >= branchStart && branchLength > 0) {
            x += direction.x;
            z += direction.z;
            branchLength--;
        }
        const pos = { x, y: origin.y + y, z };
        if (isValidTreePos(pos)) {
            for (const offset of [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }, { x: 1, z: 1 }]) {
                placeLogAt(treeConfig, { x: x + offset.x, y: pos.y, z: z + offset.z }, random, sampleTrunkState, isValidTreePos, setBlock);
            }
        }
    }
    const attachments = [{ position: { x, y: origin.y + height - 1, z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: true }];
    for (let dx = -1; dx <= 2; dx++) {
        for (let dz = -1; dz <= 2; dz++) {
            if (dx >= 0 && dx <= 1 && dz >= 0 && dz <= 1) continue;
            if (random.nextInt(3) > 0) continue;
            const branchLength = 2 + random.nextInt(3);
            const branchX = origin.x + dx;
            const branchZ = origin.z + dz;
            for (let step = 0; step < branchLength; step++) {
                placeLogAt(treeConfig, { x: branchX, y: origin.y + height - 2 - step, z: branchZ }, random, sampleTrunkState, isValidTreePos, setBlock);
            }
            attachments.push({ position: { x: branchX, y: origin.y + height - 1, z: branchZ }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
        }
    }
    return attachments;
}

export function placeMegaJungleTrunk(treeConfig, origin, height, random, adapters = {}) {
    if (treeConfig?.trunk_placer?.type !== 'minecraft:mega_jungle_trunk_placer') throw new Error('Expected a mega jungle trunk placer');
    const attachments = placeGiantTrunk(treeConfig, origin, height, random, adapters);
    let rootY = height - 2 - random.nextInt(4);
    while (rootY > height / 2) {
        const angle = Math.fround(Math.fround(random.nextFloat()) * Math.fround(Math.PI * 2));
        let rootX = 0;
        let rootZ = 0;
        for (let step = 0; step < 5; step++) {
            rootX = Math.trunc(Math.fround(1.5 + Math.fround(Math.fround(Math.cos(angle)) * step)));
            rootZ = Math.trunc(Math.fround(1.5 + Math.fround(Math.fround(Math.sin(angle)) * step)));
            const pos = {
                x: origin.x + rootX,
                y: origin.y + rootY - 3 + Math.trunc(step / 2),
                z: origin.z + rootZ
            };
            placeLogAt(treeConfig, pos, random, adapters.sampleTrunkState, adapters.isValidTreePos, adapters.setBlock);
        }
        attachments.push({
            position: { x: origin.x + rootX, y: origin.y + rootY, z: origin.z + rootZ },
            radiusOffsetXZ: 0,
            foliageHeightOffset: -2,
            doubleTrunk: false
        });
        rootY -= 2 + random.nextInt(4);
    }
    return attachments;
}

export function placeCherryTrunk(treeConfig, origin, height, random, adapters = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, {
        sampleTrunkState: adapters.sampleTrunkState,
        isValidTreePos: adapters.isValidTreePos,
        setBlock: adapters.setBlock
    });
    const placer = treeConfig.trunk_placer;
    if (placer.type !== 'minecraft:cherry_trunk_placer') throw new Error('Expected a cherry trunk placer');
    for (const name of ['branch_start_offset_from_top', 'branch_count', 'branch_end_offset_from_top', 'branch_horizontal_length']) {
        if (placer[name] == null) throw new TypeError(`Cherry trunk placer is missing ${name}`);
    }
    if (typeof adapters.stateIdFor !== 'function') throw new TypeError('Cherry trunk placement requires stateIdFor to orient branch logs');

    placeBelow(treeConfig, origin, random, adapters.sampleBelowTrunkState, adapters.setBlock);
    const firstStart = Math.max(0, height - 1 + sampleIntProvider(placer.branch_start_offset_from_top, random));
    // CherryTrunkPlacer derives the omitted second offset from the first
    // UniformInt range: [first.min, first.max - 1]. This is constructor
    // behavior in reference, not a zero offset.
    const secondOffset = placer.second_branch_start_offset_from_top ?? {
        min_inclusive: placer.branch_start_offset_from_top.min_inclusive,
        max_inclusive: placer.branch_start_offset_from_top.max_inclusive - 1
    };
    let secondStart = Math.max(0, height - 1 + sampleIntProvider(secondOffset, random));
    if (secondStart >= firstStart) secondStart++;
    const branchCount = sampleIntProvider(placer.branch_count, random);
    const middleBranch = branchCount === 3;
    const bothSides = branchCount >= 2;
    const trunkHeight = middleBranch ? height : bothSides ? Math.max(firstStart, secondStart) + 1 : firstStart + 1;
    for (let y = 0; y < trunkHeight; y++) {
        placeLogAt(treeConfig, { x: origin.x, y: origin.y + y, z: origin.z }, random, adapters.sampleTrunkState, adapters.isValidTreePos, adapters.setBlock);
    }

    const attachments = middleBranch
        ? [{ position: { x: origin.x, y: origin.y + trunkHeight, z: origin.z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }]
        : [];
    const direction = horizontalDirection(random);
    const sideways = direction.x !== 0 ? 'x' : 'z';
    attachments.push(placeCherryBranch(treeConfig, origin, height, firstStart, firstStart >= trunkHeight - 1, direction, sideways, random, adapters));
    if (bothSides) {
        attachments.push(placeCherryBranch(treeConfig, origin, height, secondStart, secondStart >= trunkHeight - 1,
            { name: `${direction.name}_opposite`, x: -direction.x, z: -direction.z }, sideways, random, adapters));
    }
    return attachments;
}

export function placePoplarTrunk(treeConfig, origin, height, random, adapters = {}) {
    validateTrunkInputs(treeConfig, origin, height, random, {
        sampleTrunkState: adapters.sampleTrunkState,
        isValidTreePos: adapters.isValidTreePos,
        setBlock: adapters.setBlock
    });
    const placer = treeConfig.trunk_placer;
    if (placer.type !== 'minecraft:poplar_trunk_placer' || placer.trunk_height_above_branches == null || placer.branch_amount == null) {
        throw new TypeError('Malformed poplar trunk placer');
    }
    if (typeof adapters.stateIdFor !== 'function') throw new TypeError('Poplar trunk placement requires stateIdFor to orient branch logs');
    placeBelow(treeConfig, origin, random, adapters.sampleBelowTrunkState, adapters.setBlock);
    const topHeight = height - sampleIntProvider(placer.trunk_height_above_branches, random);
    for (let y = 0; y < height; y++) {
        const pos = { x: origin.x, y: origin.y + y, z: origin.z };
        placeLogAt(treeConfig, pos, random, adapters.sampleTrunkState, adapters.isValidTreePos, adapters.setBlock);
        const directions = shuffledHorizontalDirections(random);
        if (y !== topHeight - 1) continue;
        const amount = sampleIntProvider(placer.branch_amount, random);
        if (!Number.isInteger(amount) || amount < 0 || amount > 4) throw new RangeError('Invalid poplar branch amount');
        for (let i = 0; i < amount; i++) {
            const direction = directions[i];
            placeOrientedLog(treeConfig, {
                x: pos.x + direction.x, y: pos.y, z: pos.z + direction.z
            }, direction.x !== 0 ? 'x' : 'z', random, adapters);
        }
    }
    return [{ position: { x: origin.x, y: origin.y + topHeight, z: origin.z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }];
}

export function placeFancyTrunk(treeConfig, origin, treeHeight, random, adapters = {}) {
    validateTrunkInputs(treeConfig, origin, treeHeight, random, {
        sampleTrunkState: adapters.sampleTrunkState,
        isValidTreePos: adapters.isValidTreePos,
        setBlock: adapters.setBlock
    });
    if (treeConfig.trunk_placer.type !== 'minecraft:fancy_trunk_placer') throw new Error('Expected a fancy trunk placer');
    const fancyAdapters = { ...adapters, trunkProvider: treeConfig.trunk_provider };
    placeBelow(treeConfig, origin, random, adapters.sampleBelowTrunkState, adapters.setBlock);
    const height = treeHeight + 2;
    const topHeight = Math.floor(height * 0.618);
    const density = Math.min(1, Math.floor(1.382 + (height / 13) ** 2));
    const trunkTop = origin.y + topHeight;
    const coords = [{ position: { x: origin.x, y: origin.y + height - 5, z: origin.z }, branchBase: trunkTop }];

    for (let layer = height - 5; layer >= 0; layer--) {
        const shape = fancyTreeShape(height, layer);
        if (shape < 0) continue;
        for (let branch = 0; branch < density; branch++) {
            const branchRadius = shape * (random.nextFloat() + 0.328);
            const angle = Math.fround(random.nextFloat() * 2) * Math.PI;
            const branchPos = {
                x: origin.x + Math.floor(branchRadius * Math.sin(angle) + 0.5),
                y: origin.y + layer - 1,
                z: origin.z + Math.floor(branchRadius * Math.cos(angle) + 0.5)
            };
            const branchTop = { ...branchPos, y: branchPos.y + 5 };
            if (!fancyLimb(treeConfig, origin, branchTop, false, random, fancyAdapters)) continue;
            const dx = origin.x - branchPos.x;
            const dz = origin.z - branchPos.z;
            const branchBaseHeight = Math.min(trunkTop, Math.trunc(branchPos.y - Math.sqrt(dx * dx + dz * dz) * 0.381));
            const branchBase = { x: origin.x, y: branchBaseHeight, z: origin.z };
            if (fancyLimb(treeConfig, branchBase, branchPos, false, random, fancyAdapters)) {
                coords.push({ position: branchPos, branchBase: branchBaseHeight });
            }
        }
    }

    fancyLimb(treeConfig, origin, { x: origin.x, y: trunkTop, z: origin.z }, true, random, fancyAdapters);
    const branches = [];
    for (const item of coords) {
        const branchBase = { x: origin.x, y: item.branchBase, z: origin.z };
        if (!samePos(branchBase, item.position) && item.branchBase - origin.y >= height * 0.2) {
            fancyLimb(treeConfig, branchBase, item.position, true, random, fancyAdapters);
        }
        if (item.branchBase - origin.y >= height * 0.2) branches.push(item.position);
    }
    return branches.map(position => ({ position, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false }));
}

function fancyLimb(treeConfig, start, end, place, random, adapters) {
    if (!place && samePos(start, end)) return true;
    const diff = { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z };
    const steps = Math.max(Math.abs(diff.x), Math.abs(diff.y), Math.abs(diff.z));
    if (steps === 0) return true;
    const step = { x: Math.fround(diff.x / steps), y: Math.fround(diff.y / steps), z: Math.fround(diff.z / steps) };
    const axis = Math.abs(diff.x) >= Math.abs(diff.z) && Math.abs(diff.x) > 0 ? 'x'
        : Math.abs(diff.z) > 0 ? 'z' : 'y';
    for (let i = 0; i <= steps; i++) {
        const pos = {
            x: start.x + Math.floor(Math.fround(0.5 + Math.fround(i * step.x))),
            y: start.y + Math.floor(Math.fround(0.5 + Math.fround(i * step.y))),
            z: start.z + Math.floor(Math.fround(0.5 + Math.fround(i * step.z)))
        };
        if (place) placeOrientedLog(treeConfig, pos, axis, random, adapters);
        else if (!adapters.isValidTreePos(pos)) return false;
    }
    return true;
}

function fancyTreeShape(height, y) {
    if (y < Math.fround(height * Math.fround(0.3))) return -1;
    const half = Math.fround(height / 2);
    const relative = Math.fround(half - y);
    let radius = Math.fround(Math.sqrt(Math.fround(Math.fround(half * half) - Math.fround(relative * relative))));
    if (relative === 0) radius = half;
    else if (Math.abs(relative) >= half) radius = 0;
    return Math.fround(radius * 0.5);
}

function samePos(a, b) {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

function shuffledHorizontalDirections(random) {
    const directions = [
        { name: 'down', x: 0, z: 0, vertical: true }, { name: 'up', x: 0, z: 0, vertical: true },
        { name: 'north', x: 0, z: -1 }, { name: 'south', x: 0, z: 1 },
        { name: 'west', x: -1, z: 0 }, { name: 'east', x: 1, z: 0 }
    ];
    for (let size = directions.length; size > 1; size--) {
        const index = random.nextInt(size);
        if (!Number.isInteger(index) || index < 0 || index >= size) throw new RangeError('Random source returned an invalid shuffle index');
        [directions[size - 1], directions[index]] = [directions[index], directions[size - 1]];
    }
    return directions.filter(direction => !direction.vertical);
}

function placeCherryBranch(treeConfig, origin, treeHeight, startOffset, continuesUp, direction, axis, random, adapters) {
    const placer = treeConfig.trunk_placer;
    let current = { x: origin.x, y: origin.y + startOffset, z: origin.z };
    const endY = origin.y + treeHeight - 1 + sampleIntProvider(placer.branch_end_offset_from_top, random);
    const extendAway = !continuesUp && endY < current.y;
    const horizontalLength = sampleIntProvider(placer.branch_horizontal_length, random) + (extendAway ? 1 : 0);
    const end = { x: origin.x + direction.x * horizontalLength, y: endY, z: origin.z + direction.z * horizontalLength };
    const initialSteps = extendAway ? 2 : 1;
    for (let i = 0; i < initialSteps; i++) {
        current = { x: current.x + direction.x, y: current.y, z: current.z + direction.z };
        placeOrientedLog(treeConfig, current, axis, random, adapters);
    }
    const verticalDirection = end.y > current.y ? 1 : -1;
    while (Math.abs(end.x - current.x) + Math.abs(end.y - current.y) + Math.abs(end.z - current.z) > 0) {
        const distance = Math.abs(end.x - current.x) + Math.abs(end.y - current.y) + Math.abs(end.z - current.z);
        const verticalChance = Math.abs(end.y - current.y) / distance;
        const vertical = Math.fround(random.nextFloat()) < Math.fround(verticalChance);
        current = vertical
            ? { x: current.x, y: current.y + verticalDirection, z: current.z }
            : { x: current.x + direction.x, y: current.y, z: current.z + direction.z };
        placeOrientedLog(treeConfig, current, vertical ? 'y' : axis, random, adapters);
    }
    return { position: { x: end.x, y: end.y + 1, z: end.z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false };
}

function placeOrientedLog(treeConfig, pos, axis, random, adapters) {
    if (!adapters.isValidTreePos(pos)) return false;
    let state = adapters.sampleTrunkState(treeConfig.trunk_provider, pos, random);
    if (state == null) throw new TypeError('Trunk state provider returned no block state');
    if (Object.hasOwn(state.properties ?? {}, 'axis')) {
        const properties = { ...state.properties, axis };
        const stateId = adapters.stateIdFor(state.name, properties);
        if (!Number.isInteger(stateId) || stateId < 0 || stateId > 0xffffffff) throw new RangeError(`No vanilla state ID for ${state.name} axis=${axis}`);
        state = { ...state, stateId, properties };
    }
    adapters.setBlock(state, pos, 19);
    return true;
}

export function placeTrunkByType(treeConfig, origin, height, random, adapters = {}) {
    switch (treeConfig?.trunk_placer?.type) {
        case 'minecraft:straight_trunk_placer': return placeStraightTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:forking_trunk_placer': return placeForkingTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:bending_trunk_placer': return placeBendingTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:giant_trunk_placer': return placeGiantTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:upwards_branching_trunk_placer': return placeUpwardsBranchingTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:dark_oak_trunk_placer': return placeDarkOakTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:mega_jungle_trunk_placer': return placeMegaJungleTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:cherry_trunk_placer': return placeCherryTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:poplar_trunk_placer': return placePoplarTrunk(treeConfig, origin, height, random, adapters);
        case 'minecraft:fancy_trunk_placer': return placeFancyTrunk(treeConfig, origin, height, random, adapters);
        default: throw new Error(`Unsupported trunk placer: ${treeConfig?.trunk_placer?.type ?? '<missing type>'}`);
    }
}

function placeUpwardBranch(treeConfig, origin, treeHeight, base, direction, branchLength, steps, random, sampleState, isValid, setBlock, attachments) {
    let maxY = base.y + branchLength;
    let x = base.x;
    let z = base.z;
    for (let step = branchLength; step < treeHeight && steps > 0; step++, steps--) {
        if (step >= 1) {
            const y = base.y + step;
            x += direction.x;
            z += direction.z;
            maxY = y;
            placeLogAt(treeConfig, { x, y, z }, random, sampleState, isValid, setBlock);
        }
        attachments.push({ position: { x, y: step >= 1 ? base.y + step : base.y, z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
    }
    if (maxY - base.y > 1) {
        attachments.push({ position: { x, y: maxY, z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
        attachments.push({ position: { x, y: maxY - 2, z }, radiusOffsetXZ: 0, foliageHeightOffset: 0, doubleTrunk: false });
    }
}

function validateTrunkInputs(treeConfig, origin, height, random, callbacks) {
    if (!treeConfig?.trunk_placer || !treeConfig.trunk_provider) throw new TypeError('Tree configuration is missing a trunk placer or provider');
    if (!origin || ![origin.x, origin.y, origin.z].every(Number.isInteger)) throw new TypeError('Tree trunk origin must be an integer block position');
    if (!Number.isInteger(height) || height < 0 || height > 80) throw new RangeError('Invalid tree trunk height');
    if (!random || typeof random.nextInt !== 'function') throw new TypeError('Trunk placement requires a Java-compatible random source');
    for (const [name, callback] of Object.entries(callbacks)) if (typeof callback !== 'function') throw new TypeError(`Tree trunk placement requires ${name}`);
}

function placeBelow(treeConfig, origin, random, sampleBelowTrunkState, setBlock) {
    if (treeConfig.below_trunk_provider == null) return;
    if (typeof sampleBelowTrunkState !== 'function') throw new TypeError('Trunk placement requires sampleBelowTrunkState');
    const pos = { x: origin.x, y: origin.y - 1, z: origin.z };
    const state = sampleBelowTrunkState(treeConfig.below_trunk_provider, pos, random);
    if (state != null) setBlock(state, pos, 19);
}

function placeLogAt(treeConfig, pos, random, sampleTrunkState, isValidTreePos, setBlock) {
    if (!isValidTreePos(pos)) return false;
    const state = sampleTrunkState(treeConfig.trunk_provider, pos, random);
    if (state == null) throw new TypeError('Trunk state provider returned no block state');
    setBlock(state, pos, 19);
    return true;
}

function horizontalDirection(random) {
    const index = random.nextInt(4);
    if (!Number.isInteger(index) || index < 0 || index >= 4) throw new RangeError('Random source returned an invalid horizontal direction');
    return [
        { name: 'north', x: 0, z: -1 }, { name: 'east', x: 1, z: 0 },
        { name: 'south', x: 0, z: 1 }, { name: 'west', x: -1, z: 0 }
    ][index];
}
