import rules from '../../../../../../packages/vanilla-worldgen/generated/block-rules.json' with { type: 'json' };

const DIRECTIONS = [
    [0, -1, 0], [0, 1, 0], [0, 0, -1],
    [0, 0, 1], [-1, 0, 0], [1, 0, 0]
];
const OPPOSITE = [1, 0, 3, 2, 5, 4];
const ALL_DIRECTIONS = 0x3f;
const EMPTY_SHAPE = 0x400;
const EMISSION_SOURCE = 0x800;
const PULL_LIGHT_IN = 1;
const PULL_LIGHT_DIRECTIONS = ALL_DIRECTIONS << 4;
const SKY_SOURCE_DIRECTIONS = ALL_DIRECTIONS & ~(1 << 1);
const MAX_SAFE_CHUNKS = Number.MAX_SAFE_INTEGER;

class LightQueue {
    constructor() {
        this.values = new Float64Array(2048);
        this.read = 0;
        this.write = 0;
        this.position = 0;
        this.data = 0;
    }

    get length() { return this.write - this.read; }
    get empty() { return this.read === this.write; }

    push(position, data) {
        if (this.write + 2 > this.values.length) {
            if (this.read > 0) {
                this.values.copyWithin(0, this.read, this.write);
                this.write -= this.read;
                this.read = 0;
            } else {
                const next = new Float64Array(this.values.length * 2);
                next.set(this.values);
                this.values = next;
            }
        }
        this.values[this.write++] = position;
        this.values[this.write++] = data;
    }

    shift() {
        this.position = this.values[this.read++];
        this.data = this.values[this.read++];
        if (this.read === this.write) this.read = this.write = 0;
        return true;
    }
}

function encodeData(level, directionMask = ALL_DIRECTIONS, { empty = false, emission = false } = {}) {
    return (level & 15) | ((directionMask & ALL_DIRECTIONS) << 4) | (empty ? EMPTY_SHAPE : 0) | (emission ? EMISSION_SOURCE : 0);
}

function shapeId(rule, direction) {
    if (!rule || !rule.canOcclude || !rule.useShapeForLightOcclusion) return -1;
    return rule.faces.occlusionShapes[direction];
}

export default class MinecraftLightEngine {
    constructor(world) {
        this.world = world;
        this.minY = world.minY;
        this.maxY = world.maxY;
        this.height = world.height;
        this.volume = this.height * 256;
        this.chunks = new Map();
        this.indexedChunks = [];
        this.nextChunkIndex = 0;
        this.blockDecrease = new LightQueue();
        this.blockIncrease = new LightQueue();
        this.skyDecrease = new LightQueue();
        this.skyIncrease = new LightQueue();
        this.checkPositions = [];
        this.checkPositionSet = new Set();
        this.checkPositionIndex = 0;
        this.dirtySections = new Set();
        this.occlusionMasks = rules.occlusionShapes.map(hex => {
            const words = new Uint32Array(8);
            for (let i = 0; i < words.length; i++) words[i] = Number.parseInt(hex.slice(i * 8, i * 8 + 8), 16) >>> 0;
            return words;
        });
    }

    chunkKey(x, z) { return `${x},${z}`; }

    hasChunk(chunk) { return this.chunks.get(this.chunkKey(chunk.x, chunk.z)) === chunk; }

    registerChunk(chunk) {
        const key = this.chunkKey(chunk.x, chunk.z);
        if (this.chunks.get(key) === chunk) return;
        if (this.chunks.has(key)) this.removeChunk(chunk.x, chunk.z);
        const index = this.nextChunkIndex++;
        if (!Number.isSafeInteger(index * this.volume + this.volume - 1) || index > MAX_SAFE_CHUNKS) throw new RangeError('Too many active chunks for packed light positions');
        chunk.lightEngineIndex = index;
        chunk.skyLightSources = new Int32Array(256);
        this.indexedChunks[index] = chunk;
        this.chunks.set(key, chunk);
    }

    removeChunk(chunkX, chunkZ) {
        const key = this.chunkKey(chunkX, chunkZ);
        const chunk = this.chunks.get(key);
        if (!chunk) return;
        this.chunks.delete(key);
        if (this.indexedChunks[chunk.lightEngineIndex] === chunk) this.indexedChunks[chunk.lightEngineIndex] = null;
        chunk.lightEngineIndex = undefined;
    }

