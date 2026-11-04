import test from 'node:test';
import assert from 'node:assert/strict';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';
import { findMobPath, isMobStableDestination } from '../../../src/js/net/minecraft/client/entity/MobNavigation.js';

test('bounded mob A* routes around a solid wall without stepping through it or unsupported air', () => {
    const solids = [];
    for (let x = -2; x <= 7; x++) for (let z = -12; z <= 12; z++) solids.push(new BoundingBox(x, 63, z, x + 1, 64, z + 1));
    for (let y = 64; y <= 66; y++) solids.push(new BoundingBox(2, y, -3, 3, y + 1, 4));
    const world = { getCollisionBoxes(region) { return solids.filter(box =>
        box.maxX > region.minX && box.minX < region.maxX && box.maxY > region.minY && box.minY < region.maxY &&
        box.maxZ > region.minZ && box.minZ < region.maxZ); } };
    const mob = { x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.95 };
    const path = findMobPath(world, mob, { x: 4.5, y: 64, z: 0.5 });
    assert.ok(path?.length > 2);
    assert.ok(path.some(point => Math.abs(point.z - 0.5) > 2.5), 'walks around the wall end');
    for (let i = 1; i < path.length; i++) {
        assert.ok(Math.abs(path[i].x - path[i - 1].x) <= 1);
        assert.ok(Math.abs(path[i].z - path[i - 1].z) <= 1);
    }
});

test('ground navigation does not cut diagonally through a blocked corner', () => {
    const floor = [];
    for (let x = -2; x <= 4; x++) for (let z = -2; z <= 4; z++) {
        floor.push(new BoundingBox(x, 63, z, x + 1, 64, z + 1));
    }
    const corner = new BoundingBox(1, 64, 0, 2, 66, 1);
    const world = {
        getCollisionBoxes(region) {
            return [...floor, corner].filter(box =>
                box.maxX > region.minX && box.minX < region.maxX && box.maxY > region.minY && box.minY < region.maxY &&
                box.maxZ > region.minZ && box.minZ < region.maxZ);
        }
    };
    const path = findMobPath(world, { x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.95 },
        { x: 2.5, y: 64, z: 2.5 });
    assert.ok(path?.length > 2, 'routes through a cardinal node instead of crossing the blocked corner');
    assert.ok(!path.some((point, index) => index > 0 &&
        Math.floor(point.x) === 1 && Math.floor(point.z) === 1 &&
        Math.floor(path[index - 1].x) === 0 && Math.floor(path[index - 1].z) === 0),
    'does not take the diagonal transition across the blocked east corner');
});

test('path target accuracy uses the vanilla one-block Manhattan tolerance', () => {
    const floor = [];
    for (let x = -2; x <= 3; x++) for (let z = -2; z <= 3; z++) {
        floor.push(new BoundingBox(x, 63, z, x + 1, 64, z + 1));
    }
    const world = { getCollisionBoxes(region) { return floor.filter(box =>
        box.maxX > region.minX && box.minX < region.maxX && box.maxY > region.minY && box.minY < region.maxY &&
        box.maxZ > region.minZ && box.minZ < region.maxZ); } };
    const path = findMobPath(world, { x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.95 },
        { x: 1.5, y: 64, z: 1.5 });
    assert.ok(path?.length > 1, 'diagonal target is not considered reached at the starting node');
    const end = path.at(-1);
    assert.ok(Math.abs(Math.floor(end.x) - 1) + Math.abs(Math.floor(end.y) - 64) + Math.abs(Math.floor(end.z) - 1) <= 1);
});

test('random stroll rejects destinations with non-zero vanilla pathfinding malus', () => {
    const floor = new BoundingBox(0, 63, 0, 1, 64, 1);
    const world = {
        getCollisionBoxes(region) {
            return floor.maxX > region.minX && floor.minX < region.maxX && floor.maxY > region.minY && floor.minY < region.maxY &&
                floor.maxZ > region.minZ && floor.minZ < region.maxZ ? [floor] : [];
        },
        getPathfindingMalusAt: () => 8
    };
    const mob = { entityType: 'minecraft:zombie', width: 0.6, height: 1.95 };
    assert.equal(isMobStableDestination(world, mob, 0, 64, 0), false,
        'stable ground is still rejected when its vanilla path type has non-zero malus');
    world.getPathfindingMalusAt = () => 0;
    assert.equal(isMobStableDestination(world, mob, 0, 64, 0), true);
});

