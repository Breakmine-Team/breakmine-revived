import { blockName, DIRECTIONS, relative, requireContext } from './feature-world.mjs';
import { shuffled } from './java-legacy-random.mjs';
import { createMultifaceSpreader } from './multiface-growth-feature.mjs';

const opposite = { down: 'up', up: 'down', north: 'south', south: 'north', east: 'west', west: 'east' };
const stepAxis = dir => dir === 'up' || dir === 'down' ? 'y' : dir === 'east' || dir === 'west' ? 'x' : 'z';
const isAir = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(state));
const isSculkBehaviour = state => ['minecraft:sculk', 'minecraft:sculk_vein'].includes(blockName(state));
const distance2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

export function placeSculkPatch(feature, origin, random, { context, directState, setBlock }) {
    for (const [field, min, max] of [['charge_count', 1, 32], ['amount_per_charge', 1, 500], ['spread_attempts', 1, 64], ['growth_rounds', 0, 8], ['spread_rounds', 0, 8]]) {
        if (!Number.isInteger(feature[field]) || feature[field] < min || feature[field] > max) throw new RangeError(`Invalid sculk_patch ${field}`);
    }
    const read = requireContext(context, 'getBlockState');
    const fluidAt = requireContext(context, 'getFluidState');
    const inTag = requireContext(context, 'isBlockInTag');
    const defaultState = requireContext(context, 'getDefaultBlockState');
    const write = (state, pos) => setBlock(state, pos, 3);
    const vein = createMultifaceSpreader('minecraft:sculk_vein', { context, directState, setBlock: write });
    const originState = read(origin), originName = blockName(originState), originFluid = fluidAt(origin);
    if (!isSculkBehaviour(originState) && !isAir(originState) && !(originName === 'minecraft:water' && originFluid.source)) return false;
    if (!isSculkBehaviour(originState) && !DIRECTIONS.some(dir => requireContext(context, 'isCollisionShapeFullBlock')(relative(origin, dir)))) return false;

    const cursorLimit = 32;
    for (let round = 0; round < feature.spread_rounds + feature.growth_rounds; round++) {
        const cursors = [];
        for (let i = 0; i < feature.charge_count; i++) {
            let remaining = feature.amount_per_charge;
            while (remaining > 0 && cursors.length < cursorLimit) {
                const charge = Math.min(1000, remaining);
                cursors.push({ pos: { ...origin }, charge, decay: 1, delay: 0, facings: null });
                remaining -= charge;
            }
        }
        const spreading = round < feature.spread_rounds;
        for (let attempt = 0; attempt < feature.spread_attempts; attempt++) {
            for (const cursor of cursors) {
                if (!cursor.charge || Math.max(Math.abs(cursor.pos.x - origin.x), Math.abs(cursor.pos.y - origin.y), Math.abs(cursor.pos.z - origin.z)) > 1024) continue;
                if (cursor.delay > 0) { cursor.delay--; continue; }
                let state = read(cursor.pos), name = blockName(state);
                if (spreading) {
                    if (name === 'minecraft:sculk_vein') vein.spreadAll(state, cursor.pos);
                    else if (cursor.facings === null) vein.spreadAll(state, cursor.pos, true, ['same_position']);
                    else if (isAir(state) || name === 'minecraft:water') {
                        if (cursor.facings.length) regrowVein(cursor.pos, state, cursor.facings, vein, directState, write);
                    } else if (!cursor.facings.length) vein.spreadAll(state, cursor.pos);
                    state = read(cursor.pos); name = blockName(state);
                }

                if (name === 'minecraft:sculk_vein') {
                    if (spreading && tryPlaceSculk(cursor, random, context, read, inTag, defaultState, directState, write, vein)) cursor.charge--;
                    else if (random.nextInt(5) === 0) cursor.charge = Math.floor(cursor.charge * 0.5);
                } else if (name === 'minecraft:sculk') {
                    if (random.nextInt(5) === 0) {
                        const near = distance2(cursor.pos, origin) < 1;
                        if (near || !canPlaceGrowth(cursor.pos, context, read, fluidAt, inTag)) {
                            if (random.nextInt(10) === 0) cursor.charge -= near ? 1 : decayPenalty(cursor.pos, origin, cursor.charge);
                        } else {
                            if (random.nextInt(50) < cursor.charge) {
                                const above = relative(cursor.pos, 'up');
                                let growth = random.nextInt(11) === 0
                                    ? { id: 'minecraft:sculk_shrieker', properties: { can_summon: 'true', shrieking: 'false', waterlogged: 'false' } }
                                    : { id: 'minecraft:sculk_sensor', properties: { power: '0', sculk_sensor_phase: 'inactive', waterlogged: 'false' } };
                                if (!fluidAt(above).empty && Object.hasOwn(growth.properties, 'waterlogged')) growth.properties.waterlogged = 'true';
                                write(directState(growth), above);
                            }
                            cursor.charge = Math.max(0, cursor.charge - 50);
                        }
                    }
                } else {
                    if (cursor.decay <= 0) cursor.charge = 0;
                    else cursor.decay = Math.max(0, cursor.decay - 1);
                }
                if (cursor.charge <= 0) {
                    if (name === 'minecraft:sculk_vein') dischargeVein(state, cursor.pos, context, read, directState, write);
                    continue;
                }
                const target = movementTarget(cursor.pos, origin, random, context, read, inTag);
                if (target) {
                    if (name === 'minecraft:sculk_vein') dischargeVein(state, cursor.pos, context, read, directState, write);
                    cursor.pos = target;
                    const moved = read(target);
                    if (blockName(moved) === 'minecraft:sculk_vein') cursor.facings = DIRECTIONS.filter(face => moved.properties?.[face] === 'true');
                } else cursor.charge = 0;
                cursor.delay = 1;
            }
        }
    }
    return true;
}