    clear() {
        this.chunks.clear();
        this.indexedChunks.length = 0;
        this.dirtySections.clear();
        this.blockDecrease = new LightQueue();
        this.blockIncrease = new LightQueue();
        this.skyDecrease = new LightQueue();
        this.skyIncrease = new LightQueue();
        this.checkPositions.length = 0;
        this.checkPositionSet.clear();
        this.checkPositionIndex = 0;
    }

    ruleAt(chunk, x, y, z) {
        const id = chunk.native.getBlock(x, y, z);
        return rules.states[id] ?? rules.states[0];
    }

    getCell(x, y, z) {
        if (y < this.minY || y >= this.maxY) return null;
        const chunkX = Math.floor(x / 16), chunkZ = Math.floor(z / 16);
        const chunk = this.chunks.get(this.chunkKey(chunkX, chunkZ));
        if (!chunk) return null;
        const lx = x - chunkX * 16, lz = z - chunkZ * 16;
        const dy = y - this.minY;
        const section = chunk.sections[dy >> 4];
        const index = ((dy & 15) << 8) | (lz << 4) | lx;
        return { chunk, x, y, z, lx, lz, dy, section, index, rule: this.ruleAt(chunk, lx, y, lz) };
    }

    position(chunk, x, y, z) {
        return chunk.lightEngineIndex * this.volume + (y - this.minY) * 256 + (z << 4) + x;
    }

    decode(position) {
        const chunkIndex = Math.floor(position / this.volume);
        const local = position - chunkIndex * this.volume;
        const chunk = this.indexedChunks[chunkIndex];
        if (!chunk) return null;
        const dy = local >> 8;
        const packedXZ = local & 255;
        const y = this.minY + dy;
        const lx = packedXZ & 15, lz = packedXZ >> 4;
        const section = chunk.sections[dy >> 4];
        const index = ((dy & 15) << 8) | (lz << 4) | lx;
        return { chunk, x: chunk.x * 16 + lx, y, z: chunk.z * 16 + lz, lx, lz, dy, section, index };
    }

    getLight(cell, layer) {
        return layer === 'block' ? cell.section.blockLight[cell.index] : cell.section.skyLight[cell.index];
    }

    setLight(cell, layer, value) {
        const data = layer === 'block' ? cell.section.blockLight : cell.section.skyLight;
        if (data[cell.index] === value) return false;
        data[cell.index] = value;
        this.dirtySections.add(cell.section);
        return true;
    }

    getSourceY(chunk, x, z) {
        return chunk?.skyLightSources ? chunk.skyLightSources[z * 16 + x] : Number.MIN_SAFE_INTEGER;
    }

    computeSourceY(chunk, x, z) {
        let topRule = rules.states[0];
        for (let y = this.maxY - 1; y >= this.minY; y--) {
            const bottomRule = this.ruleAt(chunk, x, y, z);
            if (bottomRule.lightDampening !== 0 || this.faceShapeOccludes(topRule, bottomRule, 0)) return y + 1;
            topRule = bottomRule;
        }
        return this.minY;
    }

    isEmptyShape(stateRule) {
        return !stateRule?.canOcclude || !stateRule.useShapeForLightOcclusion;
    }

    faceShapeOccludes(fromRule, toRule, direction) {
        const fromId = shapeId(fromRule, direction);
        const toId = shapeId(toRule, OPPOSITE[direction]);
        if (fromId < 0 && toId < 0) return false;
        if (fromId < 0) return this.isFullMask(toId);
        if (toId < 0) return this.isFullMask(fromId);
        const from = this.occlusionMasks[fromId], to = this.occlusionMasks[toId];
        for (let i = 0; i < 8; i++) if (((from[i] | to[i]) >>> 0) !== 0xffffffff) return false;
        return true;
    }

    isFullMask(id) {
        const mask = this.occlusionMasks[id];
        if (!mask) return false;
        for (let i = 0; i < 8; i++) if (mask[i] !== 0xffffffff) return false;
        return true;
    }

    pushIncrease(layer, position, level, directionMask = ALL_DIRECTIONS, { empty = false, emission = false } = {}) {
        const queue = layer === 'block' ? this.blockIncrease : this.skyIncrease;
        queue.push(position, encodeData(level, directionMask, { empty, emission }));
    }

    pushDecrease(layer, position, level, directionMask = ALL_DIRECTIONS) {
        const queue = layer === 'block' ? this.blockDecrease : this.skyDecrease;
        queue.push(position, encodeData(level, directionMask));
    }