test('only door-capable zombies path through registered oak doors', () => {
    const floor = new Set();
    for (let x = -2; x <= 7; x++) for (let z = -12; z <= 12; z++) floor.add(`${x},63,${z}`);
    const world = {
        difficulty: 'hard',
        getBlockAt(x, y, z) {
            if (x !== 2 || (y !== 64 && y !== 65)) return 0;
            return z === 0 ? (y === 64 ? 160 : 161) : 1;
        },
        getBlockCollisionBoxesAt(x, y, z) {
            if (x === 2 && z >= -3 && z <= 4 && (y === 64 || y === 65)) {
                return [z === 0 ? new BoundingBox(2, y, 0, 3, y + 1, 1) : new BoundingBox(2, y, z, 3, y + 1, z + 1)];
            }
            if (floor.has(`${x},${y},${z}`)) return [new BoundingBox(x, y, z, x + 1, y + 1, z + 1)];
            return [];
        },
        getCollisionBoxes(region) {
            const boxes = [];
            for (let x = Math.floor(region.minX); x <= Math.floor(region.maxX); x++) {
                for (let y = Math.floor(region.minY); y <= Math.floor(region.maxY + 1); y++) {
                    for (let z = Math.floor(region.minZ); z <= Math.floor(region.maxZ); z++) {
                        boxes.push(...this.getBlockCollisionBoxesAt(x, y, z));
                    }
                }
            }
            return boxes;
        }
    };
    const start = { x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.95 };
    const ordinaryPath = findMobPath(world, { ...start }, { x: 4.5, y: 64, z: 0.5 });
    assert.ok(ordinaryPath?.some(point => Math.abs(point.z - 0.5) > 1.5), JSON.stringify(ordinaryPath));
    const zombiePath = findMobPath(world, { ...start, canBreakDoors: true }, { x: 4.5, y: 64, z: 0.5 });
    assert.ok(zombiePath?.some(point => Math.floor(point.x) === 2 && Math.abs(point.z - 0.5) < 0.6));
});

test('Drowned amphibious pathfinding steers through water around underwater walls', () => {
    const solids = [];
    for (let x = -2; x <= 7; x++) for (let z = -6; z <= 6; z++) {
        solids.push(new BoundingBox(x, 63, z, x + 1, 64, z + 1));
    }
    for (let y = 64; y <= 66; y++) solids.push(new BoundingBox(2, y, -2, 3, y + 1, 3));
    const world = {
        getCollisionBoxes(region) { return solids.filter(box =>
            box.maxX > region.minX && box.minX < region.maxX && box.maxY > region.minY && box.minY < region.maxY &&
            box.maxZ > region.minZ && box.minZ < region.maxZ); },
        getFluidState(x, y, z) {
            return x >= -1 && x <= 6 && z >= -5 && z <= 5 && (y === 64 || y === 65)
                ? { empty: false, name: 'minecraft:water' }
                : { empty: true, name: 'minecraft:empty' };
        }
    };
    const mob = { entityType: 'minecraft:drowned', x: 0.5, y: 64, z: 0.5, width: 0.6, height: 1.95 };
    const path = findMobPath(world, mob, { x: 5.5, y: 64, z: 0.5 });
    assert.ok(path?.length > 3);
    assert.ok(path.some(point => Math.abs(point.z - 0.5) > 2.5), 'swims around the submerged wall');
    assert.ok(path.every(point => world.getFluidState(Math.floor(point.x), Math.floor(point.y), Math.floor(point.z)).name === 'minecraft:water' ||
        world.getFluidState(Math.floor(point.x), Math.floor(point.y + 1), Math.floor(point.z)).name === 'minecraft:water'),
    'every route node remains in water or at the water surface');
});
