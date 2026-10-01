import Block from "../world/block/Block.js";

/**
 * Returns raw height factor [0.0 ... 1.0] for a single block position.
 */
export function getLiquidBlockHeight(world, x, y, z, liquidId) {
    const typeId = world.getBlockAt(x, y, z);
    
    if (typeId !== liquidId) {
        // Only water columns influence the surface height: walls, air and other
        // blocks stay out of the corner-height average so water never snaps up
        // to a solid neighbor.
        return -1.0;
    }

    const data = world.getBlockDataAt(x, y, z);
    if ((data & 8) !== 0) {
        return 1.0; // Falling liquid uses full height
    }

    const level = data & 7;
    // Scale the height to the liquid's own spread range so lava (which only
    // flows a short distance) thins out faster than water. Level 0 is always
    // full height and the max flow level reaches the minimum.
    const block = Block.getById(liquidId);
    const maxDistance = block && block.maxDistance ? block.maxDistance : 7;
    return ((maxDistance + 1 - level) / (maxDistance + 1)) * 15 / 16;
}

/**
 * Calculates smooth corner vertex Y-offset (0.0 to 1.0) for a given corner.
 * @param {World} world 
 * @param {number} x - Block X position
 * @param {number} y - Block Y position
 * @param {number} z - Block Z position
 * @param {number} cornerX - Corner relative X offset (0 or 1)
 * @param {number} cornerZ - Corner relative Z offset (0 or 1)
 * @param {number} liquidId - Target liquid block ID
 */
export function getLiquidCornerHeight(world, x, y, z, cornerX, cornerZ, liquidId) {
    // 1. If liquid exists at (y + 1) in any adjacent column, force vertex height to 1.0
    for (let dx = cornerX - 1; dx <= cornerX; dx++) {
        for (let dz = cornerZ - 1; dz <= cornerZ; dz++) {
            if (world.getBlockAt(x + dx, y + 1, z + dz) === liquidId) {
                return 1.0;
            }
        }
    }

    // 2. Average liquid heights across the 4 block columns sharing this corner vertex
    let totalHeight = 0;
    let count = 0;

    for (let dx = cornerX - 1; dx <= cornerX; dx++) {
        for (let dz = cornerZ - 1; dz <= cornerZ; dz++) {
            const height = getLiquidBlockHeight(world, x + dx, y, z + dz, liquidId);
            if (height >= 0) {
                totalHeight += height;
                count++;
            }
        }
    }

    if (count === 0) {
        return 1.0;
    }

    return totalHeight / count;
}

/**
 * Convenience function returning heights for all 4 corners of a liquid top surface.
 */
export function getLiquidBlockCornerHeights(world, x, y, z, liquidId) {
    return {
        h00: getLiquidCornerHeight(world, x, y, z, 0, 0, liquidId), // NW (0, 0)
        h10: getLiquidCornerHeight(world, x, y, z, 1, 0, liquidId), // NE (1, 0)
        h11: getLiquidCornerHeight(world, x, y, z, 1, 1, liquidId), // SE (1, 1)
        h01: getLiquidCornerHeight(world, x, y, z, 0, 1, liquidId)  // SW (0, 1)
    };
}