    *initializeChunkSteps(chunk) {
        this.registerChunk(chunk);
        const completed = { value: false };
        try {
            for (const section of chunk.sections) {
                if (!(section.skyLight instanceof Uint8Array) || section.skyLight.length !== 4096) section.skyLight = new Uint8Array(4096);
                else section.skyLight.fill(0);
                if (!(section.blockLight instanceof Uint8Array) || section.blockLight.length !== 4096) section.blockLight = new Uint8Array(4096);
                else section.blockLight.fill(0);
                section.isModified = true;
                section.isDirty = true;
                yield;
            }

            for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
                chunk.skyLightSources[z * 16 + x] = this.computeSourceY(chunk, x, z);
                yield;
            }

            for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
                const sourceY = chunk.skyLightSources[z * 16 + x];
                let neighborSourceY = Number.MIN_SAFE_INTEGER;
                for (let direction = 2; direction < 6; direction++) {
                    const [dx, , dz] = DIRECTIONS[direction];
                    const neighbor = this.getCell(chunk.x * 16 + x + dx, this.minY, chunk.z * 16 + z + dz);
                    const neighborThreshold = neighbor
                        ? this.getSourceY(neighbor.chunk, neighbor.lx, neighbor.lz)
                        : Number.MIN_SAFE_INTEGER;
                    if (neighborThreshold > neighborSourceY) neighborSourceY = neighborThreshold;
                }
                for (let y = sourceY; y < this.maxY; y++) {
                    const cell = this.getCell(chunk.x * 16 + x, y, chunk.z * 16 + z);
                    this.setLight(cell, 'sky', 15);
                    if (y < neighborSourceY || y === sourceY) {
                        this.pushIncrease('sky', this.position(chunk, x, y, z), 15, SKY_SOURCE_DIRECTIONS);
                    }
                }
                yield;
            }

