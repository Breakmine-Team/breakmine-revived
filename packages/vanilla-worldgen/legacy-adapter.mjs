const LEGACY_COLUMN_HEIGHT = 256;

const LEGACY_BLOCK_IDS_BY_NAME = new Map([
    ['minecraft:air', 0],
    ['minecraft:stone', 1],
    ['minecraft:grass_block', 2],
    ['minecraft:dirt', 3],
    ['minecraft:cobblestone', 4],
    ['minecraft:oak_planks', 5],
    ['minecraft:mossy_cobblestone', 6],
    ['minecraft:bedrock', 7],
    ['minecraft:water', 9],
    ['minecraft:sand', 12],
    ['minecraft:gravel', 13],
    ['minecraft:oak_log', 17],
    ['minecraft:oak_leaves', 18],
    ['minecraft:bricks', 33],
    ['minecraft:lava', 55],
    ['minecraft:clay', 138],
    ['minecraft:terracotta', 139]
]);

export function createLegacyStateIdMap(stateEntries) {
    if (!Array.isArray(stateEntries)) throw new TypeError('Expected vanilla block-state registry entries');
    const mapping = new Map();
    const namesById = new Map();
    for (const entry of stateEntries) {
        if (!entry || !Number.isInteger(entry.id) || entry.id < 0 || entry.id > 0xffffffff || typeof entry.name !== 'string') {
            throw new TypeError('Invalid vanilla block-state registry entry');
        }
        const name = entry.name.includes(':') ? entry.name : `minecraft:${entry.name}`;
        const previousName = namesById.get(entry.id);
        if (previousName && previousName !== name) throw new Error(`Conflicting block names for vanilla state ${entry.id}`);
        namesById.set(entry.id, name);
        const legacyId = LEGACY_BLOCK_IDS_BY_NAME.get(name);
        if (legacyId !== undefined) mapping.set(entry.id, legacyId);
    }
    return mapping;
}

function legacyMetadata(name, properties = {}) {
    if (name === 'minecraft:water' || name === 'minecraft:lava') {
        const level = Number(properties.level ?? 0);
        if (!Number.isInteger(level) || level < 0 || level > 15) throw new RangeError(`Invalid ${name} level`);
        return level;
    }
    if (name === 'minecraft:oak_log') {
        const axis = properties.axis ?? 'y';
        if (axis === 'y') return 0;
        if (axis === 'x') return 1;
        if (axis === 'z') return 2;
        throw new RangeError(`Unsupported oak log axis: ${axis}`);
    }
    return 0;
}

export function createLegacyBlockStateMap(stateEntries) {
    if (!Array.isArray(stateEntries)) throw new TypeError('Expected vanilla block-state registry entries');
    const blockIds = createLegacyStateIdMap(stateEntries);
    const statesById = new Map(stateEntries.map(entry => [entry.id, entry]));
    const mapping = new Map();
    for (const [stateId, blockId] of blockIds) {
        const entry = statesById.get(stateId);
        const metadata = legacyMetadata(entry.name.includes(':') ? entry.name : `minecraft:${entry.name}`, entry.properties);
        mapping.set(stateId, (blockId << 4) | metadata);
    }
    return mapping;
}

function getMappedBlockId(mapping, stateId) {
    const value = mapping instanceof Map ? mapping.get(stateId) : mapping[stateId];
    if (!Number.isInteger(value) || value < 0 || value > 255) {
        throw new RangeError(`Missing or invalid legacy block ID for vanilla state ${stateId}`);
    }
    return value;
}

