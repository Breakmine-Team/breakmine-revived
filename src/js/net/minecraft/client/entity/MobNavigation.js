import BoundingBox from '../../util/BoundingBox.js';
import { BlockRegistry } from '../world/block/BlockRegistry.js';
import { isFluidType } from '../../../../../../packages/vanilla-worldgen/fluid-state.mjs';

const MAX_VISITED = 420;
const SEARCH_RADIUS = 10;

function intersects(a, b) {
    return a.maxX > b.minX && a.minX < b.maxX && a.maxY > b.minY && a.minY < b.maxY && a.maxZ > b.minZ && a.minZ < b.maxZ;
}

function collisionBoxes(world, region, ignoreDoors = false) {
    if (!ignoreDoors || typeof world.getBlockCollisionBoxesAt !== 'function') return world.getCollisionBoxes(region);
    const boxes = [];
    const minX = Math.floor(region.minX), maxX = Math.floor(region.maxX + 1);
    const minY = Math.floor(region.minY), maxY = Math.floor(region.maxY + 2);
    const minZ = Math.floor(region.minZ), maxZ = Math.floor(region.maxZ + 1);
    for (let bx = minX; bx < maxX; bx++) {
        for (let by = minY; by < maxY; by++) {
            for (let bz = minZ; bz < maxZ; bz++) {
                const id = world.getBlockAt(bx, by, bz);
                // Oak is currently the only wooden door in this game's registry.
                if (id === 160 || id === 161) continue;
                boxes.push(...world.getBlockCollisionBoxesAt(bx, by, bz));
            }
        }
    }
    return boxes;
}

function canStand(world, x, y, z, width, height, mob = null) {
    const half = width * 0.5;
    const body = new BoundingBox(x + 0.5 - half, y + 0.04, z + 0.5 - half,
        x + 0.5 + half, y + height - 0.04, z + 0.5 + half);
    // Zombie.finalizeSpawn enables door-aware path evaluation independently
    // from the gamerule/difficulty predicate used by BreakDoorGoal itself.
    const allowDoor = !!mob?.canBreakDoors;
    if (collisionBoxes(world, body, allowDoor).some(box => intersects(body, box))) return false;
    const foot = new BoundingBox(body.minX + 0.02, y - 0.08, body.minZ + 0.02,
        body.maxX - 0.02, y + 0.015, body.maxZ - 0.02);
    return collisionBoxes(world, foot, allowDoor).some(box => intersects(foot, box) && Math.abs(box.maxY - y) < 0.26);
}

export function isMobStableDestination(world, mob, x, y, z) {
    const pathfindingMalus = world.getPathfindingMalusAt?.(x, y, z, mob);
    if (Number.isFinite(pathfindingMalus) && pathfindingMalus !== 0) return false;
    if (mob.entityType === 'minecraft:drowned') {
        const belowFluid = world.getFluidState?.(x, y - 1, z);
        const supportedByWater = belowFluid != null
            ? !belowFluid.empty && (belowFluid.name ?? belowFluid.id) === 'minecraft:water'
            : hasWater(world, x, y - 1, z);
        if (supportedByWater && canSwim(world, x, y, z, mob.width, mob.height)) return true;
    }
    return canStand(world, x, y, z, mob.width, mob.height, mob);
}

function hasWater(world, x, y, z) {
    const fluid = world.getFluidState?.(x, y, z);
    if (fluid != null) return isFluidType(fluid, 'water');
    const waterId = BlockRegistry.WATER?.getId?.();
    return waterId !== undefined && world.getBlockAt?.(x, y, z) === waterId;
}

function canSwim(world, x, y, z, width, height) {
    const half = width * 0.5;
    const body = new BoundingBox(x + 0.5 - half, y + 0.04, z + 0.5 - half,
        x + 0.5 + half, y + height - 0.04, z + 0.5 + half);
    if (world.getCollisionBoxes(body).some(box => intersects(body, box))) return false;
    // Amphibious path nodes can be water or supported land. Check each block
    // intersected by the mob's body so shallow fluid and low ceilings behave
    // like the actual hitbox rather than a center-point-only water probe.
    const minY = Math.floor(body.minY), maxY = Math.floor(body.maxY - 1e-6);
    for (let blockY = minY; blockY <= maxY; blockY++) {
        if (hasWater(world, x, blockY, z)) return true;
    }
    return canStand(world, x, y, z, width, height);
}

