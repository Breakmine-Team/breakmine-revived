import { blockName, createBlockPredicateTester } from './feature-world.mjs';

const now = () => globalThis.performance?.now?.() ?? Date.now();
const stateKey = (name, properties = {}) => JSON.stringify([name, Object.entries(properties).sort(([a], [b]) => a.localeCompare(b))]);
const preparedRegistries = new WeakMap();

function prepareRegistry(registry) {
    let prepared = preparedRegistries.get(registry);
    if (prepared) return prepared;
    const states = new Map(), ids = new Map();
    for (const entry of registry.states) {
        const state = Object.freeze({ name: entry.name, stateId: entry.id, properties: Object.freeze({ ...entry.properties }) });
        const key = stateKey(entry.name, entry.properties);
        if (states.has(entry.id) || ids.has(key)) throw new Error('Duplicate native block state');
        states.set(entry.id, state);
        ids.set(key, entry.id);
    }
    const air = states.get(ids.get(stateKey('minecraft:air')));
    if (!air) throw new Error('Native air state is missing');
    prepared = { states, ids, air };
    preparedRegistries.set(registry, prepared);
    return prepared;
}

export function createDecorationRegion({ chunks, registry, biomeNames, rules = {}, writeCenter, writeRadius = 1, seed, profile }) {
    if (!(chunks instanceof Map) || !chunks.size) throw new TypeError('Decoration needs a populated chunk region');
    if (!Array.isArray(registry?.states) || !Array.isArray(biomeNames)) throw new TypeError('Decoration needs native block and biome registries');
    const first = chunks.values().next().value;
    const minY = first.minY, maxY = minY + first.height;
    if (writeCenter && (![writeCenter.chunkX, writeCenter.chunkZ].every(Number.isInteger) || !Number.isInteger(writeRadius) || writeRadius < 0)) throw new TypeError('Invalid decoration write zone');
    for (const [key, chunk] of chunks) {
        if (key !== `${chunk.chunkX},${chunk.chunkZ}` || chunk.minY !== minY || chunk.height !== first.height) throw new Error('Incompatible decoration region chunk');
    }
    const { states, ids, air } = prepareRegistry(registry);
    const chunksByX = new Map();
    for (const chunk of chunks.values()) {
        let byZ = chunksByX.get(chunk.chunkX);
        if (!byZ) chunksByX.set(chunk.chunkX, byZ = new Map());
        byZ.set(chunk.chunkZ, chunk);
    }
    const findChunk = (x, z) => chunksByX.get(x)?.get(z);
    const airNames = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air']);
    let blockLightCache = null;
    let journal = null;
    const pendingTicks = [];
    const postProcessing = [];
    const blockEntityData = new Map();
    const heightCache = new Map();
    function noteTerrainDependency(x, z, layer) {
        if (!profile) return;
        profile.terrainDependencies ??= new Map();
        const key = `${x},${z}`;
        let layers = profile.terrainDependencies.get(key);
        if (!layers) profile.terrainDependencies.set(key, layers = new Set());
        layers.add(layer);
    }
    function ensureCanWrite(pos) {
        if (!pos || !Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y) || !Number.isSafeInteger(pos.z)) throw new TypeError('Invalid decoration position');
        const x = Math.floor(pos.x / 16), z = Math.floor(pos.z / 16);
        if (writeCenter) return Math.abs(x - writeCenter.chunkX) <= writeRadius && Math.abs(z - writeCenter.chunkZ) <= writeRadius;
        return !!findChunk(x, z);
    }
    function locate(pos, y = null) {
        if (!pos || !Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y) || !Number.isSafeInteger(pos.z)) throw new TypeError('Invalid decoration position');
        y ??= pos.y;
        if (y < minY || y >= maxY) return null;
        const chunkX = Math.floor(pos.x / 16), chunkZ = Math.floor(pos.z / 16);
        const chunk = findChunk(chunkX, chunkZ);
        if (!chunk) throw new Error(`Decoration accessed an unloaded neighbor: ${chunkX},${chunkZ}`);
        return { chunk, x: pos.x - chunkX * 16, z: pos.z - chunkZ * 16 };
    }
    function stateIdFor(name, properties = {}) {
        if (typeof rules?.normalizeBlockProperties === 'function') properties = rules.normalizeBlockProperties(name, properties);
        const id = ids.get(stateKey(name, properties));
        if (id === undefined) throw new Error(`Unknown decoration block state: ${name} ${JSON.stringify(properties)}`);
        return id;
    }
    function getBlockState(pos) {
        if (profile) profile.blockStateLookups++;
        if (!pos || !Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y) || !Number.isSafeInteger(pos.z)) throw new TypeError('Invalid decoration position');
        if (pos.y < minY || pos.y >= maxY) return air;
        const chunkX = Math.floor(pos.x / 16), chunkZ = Math.floor(pos.z / 16);
        noteTerrainDependency(chunkX, chunkZ, 'blocks');
        const chunk = findChunk(chunkX, chunkZ);
        if (!chunk) throw new Error(`Decoration accessed an unloaded neighbor: ${chunkX},${chunkZ}`);
        const x = pos.x - chunkX * 16, z = pos.z - chunkZ * 16;
        const id = chunk.blocks[(pos.y - minY) * 256 + z * 16 + x];
        const state = states.get(id);
        if (!state) throw new Error(`Unknown native state ID: ${id}`);
        return state;
    }
    function getBlockLight(pos) {
        if (profile) profile.blockLightQueries++;
        if (pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.z)) {
            noteTerrainDependency(Math.floor(pos.x / 16), Math.floor(pos.z / 16), 'blocks');
        }
        if (!locate(pos)) return 0;
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (!blockLightCache) {
            const start = profile ? now() : 0;
            blockLightCache = new Map();
            const queue = [];
            const lightRule = state => {
                const rule = rules?.getLightRule?.(state);
                if (!rule || !Number.isInteger(rule.emission) || !Number.isInteger(rule.dampening)) throw new Error('Block-light lookup needs native emission and dampening rules');
                return rule;
            };
            for (const chunk of chunks.values()) {
                noteTerrainDependency(chunk.chunkX, chunk.chunkZ, 'blocks');
                for (let index = 0; index < chunk.blocks.length; index++) {
                    const state = states.get(chunk.blocks[index]);
                    if (!state) throw new Error(`Unknown native state ID: ${chunk.blocks[index]}`);
                    const emission = lightRule(state).emission;
                    if (emission <= 0) continue;
                    const x = chunk.chunkX * 16 + (index & 15), z = chunk.chunkZ * 16 + ((index >> 4) & 15);
                    const y = minY + (index >> 8), sourceKey = `${x},${y},${z}`;
                    if (emission > (blockLightCache.get(sourceKey) ?? 0)) {
                        blockLightCache.set(sourceKey, emission);
                        queue.push({ x, y, z, level: emission });
                    }
                }
            }
            for (let cursor = 0; cursor < queue.length; cursor++) {
                const current = queue[cursor];
                if (current.level <= 1) continue;
                for (const [dx, dy, dz] of [[-1,0,0],[1,0,0],[0,-1,0],[0,1,0],[0,0,-1],[0,0,1]]) {
                    const next = { x: current.x + dx, y: current.y + dy, z: current.z + dz };
                    if (next.y < minY || next.y >= maxY || !chunks.has(`${Math.floor(next.x / 16)},${Math.floor(next.z / 16)}`)) continue;
                    const nextState = getBlockState(next), rule = lightRule(nextState);
                    const candidate = current.level - Math.max(1, rule.dampening);
                    if (candidate <= 0) continue;
                    const nextKey = `${next.x},${next.y},${next.z}`;
                    if (candidate <= (blockLightCache.get(nextKey) ?? 0)) continue;
                    blockLightCache.set(nextKey, candidate);
                    queue.push({ ...next, level: candidate });
                }
            }
            if (profile) {
                profile.blockLightBuildMs += now() - start;
                profile.blockLightVisitedBlocks += blockLightCache.size;
            }
        }
        return blockLightCache.get(key) ?? 0;
    }
    function setBlock(state, pos, flags = 3) {
        if (profile) profile.blockWrites++;
        if (!journal) throw new Error('Decoration writes require a transaction');
        if (writeCenter && !ensureCanWrite(pos)) return false;
        if (pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.z)) {
            noteTerrainDependency(Math.floor(pos.x / 16), Math.floor(pos.z / 16), 'blocks');
        }
        const cell = locate(pos);
        if (!cell) return false;
        if (profile && writeCenter && (cell.chunk.chunkX !== writeCenter.chunkX || cell.chunk.chunkZ !== writeCenter.chunkZ)) {
            profile.crossChunkBlockWrites++;
        }
        const id = stateIdFor(state.name, state.properties);
        if (state.stateId !== undefined && state.stateId !== id) throw new Error('Decoration state ID disagrees with its properties');
        const index = (pos.y - minY) * 256 + cell.z * 16 + cell.x;
        const previousState = states.get(cell.chunk.blocks[index]), nextState = states.get(id);
        const previousLight = rules?.getLightRule?.(previousState), nextLight = rules?.getLightRule?.(nextState);
        const key = `${pos.x},${pos.y},${pos.z}`;
        if (!journal.blocks.has(key)) journal.blocks.set(key, { chunk: cell.chunk, index, previous: cell.chunk.blocks[index] });
        cell.chunk.blocks[index] = id;
        if (previousLight?.emission !== nextLight?.emission || previousLight?.dampening !== nextLight?.dampening) blockLightCache = null;
        heightCache.delete(`${pos.x},${pos.z}`);
        journal.columns.set(`${pos.x},${pos.z}`, { ...cell, worldX: pos.x, worldZ: pos.z });
        return true;
    }
    function biomeAtBlock(pos) {
        if (!pos || !Number.isSafeInteger(pos.x) || !Number.isSafeInteger(pos.y) || !Number.isSafeInteger(pos.z)) throw new TypeError('Invalid decoration biome position');
        const y = Math.max(minY, Math.min(maxY - 1, pos.y));
        const cell = locate(pos, y);
        noteTerrainDependency(cell.chunk.chunkX, cell.chunk.chunkZ, 'biomes');
        const id = cell.chunk.biomes[Math.floor((y - minY) / 4) * 16 + Math.floor(cell.z / 4) * 4 + Math.floor(cell.x / 4)];
        if (!biomeNames[id]) throw new Error(`Unknown native biome ID: ${id}`);
        return biomeNames[id];
    }
    function scheduleTick(state, pos, delay = 0) {
        if (!journal) throw new Error('Decoration ticks require a transaction');
        if (pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.z)) {
            noteTerrainDependency(Math.floor(pos.x / 16), Math.floor(pos.z / 16), 'blocks');
        }
        if (!locate(pos)) return;
        stateIdFor(state.name, state.properties);
        pendingTicks.push({ state, position: { ...pos }, delay });
    }
    function scheduleFluidTick(fluid, pos, delay = 0) {
        if (!journal) throw new Error('Decoration fluid ticks require a transaction');
        if (pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.z)) {
            noteTerrainDependency(Math.floor(pos.x / 16), Math.floor(pos.z / 16), 'blocks');
        }
        if (!locate(pos)) return;
        const name = blockName(fluid);
        if (name === 'minecraft:empty' || !Number.isSafeInteger(delay) || delay < 0) throw new TypeError('Invalid decoration fluid tick');
        pendingTicks.push({ type: 'fluid', fluid: { id: name }, position: { ...pos }, delay });
    }
    if (typeof rules === 'function') rules = rules({ getBlockState, getBlockLight, getHeight: (type, x, z) => context.getHeight(type, x, z), stateIdFor, setBlock, biomeAtBlock, minY, maxY });
    const context = { ...rules, minY, maxY, seed, getBlockState, getBlockLight, ensureCanWrite, scheduleTick, scheduleFluidTick,
        markPosForPostProcessing(pos) {
            if (!journal) throw new Error('Decoration post-processing requires a transaction');
            if (pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.z)) {
                noteTerrainDependency(Math.floor(pos.x / 16), Math.floor(pos.z / 16), 'blocks');
            }
            const cell = locate(pos);
            if (!cell) return;
            postProcessing.push({ chunkX: cell.chunk.chunkX, chunkZ: cell.chunk.chunkZ,
                sectionIndex: Math.floor(pos.y / 16) - Math.floor(minY / 16),
                packedOffset: (pos.x & 15) | ((pos.y & 15) << 4) | ((pos.z & 15) << 8) });
        },
        hasWritableSection: pos => {
            if (pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.z)) {
                noteTerrainDependency(Math.floor(pos.x / 16), Math.floor(pos.z / 16), 'blocks');
            }
            return ensureCanWrite(pos) && !!locate(pos);
        },
        setBlockInSection: (state, pos) => setBlock(state, pos),
        isInsideWorldBounds: pos => !!pos && Number.isSafeInteger(pos.x) && Number.isSafeInteger(pos.y) && Number.isSafeInteger(pos.z) && pos.y >= minY && pos.y < maxY,
        hasLootContainer: pos => ['minecraft:chest', 'minecraft:trapped_chest'].includes(getBlockState(pos).name),
        setLootTable(pos, lootTable, lootTableSeed) {
            if (!journal) throw new Error('Decoration block entities require a transaction');
            if (!context.hasLootContainer(pos)) return false;
            blockEntityData.set(`${pos.x},${pos.y},${pos.z}`, { position: { ...pos }, type: 'container', lootTable, lootTableSeed });
            return true;
        },
        hasSpawnerBlockEntity: pos => getBlockState(pos).name === 'minecraft:spawner',
        setSpawnerEntity(pos, entity, random) {
            if (!journal) throw new Error('Decoration block entities require a transaction');
            if (!context.hasSpawnerBlockEntity(pos)) return false;
            if (typeof random?.nextInt !== 'function') throw new TypeError('Spawner data requires a Java random source');
            random.nextInt(1);
            blockEntityData.set(`${pos.x},${pos.y},${pos.z}`, { position: { ...pos }, type: 'spawner', entity });
            return true;
        },
        hasBeeNestBlockEntity: pos => ['minecraft:bee_nest', 'minecraft:beehive'].includes(blockName(getBlockState(pos))),
        storeBeeOccupants(pos, ages) {
            if (!journal) throw new Error('Beehive occupants require a decoration transaction');
            if (!context.hasBeeNestBlockEntity(pos)) return false;
            if (!Array.isArray(ages) || ages.some(age => !Number.isInteger(age) || age < 0 || age >= 599)) throw new TypeError('Invalid generated bee occupant ages');
            blockEntityData.set(`${pos.x},${pos.y},${pos.z}`, { position: { ...pos }, type: 'beehive', occupants: [...ages] });
            return true;
        },
        getHeight(type, x, z) {
            if (typeof rules.heightmapPredicate !== 'function') throw new Error(`Decoration heightmap ${type} needs native block predicates`);
            const key = `${x},${z}`;
            let column = heightCache.get(key);
            if (column?.has(type)) return column.get(type);
            let height = minY;
            for (let y = maxY - 1; y >= minY; y--) if (rules.heightmapPredicate(type, getBlockState({ x, y, z }))) { height = y + 1; break; }
            if (!column) heightCache.set(key, column = new Map());
            column.set(type, height);
            return height;
        },
        getMotionBlockingNoLeavesHeight: pos => context.getHeight('MOTION_BLOCKING_NO_LEAVES', pos.x, pos.z)
    };
    context.testBlockPredicate = createBlockPredicateTester(context);
    return {
        context, stateIdFor, getBlockState, setBlock, biomeAtBlock, pendingTicks, postProcessing, blockEntityData,
        biomesInChunk(x, z) {
            const chunk = findChunk(x, z);
            if (!chunk) throw new Error(`Missing decoration biome neighbor: ${x},${z}`);
            noteTerrainDependency(x, z, 'biomes');
            return [...new Set(chunk.biomes)].map(id => {
                if (!biomeNames[id]) throw new Error(`Unknown native biome ID: ${id}`);
                return biomeNames[id];
            });
        },
        scheduleTick, scheduleFluidTick,
        transaction(action) {
            if (journal) throw new Error('Nested decoration transaction');
            journal = { blocks: new Map(), columns: new Map(), blockEntities: new Map(blockEntityData), ticks: pendingTicks.length, marks: postProcessing.length };
            try {
                const result = action();
                if (result?.then) throw new TypeError('Decoration transaction must be synchronous');
                const heights = [...journal.columns.values()].map(cell => {
                    let y = maxY - 1;
                    while (y >= minY && airNames.has(getBlockState({ x: cell.worldX, y, z: cell.worldZ }).name)) y--;
                    return [cell.chunk, cell.z * 16 + cell.x, y + 1];
                });
                for (const [chunk, index, height] of heights) chunk.heightmap[index] = height;
                return result;
            } catch (error) {
                for (const { chunk, index, previous } of journal.blocks.values()) chunk.blocks[index] = previous;
                pendingTicks.length = journal.ticks;
                postProcessing.length = journal.marks;
                blockEntityData.clear();
                for (const [key, value] of journal.blockEntities) blockEntityData.set(key, value);
                heightCache.clear();
                throw error;
            } finally { journal = null; }
        }
    };
}
