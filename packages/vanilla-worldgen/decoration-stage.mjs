import { readVanillaChunk } from './chunk-store.mjs';

const now = () => globalThis.performance?.now?.() ?? Date.now();

function loadSample(sampleChunk, x, z, onTerrainRead) {
    const start = onTerrainRead ? now() : 0;
    const chunk = readVanillaChunk(sampleChunk(x, z));
    if (onTerrainRead) onTerrainRead(now() - start);
    return chunk;
}

export function generateDecorationDraft({ chunkX, chunkZ, sampleChunk, decorateChunk, onTerrainRead, onChunkReady }) {
    if (![chunkX, chunkZ].every(value => Number.isInteger(value) && value >= -134217726 && value <= 134217724)) {
        throw new RangeError('Decoration neighborhood exceeds Java block coordinates');
    }
    if (typeof sampleChunk !== 'function' || typeof decorateChunk !== 'function') throw new TypeError('Decoration draft requires terrain and feature stages');
    const chunks = new Map();
    const reports = [];
    for (let z = chunkZ - 2; z <= chunkZ + 2; z++) for (let x = chunkX - 2; x <= chunkX + 2; x++) {
        const chunk = loadSample(sampleChunk, x, z, onTerrainRead);
        if (chunk.chunkX !== x || chunk.chunkZ !== z) throw new Error('Decoration terrain neighborhood context mismatch');
        chunks.set(`${x},${z}`, chunk);
    }
    for (let z = chunkZ - 1; z <= chunkZ + 1; z++) for (let x = chunkX - 1; x <= chunkX + 1; x++) {
        const report = decorateChunk({ chunks, chunkX: x, chunkZ: z });
        if (report?.then) throw new TypeError('Decoration stages must be synchronous');
        reports.push({ chunkX: x, chunkZ: z, featureCount: report.results.length, tickCount: report.ticks.length,
            postProcessing: report.postProcessing ?? [], blockEntities: report.blockEntities ?? [] });
    }
    const chunk = chunks.get(`${chunkX},${chunkZ}`).serialize();
    onChunkReady?.(chunk);
    return { chunk, reports,
        publication: 'draft-only', order: 'local-z-then-x', nativeOrderVerified: false };
}

export function generateDecorationDraftBatch({ coords, sampleChunk, decorateChunk, onTerrainRead, onChunkReady }) {
    if (!Array.isArray(coords) || !coords.length || !coords.every(([x, z]) =>
        Number.isInteger(x) && Number.isInteger(z) && x >= -134217726 && x <= 134217724 && z >= -134217726 && z <= 134217724)) {
        throw new RangeError('Decoration neighborhood exceeds Java block coordinates');
    }
    if (typeof sampleChunk !== 'function' || typeof decorateChunk !== 'function') throw new TypeError('Decoration draft requires terrain and feature stages');
    const terrainKeys = new Map();
    const sourceKeys = new Map();
    for (const [chunkX, chunkZ] of coords) {
        for (let z = chunkZ - 2; z <= chunkZ + 2; z++) for (let x = chunkX - 2; x <= chunkX + 2; x++) terrainKeys.set(`${x},${z}`, [x, z]);
        for (let z = chunkZ - 1; z <= chunkZ + 1; z++) for (let x = chunkX - 1; x <= chunkX + 1; x++) sourceKeys.set(`${x},${z}`, [x, z]);
    }
    const sort = (a, b) => a[1] - b[1] || a[0] - b[0];
    const chunks = new Map();
    for (const [x, z] of [...terrainKeys.values()].sort(sort)) {
        const chunk = loadSample(sampleChunk, x, z, onTerrainRead);
        if (chunk.chunkX !== x || chunk.chunkZ !== z) throw new Error('Decoration terrain neighborhood context mismatch');
        chunks.set(`${x},${z}`, chunk);
    }
    const reports = [];
    const decoratedSources = new Set();
    const emitted = new Set();
    for (const [chunkX, chunkZ] of [...sourceKeys.values()].sort(sort)) {
        const report = decorateChunk({ chunks, chunkX, chunkZ });
        if (report?.then) throw new TypeError('Decoration stages must be synchronous');
        reports.push({ chunkX, chunkZ, featureCount: report.results.length, tickCount: report.ticks.length,
            postProcessing: report.postProcessing ?? [], blockEntities: report.blockEntities ?? [] });
        decoratedSources.add(`${chunkX},${chunkZ}`);
        for (const [outputX, outputZ] of coords) {
            const outputKey = `${outputX},${outputZ}`;
            if (emitted.has(outputKey)) continue;
            let ready = true;
            for (let z = outputZ - 1; z <= outputZ + 1 && ready; z++) {
                for (let x = outputX - 1; x <= outputX + 1; x++) {
                    if (!decoratedSources.has(`${x},${z}`)) { ready = false; break; }
                }
            }
            if (ready) {
                emitted.add(outputKey);
                onChunkReady?.(chunks.get(outputKey).serialize());
            }
        }
    }
    return coords.map(([chunkX, chunkZ]) => ({
        chunk: chunks.get(`${chunkX},${chunkZ}`).serialize(),
        reports: reports.filter(report => Math.abs(report.chunkX - chunkX) <= 1 && Math.abs(report.chunkZ - chunkZ) <= 1),
        publication: 'draft-only', order: 'shared-z-then-x', nativeOrderVerified: false
    }));
}

