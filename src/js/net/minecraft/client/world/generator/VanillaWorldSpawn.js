import rules from '../../../../../../../packages/vanilla-worldgen/generated/block-rules.json' with { type: 'json' };

function blockAt(chunk, x, y, z) {
    if (y < chunk.minY || y >= chunk.minY + chunk.height) return 0;
    const localX = x - chunk.chunkX * 16, localZ = z - chunk.chunkZ * 16;
    if (localX < 0 || localX > 15 || localZ < 0 || localZ > 15) return 0;
    return chunk.blocks[(y - chunk.minY) * 256 + localZ * 16 + localX];
}

export function findDrySurface(chunk, localX, localZ) {
    const column = localZ * 16 + localX;
    const surface = Math.min(chunk.minY + chunk.height - 1, chunk.heightmap[column] - 1);
    if (surface < chunk.minY || chunk.heightmap[column] <= chunk.minY) return null;
    const groundId = blockAt(chunk, chunk.chunkX * 16 + localX, surface, chunk.chunkZ * 16 + localZ);
    const ground = rules.states[groundId];
    if (!ground?.solid || !ground.sturdyUp || !ground.fluidEmpty) return null;
    for (let dy = 1; dy <= 2; dy++) {
        const above = rules.states[blockAt(chunk, chunk.chunkX * 16 + localX, surface + dy, chunk.chunkZ * 16 + localZ)];
        if (!above || above.solid || !above.fluidEmpty) return null;
    }
    return surface;
}

function ringCoordinates(radius) {
    const coordinates = [];
    for (let dx = -radius; dx <= radius; dx++) for (let dz = -radius; dz <= radius; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) === radius) coordinates.push([dx, dz]);
    }
    return coordinates.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - a[1] ** 2 || a[0] - b[0] || a[1] - b[1]);
}

function nearestSurface(chunk, originX, originZ) {
    let best = null;
    for (let localZ = 0; localZ < 16; localZ++) for (let localX = 0; localX < 16; localX++) {
        const y = findDrySurface(chunk, localX, localZ);
        if (y === null) continue;
        const x = chunk.chunkX * 16 + localX, z = chunk.chunkZ * 16 + localZ;
        const distanceSquared = (x + 0.5 - originX) ** 2 + (z + 0.5 - originZ) ** 2;
        if (!best || distanceSquared < best.distanceSquared || distanceSquared === best.distanceSquared && (x < best.x || x === best.x && z < best.z)) {
            best = { x, y: y + 1, z, distanceSquared, chunk };
        }
    }
    return best;
}

export async function findNearestDrySpawn(source, centerChunk, { maxChunkRadius = 16, onSearch = () => {} } = {}) {
    if (!Number.isInteger(maxChunkRadius) || maxChunkRadius < 0 || maxChunkRadius > 64) throw new RangeError('Invalid spawn search radius');
    const originX = centerChunk.chunkX * 16 + 8, originZ = centerChunk.chunkZ * 16 + 8;
    for (let radius = 0; radius <= maxChunkRadius; radius++) {
        onSearch(radius, maxChunkRadius);
        let chunks;
        if (radius === 0) chunks = [centerChunk];
        else {
            const offsets = ringCoordinates(radius), found = [];
            // Keep each in-flight group bounded while still feeding all terrain workers.
            for (let offset = 0; offset < offsets.length; offset += 16) {
                const groups = [];
                for (let index = offset; index < Math.min(offset + 16, offsets.length); index += 4) {
                    groups.push(source.getTerrainChunksAtAsync(offsets.slice(index, index + 4).map(([dx, dz]) =>
                        [centerChunk.chunkX + dx, centerChunk.chunkZ + dz])));
                }
                for (const group of await Promise.all(groups)) found.push(...group);
            }
            chunks = found;
        }
        const candidates = chunks.map(chunk => nearestSurface(chunk, originX, originZ)).filter(Boolean);
        if (candidates.length) {
            candidates.sort((a, b) => a.distanceSquared - b.distanceSquared || a.x - b.x || a.z - b.z);
            const { distanceSquared, ...spawn } = candidates[0];
            return spawn;
        }
    }
    throw new Error(`No dry, solid spawn surface found within ${maxChunkRadius} chunks of the world origin`);
}
