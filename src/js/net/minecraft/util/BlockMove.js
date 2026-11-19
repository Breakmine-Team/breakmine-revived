// Shared helpers for blocks that change cells (falling blocks, push blocks).

// First cell below (x, y, z) that has something solid underneath it.
export function findLandingY(world, x, y, z) {
    let landingY = y - 1;

    while (landingY > 0 && !world.isSolidBlockAt(x, landingY - 1, z)) {
        landingY--;
    }

    return landingY;
}

// Ask the world to move a block one time. A server applies the move to the
// world data and broadcasts it, clients then animate the change they receive.
export function moveBlock(world, fromX, fromY, fromZ, toX, toY, toZ, duration) {
    if (typeof world.applyBlockMove === "function") {
        return world.applyBlockMove(fromX, fromY, fromZ, toX, toY, toZ);
    }

    if (typeof world.animateBlockMove === "function" && world.isFieldLocalWorld !== true) {
        return world.animateBlockMove(fromX, fromY, fromZ, toX, toY, toZ, duration, {
            allowNonSolid: true
        });
    }

    return false;
}

// Drop a block to the first solid cell below it in one move, so it slides the
// whole way instead of stepping one cell at a time.
export function startFall(world, x, y, z, msPerBlock) {
    if (y <= 0) return false;
    if (typeof world.isSolidBlockAt !== "function") return false;
    if (world.isSolidBlockAt(x, y - 1, z)) return false;

    const landingY = findLandingY(world, x, y, z);
    const distance = y - landingY;
    if (distance <= 0) return false;

    const duration = Math.min(700, msPerBlock + distance * msPerBlock);
    return moveBlock(world, x, y, z, x, landingY, z, duration);
}
