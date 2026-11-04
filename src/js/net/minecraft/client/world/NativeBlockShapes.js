const directions = {
    north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0]
};
const opposite = { north: 'south', south: 'north', west: 'east', east: 'west' };
const left = { north: 'west', west: 'south', south: 'east', east: 'north' };
const right = { north: 'east', east: 'south', south: 'west', west: 'north' };
const axis = direction => direction === 'north' || direction === 'south' ? 'z' : 'x';

function at(world, x, y, z, direction) {
    const [dx, dz] = directions[direction];
    return world.getNativeBlockStateAt?.(x + dx, y, z + dz);
}

function isStair(state) {
    return state?.name?.endsWith('_stairs') && state.properties?.facing && state.properties?.half;
}

// StairBlock.getStairsShape and canTakeShape from the reference client.
export function nativeStairShape(world, x, y, z, facing, half) {
    if (!directions[facing]) return 'straight';
    const canTakeShape = direction => {
        const state = at(world, x, y, z, direction);
        return !isStair(state) || state.properties.facing !== facing || state.properties.half !== half;
    };
    const front = at(world, x, y, z, facing);
    if (isStair(front) && front.properties.half === half && axis(front.properties.facing) !== axis(facing) &&
        canTakeShape(opposite[front.properties.facing])) {
        return front.properties.facing === left[facing] ? 'outer_left' : 'outer_right';
    }
    const back = at(world, x, y, z, opposite[facing]);
    if (isStair(back) && back.properties.half === half && axis(back.properties.facing) !== axis(facing) &&
        canTakeShape(back.properties.facing)) {
        return back.properties.facing === left[facing] ? 'inner_left' : 'inner_right';
    }
    return 'straight';
}

// DoorBlock.getHinge prioritizes adjacent doors and full collision blocks,
// then uses the hit position when both sides are otherwise equivalent.
export function nativeDoorHinge(world, x, y, z, facing, hit) {
    const [lx, lz] = directions[left[facing]];
    const [rx, rz] = directions[right[facing]];
    const stateAt = (dx, dy, dz) => world.getNativeBlockStateAt?.(x + dx, y + dy, z + dz);
    const full = (dx, dy, dz) => {
        const shape = world.getNativeBlockShapeAt?.(x + dx, y + dy, z + dz, true);
        return !!shape?.some(box => box[0] <= 0 && box[1] <= 0 && box[2] <= 0 && box[3] >= 1 && box[4] >= 1 && box[5] >= 1);
    };
    const score = -Number(full(lx, 0, lz)) - Number(full(lx, 1, lz)) + Number(full(rx, 0, rz)) + Number(full(rx, 1, rz));
    const lowerDoor = state => state?.name?.endsWith('_door') && state.properties?.half === 'lower';
    const leftDoor = lowerDoor(stateAt(lx, 0, lz));
    const rightDoor = lowerDoor(stateAt(rx, 0, rz));
    if (leftDoor && !rightDoor || score > 0) return 'right';
    if (rightDoor && !leftDoor || score < 0) return 'left';
    const [dx, dz] = directions[facing];
    const hitX = (hit.vector?.x ?? x + .5) - x;
    const hitZ = (hit.vector?.z ?? z + .5) - z;
    return (dx < 0 && hitZ < .5 || dx > 0 && hitZ > .5 || dz < 0 && hitX > .5 || dz > 0 && hitX < .5) ? 'right' : 'left';
}
