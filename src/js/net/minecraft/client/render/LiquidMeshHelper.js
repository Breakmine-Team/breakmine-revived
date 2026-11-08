import Block from "../world/block/Block.js";

export function getLiquidBlockHeight(world, x, y, z, liquidId) {
    const typeId = world.getBlockAt(x, y, z);
    
    if (typeId !== liquidId) {
        return -1.0;
    }

    const data = world.getBlockDataAt(x, y, z);
    if ((data & 8) !== 0) {
        return 1.0; 
    }

    const level = data & 7;
    const block = Block.getById(liquidId);
    const maxDistance = block && block.maxDistance ? block.maxDistance : 7;
    return ((maxDistance + 1 - level) / (maxDistance + 1)) * 15 / 16;
}

export function getLiquidCornerHeight(world, x, y, z, cornerX, cornerZ, liquidId) {
    for (let dx = cornerX - 1; dx <= cornerX; dx++) {
        for (let dz = cornerZ - 1; dz <= cornerZ; dz++) {
            if (world.getBlockAt(x + dx, y + 1, z + dz) === liquidId) {
                return 1.0;
            }
        }
    }

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

export function getLiquidBlockCornerHeights(world, x, y, z, liquidId) {
    return {
        h00: getLiquidCornerHeight(world, x, y, z, 0, 0, liquidId), 
        h10: getLiquidCornerHeight(world, x, y, z, 1, 0, liquidId), 
        h11: getLiquidCornerHeight(world, x, y, z, 1, 1, liquidId), 
        h01: getLiquidCornerHeight(world, x, y, z, 0, 1, liquidId)  
    };
}