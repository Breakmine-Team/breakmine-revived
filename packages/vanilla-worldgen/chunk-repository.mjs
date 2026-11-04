import { encodeVanillaChunk, decodeVanillaChunk } from './chunk-codec.mjs';
import { parseSeed } from './runtime.mjs';

export function chunkSaveContext(seed, settings) {
    if (!['overworld', 'large_biomes', 'amplified', 'nether', 'end'].includes(settings)) throw new RangeError('Invalid saved noise settings');
    return { seed: parseSeed(seed).toString(), settings };
}

export class VanillaChunkRepository {
    constructor(fs, root) { this.fs = fs; this.root = root; this.queue = Promise.resolve(); }

    location(worldKey, seed, settings) {
        if (typeof worldKey !== 'string' || !/^[a-z0-9_]{1,80}$/.test(worldKey)) throw new RangeError('Invalid modern world key');
        const context = chunkSaveContext(seed, settings);
        // Generation contexts never overwrite one another, including dimension switches.
        return `${this.root}/${worldKey}/vanilla_chunks_v1/26_3_4508d006/${context.settings}/${context.seed}`;
    }

    async load(worldKey, seed, settings, x, z) {
        const directory = this.location(worldKey, seed, settings);
        if (![x, z].every(value => Number.isInteger(value) && value >= -134217728 && value <= 134217726)) throw new RangeError('Invalid chunk coordinates');
        const file = `${directory}/${x}_${z}.bmvc`;
        if (!this.fs.existsSync(file)) return null;
        const chunk = decodeVanillaChunk(new Uint8Array(await this.fs.readFile(file, null)));
        if (chunk.chunkX !== x || chunk.chunkZ !== z) throw new Error('Saved chunk coordinates do not match filename');
        const [minY, height] = ['nether', 'end'].includes(settings) ? [0, 128] : [-64, 384];
        if (chunk.minY !== minY || chunk.height !== height) throw new Error('Saved chunk range does not match noise settings');
        return chunk;
    }

    save(worldKey, seed, settings, payloads) {
        const task = this.queue.then(async () => {
            const directory = this.location(worldKey, seed, settings);
            if (!Array.isArray(payloads) || payloads.length < 1 || payloads.length > 4) throw new RangeError('Expected 1..4 chunks to save');
            const [minY, height] = ['nether', 'end'].includes(settings) ? [0, 128] : [-64, 384];
            const encoded = payloads.map(chunk => {
                if (chunk.minY !== minY || chunk.height !== height) throw new Error('Chunk range does not match saved noise settings');
                return { x: chunk.chunkX, z: chunk.chunkZ, bytes: encodeVanillaChunk(chunk) };
            });
            this.fs.mkdirSync(directory, { recursive: true });
            for (const chunk of encoded) await this.fs.writeFileDurable(`${directory}/${chunk.x}_${chunk.z}.bmvc`, chunk.bytes);
            return { saved: encoded.length };
        });
        this.queue = task.catch(() => {});
        return task;
    }
}