export function toLegacyBlockColumn(chunk, blockIdByState) {
    if (!chunk || !(chunk.blocks instanceof Uint32Array) || typeof chunk.index !== 'function') {
        throw new TypeError('Expected a VanillaChunk');
    }
    if (!(blockIdByState instanceof Map) && (!blockIdByState || typeof blockIdByState !== 'object')) {
        throw new TypeError('Expected an explicit vanilla-state to legacy block-ID map');
    }
    if (chunk.minY < 0 || chunk.minY + chunk.height > LEGACY_COLUMN_HEIGHT) {
        throw new RangeError(`Chunk vertical range must fit inside legacy Y 0..${LEGACY_COLUMN_HEIGHT - 1}`);
    }

    const column = new Uint8Array(16 * LEGACY_COLUMN_HEIGHT * 16);
    for (let y = chunk.minY; y < chunk.minY + chunk.height; y++) {
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                const stateId = chunk.blocks[chunk.index(x, y, z)];
                column[(y << 8) | (z << 4) | x] = getMappedBlockId(blockIdByState, stateId);
            }
        }
    }
    return column;
}

export function toLegacyBlockStateColumn(chunk, legacyStateByVanillaState) {
    if (!chunk || !(chunk.blocks instanceof Uint32Array) || typeof chunk.index !== 'function') {
        throw new TypeError('Expected a VanillaChunk');
    }
    if (!(legacyStateByVanillaState instanceof Map)) throw new TypeError('Expected an explicit vanilla-state to legacy-state map');
    if (chunk.minY < 0 || chunk.minY + chunk.height > LEGACY_COLUMN_HEIGHT) {
        throw new RangeError(`Chunk vertical range must fit inside legacy Y 0..${LEGACY_COLUMN_HEIGHT - 1}`);
    }

    const column = new Uint16Array(16 * LEGACY_COLUMN_HEIGHT * 16);
    for (let y = chunk.minY; y < chunk.minY + chunk.height; y++) {
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                const stateId = chunk.blocks[chunk.index(x, y, z)];
                const legacyState = legacyStateByVanillaState.get(stateId);
                if (!Number.isInteger(legacyState) || legacyState < 0 || legacyState > 0xffff) {
                    throw new RangeError(`Missing or invalid legacy block state for vanilla state ${stateId}`);
                }
                column[(y << 8) | (z << 4) | x] = legacyState;
            }
        }
    }
    return column;
}

export function toLegacyChunkResult(chunk, legacyStateByVanillaState) {
    if (!chunk || !(chunk.blocks instanceof Uint32Array) || !(chunk.heightmap instanceof Int32Array)) {
        throw new TypeError('Expected a VanillaChunk with a heightmap');
    }
    if (!(legacyStateByVanillaState instanceof Map)) throw new TypeError('Expected an explicit vanilla-state to legacy-state map');
    if (chunk.minY < 0 || chunk.minY + chunk.height > LEGACY_COLUMN_HEIGHT) {
        throw new RangeError(`Chunk vertical range must fit inside legacy Y 0..${LEGACY_COLUMN_HEIGHT - 1}`);
    }

    const sections = new Array(16);
    let sectionMask = 0;
    for (let y = chunk.minY; y < chunk.minY + chunk.height; y++) {
        const sectionY = y >> 4;
        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                const stateId = chunk.blocks[chunk.index(x, y, z)];
                const packedState = legacyStateByVanillaState.get(stateId);
                if (!Number.isInteger(packedState) || packedState < 0 || packedState > 0xffff) {
                    throw new RangeError(`Missing or invalid legacy block state for vanilla state ${stateId}`);
                }
                if (packedState === 0) continue;

                let section = sections[sectionY];
                if (!section) {
                    section = sections[sectionY] = {
                        blocks: new Uint16Array(4096),
                        blocksData: new Uint8Array(4096),
                        blockLight: new Uint8Array(2048),
                        skyLight: new Uint8Array(2048)
                    };
                    sectionMask |= 1 << sectionY;
                }
                const localIndex = ((y & 15) << 8) | (z << 4) | x;
                section.blocks[localIndex] = packedState >> 4;
                section.blocksData[localIndex] = packedState & 15;
            }
        }
    }

    return {
        x: chunk.chunkX,
        z: chunk.chunkZ,
        sectionMask,
        sections,
        heightMap: new Uint16Array(chunk.heightmap)
    };
}
