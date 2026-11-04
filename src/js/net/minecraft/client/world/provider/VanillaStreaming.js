export const STREAM_MEMORY_PRESETS = Object.freeze({
    low: { nativeBytes: 64 * 1024 ** 2, renderBytes: 32 * 1024 ** 2, terrainBytes: 32 * 1024 ** 2, idleRadius: 1 },
    balanced: { nativeBytes: 256 * 1024 ** 2, renderBytes: 128 * 1024 ** 2, terrainBytes: 64 * 1024 ** 2, idleRadius: 2 },
    high: { nativeBytes: 768 * 1024 ** 2, renderBytes: 384 * 1024 ** 2, terrainBytes: 128 * 1024 ** 2, idleRadius: 3 },
    // ~2.1 GiB managed caches; the rest of a 3 GiB target is headroom,
    // not an enforceable process-wide/browser memory limit.
    extreme: { nativeBytes: 1536 * 1024 ** 2, renderBytes: 384 * 1024 ** 2, terrainBytes: 128 * 1024 ** 2, idleRadius: 3 }
});

export function nativeChunkBytes(chunk) {
    return ['blocks', 'biomes', 'heightmap', 'fluidUpdates'].reduce((sum, name) => sum + (chunk[name]?.byteLength ?? 0), 0);
}

export function customMemoryBudget(targetMiB) {
    const bytes = Math.max(256, Math.min(3072, Number(targetMiB) || 640)) * 1024 ** 2;
    return { nativeBytes: Math.floor(bytes * .5), renderBytes: Math.floor(bytes * .125),
        terrainBytes: Math.floor(bytes * .0625), lodBytes: Math.floor(bytes * .02), idleRadius: 3 };
}

export class StreamingMetrics {
    constructor(limit = 2048) { this.limit = limit; this.samples = new Map(); this.counts = {}; }
    count(name, n = 1) { this.counts[name] = (this.counts[name] ?? 0) + n; }
    record(name, value) {
        if (!Number.isFinite(value) || value < 0) return;
        let sample = this.samples.get(name);
        if (!sample) { sample = { values: [], cursor: 0, count: 0, total: 0, max: 0, over16: 0, over33: 0, over50: 0 }; this.samples.set(name, sample); }
        sample.count++; sample.total += value; sample.max = Math.max(sample.max, value);
        sample.over16 += value > 16.7; sample.over33 += value > 33.3; sample.over50 += value > 50;
        if (sample.values.length < this.limit) sample.values.push(value);
        else { sample.values[sample.cursor] = value; sample.cursor = (sample.cursor + 1) % this.limit; }
    }
    snapshot() {
        const timings = {};
        for (const [name, sample] of this.samples) {
            const values = [...sample.values].sort((a, b) => a - b);
            const q = p => values[Math.floor((values.length - 1) * p)] ?? 0;
            timings[name] = { count: sample.count, total: sample.total, median: q(.5), p95: q(.95), p99: q(.99), max: sample.max,
                over16: sample.over16, over33: sample.over33, over50: sample.over50, retainedSamples: values.length };
        }
        return { counts: { ...this.counts }, timings };
    }
}

// Cache completed generation results. Live world edits need persistence before
// their chunks can be evicted.
export class StreamingLRU {
    constructor(budget, dispose = () => {}) { this.budget = budget; this.dispose = dispose; this.entries = new Map(); this.bytes = 0; this.hits = 0; this.misses = 0; this.evictions = 0; }
    get(key) {
        const entry = this.entries.get(key);
        if (!entry) { this.misses++; return; }
        this.hits++; this.entries.delete(key); this.entries.set(key, entry); return entry.value;
    }
    put(key, value, bytes, pinned = new Set()) {
        this.delete(key);
        if (bytes > this.budget) { this.dispose(value, key); return; }
        this.entries.set(key, { value, bytes }); this.bytes += bytes; this.trim(pinned);
    }
    trim(pinned = new Set()) {
        for (const key of this.entries.keys()) {
            if (this.bytes <= this.budget) break;
            if (!pinned.has(key)) { this.delete(key); this.evictions++; }
        }
    }
    delete(key) {
        const entry = this.entries.get(key);
        if (!entry) return;
        this.entries.delete(key); this.bytes -= entry.bytes; this.dispose(entry.value, key);
    }
    take(key) {
        const value = this.get(key), entry = this.entries.get(key);
        if (entry) { this.entries.delete(key); this.bytes -= entry.bytes; }
        return value;
    }
    clear() { for (const key of this.entries.keys()) this.delete(key); }
    snapshot() { return { entries: this.entries.size, bytes: this.bytes, budget: this.budget, hits: this.hits, misses: this.misses, evictions: this.evictions }; }
}

export function streamingDemand({ x, z, velocityX = 0, velocityZ = 0, yaw = 0, radius = 3, idleRadius = 0, backgroundRadius }) {
    const speed = Math.hypot(velocityX, velocityZ);
    const vx = speed > .1 ? velocityX / speed : 0, vz = speed > .1 ? velocityZ / speed : 0;
    const angle = yaw * Math.PI / 180, viewX = -Math.sin(angle), viewZ = Math.cos(angle);
    const outerRadius = Math.max(radius, Math.floor(backgroundRadius ?? radius + idleRadius));
    // Predict by travel distance, not camera direction. Keep a two-chunk
    // moving buffer for ordinary walking and extend it with faster movement.
    const lookAhead = speed > .1 ? Math.min(outerRadius, Math.max(2, Math.ceil(speed * 1.25 / 16))) : 0;
    const coordinates = [];
    for (let dx = -outerRadius; dx <= outerRadius; dx++) for (let dz = -outerRadius; dz <= outerRadius; dz++) {
        const distance = Math.hypot(dx, dz), ring = Math.max(Math.abs(dx), Math.abs(dz));
        const along = dx * vx + dz * vz, across = Math.abs(dx * vz - dz * vx);
        const viewAlong = dx * viewX + dz * viewZ;
        const viewAcross = Math.abs(dx * viewZ - dz * viewX);
        const inMotionCorridor = speed > .1 && along > 0 && across <= 1.5 && along <= lookAhead + 1;
        const inViewCorridor = speed > .1 && viewAlong > 0 && viewAcross <= 1.5 && viewAlong <= lookAhead + 1;
        // P0 is the immediate 3x3. P1 follows actual motion; the current view
        // is also P1 so a hard turn is warmed immediately, but sorts behind
        // the actual movement corridor. Camera yaw otherwise only breaks ties.
        const tier = ring <= 1 ? 0 : inMotionCorridor || inViewCorridor ? 1 : ring > radius ? 4 : 2;
        const motionBias = inMotionCorridor ? 0 : inViewCorridor ? 1500 : 0;
        coordinates.push({ key: `${x + dx},${z + dz}`, coordinate: [x + dx, z + dz], tier,
            priority: tier * 10000 + motionBias + distance * 100 - Math.min(100, along * speed)
                - Math.max(0, viewAlong) * 10 });
    }
    return coordinates.sort((a, b) => a.priority - b.priority || a.coordinate[0] - b.coordinate[0] || a.coordinate[1] - b.coordinate[1]);
}