function canPlaceGrowth(pos, context, read, fluidAt, inTag) {
    const above = relative(pos, 'up'), state = read(above), fluid = fluidAt(above);
    if (!isAir(state) && !(blockName(state) === 'minecraft:water' && fluid.source && fluid.id === 'minecraft:water')) return false;
    let matches = 0;
    for (let z = -4; z <= 4; z++) for (let y = 0; y <= 2; y++) for (let x = -4; x <= 4; x++) {
        if (inTag(read({ x: pos.x + x, y: pos.y + y, z: pos.z + z }), 'minecraft:sculk_growth_inhibitors') && ++matches > 2) return false;
    }
    return true;
}

function regrowVein(pos, state, facings, vein, directState, write) {
    const properties = {};
    for (const face of facings) {
        const candidate = vein.placementState(state, pos, face);
        if (candidate) {
            properties[face] = 'true';
            if (candidate.properties?.waterlogged === 'true') properties.waterlogged = 'true';
        }
    }
    if (DIRECTIONS.some(face => properties[face] === 'true')) write(directState({ id: 'minecraft:sculk_vein', properties }), pos);
}

function decayPenalty(pos, origin, charge) {
    const distance = Math.fround(Math.sqrt(distance2(pos, origin)));
    const delta = Math.fround(distance - 1);
    const ratio = Math.min(1, Math.fround(Math.fround(delta * delta) / 529));
    return Math.max(1, Math.trunc(Math.fround(Math.fround(charge * ratio) * 0.5)));
}

function movementTarget(pos, origin, random, context, read, inTag) {
    const offsets = [];
    for (let z = -1; z <= 1; z++) for (let y = -1; y <= 1; y++) for (let x = -1; x <= 1; x++) {
        if ((x || y || z) && Math.abs(x) + Math.abs(y) + Math.abs(z) <= 2) offsets.push({ x, y, z });
    }
    let result = null;
    for (const offset of shuffled(offsets, random)) {
        const target = { x: pos.x + offset.x, y: pos.y + offset.y, z: pos.z + offset.z };
        if (distance2(target, origin) > 144) continue;
        const state = read(target), name = blockName(state);
        if (!isSculkBehaviour(state)) continue;
        if (!unobstructed(pos, target, context, read)) continue;
        result = target;
        if (name === 'minecraft:sculk_vein' && DIRECTIONS.some(face => state.properties?.[face] === 'true' && inTag(read(relative(target, face)), 'minecraft:sculk_replaceable'))) break;
    }
    return result;
}

function unobstructed(from, to, context, read) {
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    if (Math.abs(dx) + Math.abs(dy) + Math.abs(dz) === 1) return true;
    const axes = [['x', dx], ['y', dy], ['z', dz]].filter(([, d]) => d !== 0);
    return axes.some(([axis, delta]) => {
        const p = { ...from, [axis]: from[axis] + delta };
        const direction = axis === 'x' ? delta > 0 ? 'east' : 'west' : axis === 'y' ? delta > 0 ? 'up' : 'down' : delta > 0 ? 'south' : 'north';
        return !requireContext(context, 'isFaceSturdy')(p, opposite[direction]);
    });
}

function tryPlaceSculk(cursor, random, context, read, inTag, defaultState, directState, write, vein) {
    const state = read(cursor.pos);
    for (const face of shuffled(DIRECTIONS, random)) {
        if (state.properties?.[face] !== 'true') continue;
        const target = relative(cursor.pos, face), targetState = read(target);
        if (!inTag(targetState, 'minecraft:sculk_replaceable_world_gen')) continue;
        write(defaultState('minecraft:sculk'), target);
        const placed = read(target);
        vein.spreadAll(placed, target, true);
        for (const direction of DIRECTIONS) {
                if (direction !== opposite[face]) {
                    const neighbor = relative(target, direction), value = read(neighbor);
                if (blockName(value) === 'minecraft:sculk_vein') dischargeVein(value, neighbor, context, read, directState, write);
            }
        }
        return true;
    }
    return false;
}

function dischargeVein(state, pos, context, read, directState, write) {
    for (const face of DIRECTIONS) {
        if (state.properties?.[face] !== 'true') continue;
        if (blockName(read(relative(pos, face))) !== 'minecraft:sculk') continue;
        const props = { ...(state.properties ?? {}), [face]: 'false' };
        write(directState({ id: 'minecraft:sculk_vein', properties: props }), pos);
    }
}