function heuristic(a, b) { return Math.abs(a.x - b.x) + Math.abs(a.z - b.z) + Math.abs(a.y - b.y) * 1.35; }

/** Bounded A* over supported ground or water nodes; never routes into unsupported air. */
export function findMobPath(world, mob, target) {
    if (!world?.getCollisionBoxes || !target) return null;
    const start = { x: Math.floor(mob.x), y: Math.floor(mob.y + 0.001), z: Math.floor(mob.z) };
    const goal = { x: Math.floor(target.x), y: Math.floor(target.y + 0.001), z: Math.floor(target.z) };
    const keyOf = node => `${node.x},${node.y},${node.z}`;
    const startKey = keyOf(start);
    const goalKey = keyOf(goal);
    const amphibious = mob.entityType === 'minecraft:drowned';
    const open = [{ ...start, key: startKey, g: 0, f: heuristic(start, goal), parent: null }];
    const bestCost = new Map([[startKey, 0]]);
    const closed = new Set();
    let visited = 0;
    let end = null;

    while (open.length && visited++ < MAX_VISITED) {
        let bestIndex = 0;
        for (let i = 1; i < open.length; i++) if (open[i].f < open[bestIndex].f) bestIndex = i;
        const current = open.splice(bestIndex, 1)[0];
        if (closed.has(current.key)) continue;
        closed.add(current.key);
        // PathNavigation.moveTo(entity, speed) requests a PathFinder target
        // accuracy of one block; PathFinder applies Manhattan distance, not
        // a spherical radius (which incorrectly treats diagonal neighbors as
        // already reached).
        if (Math.abs(current.x - goal.x) + Math.abs(current.y - goal.y) + Math.abs(current.z - goal.z) <= 1) {
            end = current;
            break;
        }

        const neighbors = amphibious
            ? [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]]
            : [[1, 1, 0], [1, 0, 0], [1, -1, 0], [-1, 1, 0], [-1, 0, 0], [-1, -1, 0],
                [0, 1, 1], [0, 0, 1], [0, -1, 1], [0, 1, -1], [0, 0, -1], [0, -1, -1]];
        for (const [dx, dy, dz] of neighbors) {
            const x = current.x + dx, y = current.y + dy, z = current.z + dz;
            if (Math.abs(x - start.x) > SEARCH_RADIUS || Math.abs(z - start.z) > SEARCH_RADIUS) continue;
            if (Math.abs(y - start.y) > (amphibious ? 8 : 3)) continue;
            // WalkNodeEvaluator validates both cardinal neighbors before it
            // accepts a diagonal. Without this, A* can route through the
            // corner of a solid block even though the mob's hitbox cannot.
            if (!amphibious && dx !== 0 && dz !== 0 && (
                dy > 0 ||
                !canStand(world, current.x + dx, current.y, current.z, mob.width, mob.height, mob) ||
                !canStand(world, current.x, current.y, current.z + dz, mob.width, mob.height, mob)
            )) continue;
            const canOccupy = amphibious
                ? canSwim(world, x, y, z, mob.width, mob.height)
                : canStand(world, x, y, z, mob.width, mob.height, mob);
            if (!canOccupy) continue;
            const key = `${x},${y},${z}`;
            if (closed.has(key)) continue;
            const g = current.g + 1 + Math.abs(dy) * 0.35;
            if (g >= (bestCost.get(key) ?? Infinity)) continue;
            bestCost.set(key, g);
            open.push({ x, y, z, key, g, f: g + heuristic({ x, y, z }, goal), parent: current });
        }
    }
    if (!end) return null;
    const path = [];
    for (let node = end; node; node = node.parent) path.push({ x: node.x + 0.5, y: node.y, z: node.z + 0.5 });
    path.reverse();
    return path;
}