            for (let dy = 0; dy < this.height; dy++) {
                const y = this.minY + dy;
                const section = chunk.sections[dy >> 4];
                for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) {
                    const rule = this.ruleAt(chunk, x, y, z);
                    if (rule.lightEmission <= 0) continue;
                    const index = ((dy & 15) << 8) | (z << 4) | x;
                    section.blockLight[index] = rule.lightEmission;
                    this.pushIncrease('block', this.position(chunk, x, y, z), rule.lightEmission, ALL_DIRECTIONS,
                        { empty: this.isEmptyShape(rule), emission: true });
                }
                yield;
            }

            this.seedLoadedNeighbors(chunk);
            yield* this.drainLightSteps();
            this.flushDirtySections();
            completed.value = true;
            return chunk;
        } finally {
            if (!completed.value && this.world.chunkProvider?.chunks.get(this.world.chunkProvider.chunkKey(chunk.x, chunk.z)) !== chunk) {
                this.removeChunk(chunk.x, chunk.z);
            }
        }
    }

    initializeChunk(chunk) {
        const steps = this.initializeChunkSteps(chunk);
        let result;
        do { result = steps.next(); } while (!result.done);
        return result.value;
    }

    seedLoadedNeighbors(chunk) {
        const faces = [
            { dx: -1, dz: 0, sx: 15, sz: null, tx: 0, tz: null, direction: 5 },
            { dx: 1, dz: 0, sx: 0, sz: null, tx: 15, tz: null, direction: 4 },
            { dx: 0, dz: -1, sx: null, sz: 15, tx: null, tz: 0, direction: 3 },
            { dx: 0, dz: 1, sx: null, sz: 0, tx: null, tz: 15, direction: 2 }
        ];
        for (const face of faces) {
            const sourceChunk = this.chunks.get(this.chunkKey(chunk.x + face.dx, chunk.z + face.dz));
            if (!sourceChunk) continue;
            for (let dy = 0; dy < this.height; dy++) for (let offset = 0; offset < 16; offset++) {
                const y = this.minY + dy;
                const sx = face.sx ?? offset, sz = face.sz ?? offset;
                const tx = face.tx ?? offset, tz = face.tz ?? offset;
                const source = this.getCell(sourceChunk.x * 16 + sx, y, sourceChunk.z * 16 + sz);
                const target = this.getCell(chunk.x * 16 + tx, y, chunk.z * 16 + tz);
                if (!source || !target) continue;
                for (const layer of ['block', 'sky']) {
                    const level = this.getLight(source, layer);
                    if (level <= this.getLight(target, layer) || level <= 0) continue;
                    this.pushIncrease(layer, this.position(sourceChunk, sx, y, sz), level, 1 << face.direction,
                        { empty: this.isEmptyShape(source.rule) });
                }
            }
        }
    }

    checkBlock(x, y, z) {
        const cell = this.getCell(x, y, z);
        if (!cell) return;
        const position = this.position(cell.chunk, cell.lx, y, cell.lz);
        if (this.checkPositionSet.has(position)) return;
        this.checkPositionSet.add(position);
        this.checkPositions.push(position);
    }

    checkBlockPosition(position) {
        const cell = this.decode(position);
        if (!cell) return;
        const rule = this.ruleAt(cell.chunk, cell.lx, cell.y, cell.lz);

        const oldBlockLevel = this.getLight(cell, 'block');
        const emission = rule.lightEmission;
        if (emission < oldBlockLevel) {
            this.setLight(cell, 'block', 0);
            this.pushDecrease('block', position, oldBlockLevel);
        } else {
            this.blockDecrease.push(position, encodeData(1, ALL_DIRECTIONS));
        }
        if (emission > 0) this.pushIncrease('block', position, emission, ALL_DIRECTIONS,
            { empty: this.isEmptyShape(rule), emission: true });

        const sourceIndex = cell.lz * 16 + cell.lx;
        const oldSourceY = this.getSourceY(cell.chunk, cell.lx, cell.lz);
        const newSourceY = this.computeSourceY(cell.chunk, cell.lx, cell.lz);
        if (newSourceY !== oldSourceY) {
            cell.chunk.skyLightSources[sourceIndex] = newSourceY;
            const neighborSourceY = this.neighborSourceY(cell.x, cell.z);
            if (newSourceY > oldSourceY) {
                const topRemovedY = newSourceY - 1;
                for (let sourceY = Math.max(this.minY, oldSourceY); sourceY <= topRemovedY && sourceY < this.maxY; sourceY++) {
                    const sourceCell = this.getCell(cell.x, sourceY, cell.z);
                    if (this.getLight(sourceCell, 'sky') !== 15) continue;
                    this.setLight(sourceCell, 'sky', 0);
                    const directions = sourceY === topRemovedY ? ALL_DIRECTIONS : ALL_DIRECTIONS & ~(1 << 1);
                    this.pushDecrease('sky', this.position(sourceCell.chunk, sourceCell.lx, sourceY, sourceCell.lz), 15, directions);
                }
            } else {
                for (let sourceY = Math.max(this.minY, newSourceY); sourceY < Math.min(oldSourceY, this.maxY); sourceY++) {
                    const sourceCell = this.getCell(cell.x, sourceY, cell.z);
                    if (this.getLight(sourceCell, 'sky') !== 15) this.setLight(sourceCell, 'sky', 15);
                    if (sourceY < neighborSourceY) this.pushIncrease('sky', this.position(sourceCell.chunk, sourceCell.lx, sourceY, sourceCell.lz), 15, SKY_SOURCE_DIRECTIONS);
                }
            }
        }

        const lowestSourceY = this.getSourceY(cell.chunk, cell.lx, cell.lz);
        if (cell.y >= lowestSourceY) {
            this.pushDecrease('sky', position, 15, ALL_DIRECTIONS & ~(1 << 1));
            this.pushIncrease('sky', position, 15, SKY_SOURCE_DIRECTIONS);
        } else {
            const oldSkyLevel = this.getLight(cell, 'sky');
            if (oldSkyLevel > 0) {
                this.setLight(cell, 'sky', 0);
                this.pushDecrease('sky', position, oldSkyLevel);
            } else {
                this.skyDecrease.push(position, encodeData(1, ALL_DIRECTIONS));
            }
        }
    }

    neighborSourceY(x, z) {
        let sourceY = Number.MIN_SAFE_INTEGER;
        for (let direction = 2; direction < 6; direction++) {
            const [dx, , dz] = DIRECTIONS[direction];
            const neighbor = this.getCell(x + dx, this.minY, z + dz);
            if (!neighbor) continue;
            sourceY = Math.max(sourceY, this.getSourceY(neighbor.chunk, neighbor.lx, neighbor.lz));
        }
        return sourceY;
    }

    *drainLightSteps(maxOperations = 4096) {
        while (this.hasWork()) {
            this.runUpdates(maxOperations);
            yield;
        }
    }

    propagateIncrease(layer, position, data) {
        const from = this.decode(position);
        if (!from) return;
        let fromLevel = this.getLight(from, layer);
        const targetLevel = data & 15;
        if ((data & EMISSION_SOURCE) !== 0 && fromLevel < targetLevel) {
            this.setLight(from, layer, targetLevel);
            fromLevel = targetLevel;
        }
        if (fromLevel !== targetLevel) return;
        const fromRule = (data & EMPTY_SHAPE) !== 0 ? rules.states[0] : this.ruleAt(from.chunk, from.lx, from.y, from.lz);
        for (let direction = 0; direction < 6; direction++) {
            if ((data & (1 << (direction + 4))) === 0) continue;
            const [dx, dy, dz] = DIRECTIONS[direction];
            const to = this.getCell(from.x + dx, from.y + dy, from.z + dz);
            if (!to) continue;
            const currentLevel = this.getLight(to, layer);
            if (fromLevel - 1 <= currentLevel) continue;
            const newLevel = fromLevel - Math.max(1, to.rule.lightDampening);
            if (newLevel <= currentLevel || this.faceShapeOccludes(fromRule, to.rule, direction)) continue;
            this.setLight(to, layer, newLevel);
            if (newLevel > 1) this.pushIncrease(layer, this.position(to.chunk, to.lx, to.y, to.lz), newLevel,
                ALL_DIRECTIONS & ~(1 << OPPOSITE[direction]), { empty: this.isEmptyShape(to.rule) });
        }
    }

    propagateDecrease(layer, position, data) {
        const from = this.decode(position);
        if (!from) return;
        const oldLevel = data & 15;
        for (let direction = 0; direction < 6; direction++) {
            if ((data & (1 << (direction + 4))) === 0) continue;
            const [dx, dy, dz] = DIRECTIONS[direction];
            const to = this.getCell(from.x + dx, from.y + dy, from.z + dz);
            if (!to) continue;
            const toLevel = this.getLight(to, layer);
            if (toLevel === 0) continue;
            if (toLevel <= oldLevel - 1) {
                const emission = layer === 'block' ? to.rule.lightEmission : (to.y >= this.getSourceY(to.chunk, to.lx, to.lz) ? 15 : 0);
                this.setLight(to, layer, 0);
                if (emission < toLevel) this.pushDecrease(layer, this.position(to.chunk, to.lx, to.y, to.lz), toLevel, ALL_DIRECTIONS & ~(1 << OPPOSITE[direction]));
                if (emission > 0) this.pushIncrease(layer, this.position(to.chunk, to.lx, to.y, to.lz), emission,
                    ALL_DIRECTIONS & ~(1 << 1), { empty: this.isEmptyShape(to.rule), emission: layer === 'block' });
                continue;
            }
            this.pushIncrease(layer, this.position(to.chunk, to.lx, to.y, to.lz), toLevel, 1 << OPPOSITE[direction]);
        }
    }

    flushDirtySections() {
        for (const section of this.dirtySections) {
            section.isModified = true;
            section.isDirty = true;
        }
        this.dirtySections.clear();
    }

    runUpdates(maxOperations = 4096) {
        let processed = 0;
        while (processed < maxOperations && this.hasWork()) {
            if (this.checkPositionIndex < this.checkPositions.length) {
                const position = this.checkPositions[this.checkPositionIndex++];
                this.checkPositionSet.delete(position);
                this.checkBlockPosition(position);
            } else if (!this.blockDecrease.empty) {
                this.blockDecrease.shift();
                this.propagateDecrease('block', this.blockDecrease.position, this.blockDecrease.data);
            } else if (!this.blockIncrease.empty) {
                this.blockIncrease.shift();
                this.propagateIncrease('block', this.blockIncrease.position, this.blockIncrease.data);
            } else if (!this.skyDecrease.empty) {
                this.skyDecrease.shift();
                this.propagateDecrease('sky', this.skyDecrease.position, this.skyDecrease.data);
            } else {
                this.skyIncrease.shift();
                this.propagateIncrease('sky', this.skyIncrease.position, this.skyIncrease.data);
            }
            processed++;
        }
        if (this.checkPositionIndex === this.checkPositions.length) {
            this.checkPositions.length = 0;
            this.checkPositionIndex = 0;
        }
        this.flushDirtySections();
        return processed;
    }

    processStreaming(deadline) {
        while (performance.now() < deadline && this.hasWork()) {
            const start = performance.now();
            this.runUpdates(8192);
            this.world.chunkProvider?.streamingMetrics?.record('nativeLightSliceMs', performance.now() - start);
        }
    }

    hasWork() {
        return this.checkPositionIndex < this.checkPositions.length || !this.blockDecrease.empty || !this.blockIncrease.empty || !this.skyDecrease.empty || !this.skyIncrease.empty;
    }
}