export function createProgressiveDecorationSession() {
    return { chunks: new Map(), decoratedSources: new Set(), sourceReports: new Map() };
}

export function generateProgressiveDecorationDraft({ coords, sourcePlanCoords = coords, executeThroughCenter = null,
    sampleChunk, decorateChunk, onTerrainRead, session }) {
    if (!Array.isArray(coords) || !coords.length || !coords.every(([x, z]) =>
        Number.isInteger(x) && Number.isInteger(z) && x >= -134217726 && x <= 134217724 && z >= -134217726 && z <= 134217724)) {
        throw new RangeError('Decoration neighborhood exceeds Java block coordinates');
    }
    if (typeof sampleChunk !== 'function' || typeof decorateChunk !== 'function' ||
        !session || !(session.chunks instanceof Map) || !(session.decoratedSources instanceof Set)) {
        throw new TypeError('Progressive decoration requires terrain, feature stages, and a session');
    }
    const sourceKeys = new Map();
    if (!Array.isArray(sourcePlanCoords) || !sourcePlanCoords.length || !sourcePlanCoords.every(([x, z]) =>
        Number.isInteger(x) && Number.isInteger(z) && x >= -134217726 && x <= 134217724 && z >= -134217726 && z <= 134217724)) {
        throw new RangeError('Decoration source plan exceeds Java chunk coordinates');
    }
    for (const [chunkX, chunkZ] of sourcePlanCoords) {
        for (let z = chunkZ - 1; z <= chunkZ + 1; z++) for (let x = chunkX - 1; x <= chunkX + 1; x++) sourceKeys.set(`${x},${z}`, [x, z]);
    }
    const sort = (a, b) => a[1] - b[1] || a[0] - b[0];
    const orderedSources = [...sourceKeys.values()].sort(sort);
    let sourceLimit = orderedSources.length;
    if (executeThroughCenter) {
        const [centerX, centerZ] = executeThroughCenter;
        let lastRequiredIndex = -1;
        for (let index = 0; index < orderedSources.length; index++) {
            const [x, z] = orderedSources[index];
            if (Math.abs(x - centerX) <= 1 && Math.abs(z - centerZ) <= 1) lastRequiredIndex = index;
        }
        sourceLimit = lastRequiredIndex + 1;
    }
    const terrainKeys = new Map();
    for (const [chunkX, chunkZ] of orderedSources.slice(0, sourceLimit)) {
        for (let z = chunkZ - 1; z <= chunkZ + 1; z++) for (let x = chunkX - 1; x <= chunkX + 1; x++) terrainKeys.set(`${x},${z}`, [x, z]);
    }
    for (const [x, z] of [...terrainKeys.values()].sort(sort)) {
        const key = `${x},${z}`;
        if (session.chunks.has(key)) continue;
        const chunk = loadSample(sampleChunk, x, z, onTerrainRead);
        if (chunk.chunkX !== x || chunk.chunkZ !== z) throw new Error('Decoration terrain neighborhood context mismatch');
        session.chunks.set(key, chunk);
    }
    const executed = [];
    for (const [chunkX, chunkZ] of orderedSources.slice(0, sourceLimit)) {
        const key = `${chunkX},${chunkZ}`;
        if (session.decoratedSources.has(key)) continue;
        const report = decorateChunk({ chunks: session.chunks, chunkX, chunkZ });
        if (report?.then) throw new TypeError('Decoration stages must be synchronous');
        const summary = { chunkX, chunkZ, featureCount: report.results.length, tickCount: report.ticks.length,
            postProcessing: report.postProcessing ?? [], blockEntities: report.blockEntities ?? [] };
        session.decoratedSources.add(key);
        session.sourceReports.set(key, summary);
        executed.push(summary);
    }
    const reused = orderedSources.filter(([x, z]) => session.decoratedSources.has(`${x},${z}`)).length - executed.length;
    const deferred = sourceKeys.size - session.decoratedSources.size;
    return coords.map(([chunkX, chunkZ]) => ({
        chunk: session.chunks.get(`${chunkX},${chunkZ}`).serialize(),
        reports: [...session.sourceReports.values()].filter(report => Math.abs(report.chunkX - chunkX) <= 1 && Math.abs(report.chunkZ - chunkZ) <= 1),
        publication: 'draft-only', order: 'progressive-z-then-x', nativeOrderVerified: false,
        experimentalProgressiveReuse: true, sourceExecutionsThisRequest: executed.length,
        sourceReusesThisRequest: reused, sourceExecutionsDeferred: deferred
    }));
}
