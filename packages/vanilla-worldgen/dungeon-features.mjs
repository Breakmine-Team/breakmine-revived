import { blockName, relative, requireContext } from './feature-world.mjs';
import { shuffled } from './java-legacy-random.mjs';

const horizontal = ['north', 'east', 'south', 'west'];
const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
const air = state => ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(blockName(state));
export const DUNGEON_FEATURE_TYPES = new Set(['minecraft:bonus_chest', 'minecraft:monster_room']);

export function assignContainerLoot(context, random, pos, table) {
    if (requireContext(context, 'hasLootContainer')(pos)) requireContext(context, 'setLootTable')(pos, table, random.nextLong());
}

export function reorientChest(pos, state, context, directState) {
    const read = requireContext(context, 'getBlockState'), solid = requireContext(context, 'isSolidRender');
    let wall = null;
    for (const direction of horizontal) {
        const neighbor = relative(pos, direction);
        if (blockName(read(neighbor)) === 'minecraft:chest') return state;
        if (solid(neighbor)) {
            if (wall != null) { wall = null; break; }
            wall = direction;
        }
    }
    let facing = state.properties.facing;
    if (wall != null) facing = opposite[wall];
    else {
        if (solid(relative(pos, facing))) facing = opposite[facing];
        if (solid(relative(pos, facing))) facing = horizontal[(horizontal.indexOf(facing) + 1) % 4];
        if (solid(relative(pos, facing))) facing = opposite[facing];
    }
    return directState({ id: state.name, properties: { ...state.properties, facing } });
}

export function placeDungeonFeature(feature, origin, random, { context, directState, setBlock, canSurvive }) {
    const read = requireContext(context, 'getBlockState');
    const defaultState = name => {
        const state = requireContext(context, 'getDefaultBlockState')(name);
        return directState({ id: blockName(state), properties: state.properties ?? {} });
    };
    if (feature.type === 'minecraft:bonus_chest') {
        const chunkX = Math.floor(origin.x / 16) * 16, chunkZ = Math.floor(origin.z / 16) * 16;
        const xs = shuffled(Array.from({ length: 16 }, (_, i) => chunkX + i), random);
        const zs = shuffled(Array.from({ length: 16 }, (_, i) => chunkZ + i), random);
        for (const x of xs) for (const z of zs) {
            const pos = { x, y: requireContext(context, 'getHeight')('MOTION_BLOCKING_NO_LEAVES', x, z), z };
            if (!air(read(pos)) && !requireContext(context, 'isCollisionShapeEmpty')(pos)) continue;
            setBlock(defaultState('minecraft:chest'), pos, 2);
            assignContainerLoot(context, random, pos, 'minecraft:chests/spawn_bonus_chest');
            const torch = defaultState('minecraft:torch');
            for (const direction of horizontal) {
                const neighbor = relative(pos, direction);
                if (canSurvive(torch, neighbor)) setBlock(torch, neighbor, 2);
            }
            return true;
        }
        return false;
    }
    if (feature.type !== 'minecraft:monster_room') throw new Error(`Unsupported dungeon feature: ${feature.type}`);
    const solid = requireContext(context, 'isSolid');
    if (!Number.isInteger(context.minY)) throw new TypeError('Monster room requires context.minY');
    const radiusX = random.nextInt(2) + 2, radiusZ = random.nextInt(2) + 2;
    const rx = radiusX + 1, rz = radiusZ + 1;
    const posAt = (x, y, z) => ({ x: origin.x + x, y: origin.y + y, z: origin.z + z });
    let openings = 0;
    for (let x = -rx; x <= rx; x++) for (let y = -1; y <= 4; y++) for (let z = -rz; z <= rz; z++) {
        const pos = posAt(x, y, z);
        const isSolid = solid(pos);
        if ((y === -1 || y === 4) && !isSolid) return false;
        if ((Math.abs(x) === rx || Math.abs(z) === rz) && y === 0 && air(read(pos)) && air(read(relative(pos, 'up')))) openings++;
    }
    if (openings < 1 || openings > 5) return false;
    const safeSet = (state, pos) => {
        if (!requireContext(context, 'isBlockInTag')(read(pos), 'minecraft:features_cannot_replace')) setBlock(state, pos, 2);
    };
    const empty = defaultState('minecraft:cave_air');
    for (let x = -rx; x <= rx; x++) for (let y = 3; y >= -1; y--) for (let z = -rz; z <= rz; z++) {
        const pos = posAt(x, y, z), name = blockName(read(pos));
        if (Math.abs(x) === rx || y === -1 || Math.abs(z) === rz) {
            if (pos.y >= context.minY && !solid(relative(pos, 'down'))) setBlock(empty, pos, 2);
            else if (solid(pos) && name !== 'minecraft:chest') {
                const mossy = y === -1 && random.nextInt(4) !== 0;
                safeSet(defaultState(mossy ? 'minecraft:mossy_cobblestone' : 'minecraft:cobblestone'), pos);
            }
        } else if (!['minecraft:chest', 'minecraft:spawner'].includes(name)) safeSet(empty, pos);
    }
    for (let chest = 0; chest < 2; chest++) for (let attempt = 0; attempt < 3; attempt++) {
        const pos = posAt(random.nextInt(radiusX * 2 + 1) - radiusX, 0, random.nextInt(radiusZ * 2 + 1) - radiusZ);
        if (!air(read(pos)) || horizontal.filter(direction => solid(relative(pos, direction))).length !== 1) continue;
        safeSet(reorientChest(pos, defaultState('minecraft:chest'), context, directState), pos);
        assignContainerLoot(context, random, pos, 'minecraft:chests/simple_dungeon');
        break;
    }
    safeSet(defaultState('minecraft:spawner'), origin);
    if (requireContext(context, 'hasSpawnerBlockEntity')(origin)) {
        const mob = ['minecraft:skeleton', 'minecraft:zombie', 'minecraft:zombie', 'minecraft:spider'][random.nextInt(4)];
        requireContext(context, 'setSpawnerEntity')(origin, mob, random);
    }
    return true;
}
