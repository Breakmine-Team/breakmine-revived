import { Buffer } from '../../../../../libraries/buffer.js';
import { deflate, inflate } from '../lib/pako.js';
import * as worldGen from './WorldGen.js';

export const SECTION_BLOCK_COUNT = 4096;              // 16 * 16 * 16
export const SECTION_DATA_BYTES = SECTION_BLOCK_COUNT * 2; // u16 block states
export const MAX_SECTION_INDEX = 15;                  // y = 0..255 in 16 sections

// A stored section is a flat array of 4096 u16 block states in the same order
// the chunk packet uses: (y << 8) | (z << 4) | x, with y/z/x the in-section
// coordinates. Keeping one canonical layout means a stored section can be
// memcpy'd straight into a chunk column and read back with the same index math.
export function sectionIndex(lx, ly, lz) {
    return (ly << 8) | (lz << 4) | lx;
}

export function chunkCoords(x) {
    return x >> 4; // floor division by 16, correct for negatives
}

/**
 * Stores every modified 16x16x16 subchunk of a world.
 *
 * The previous format kept a flat "x,y,z -> blockState" map of individual
 * changes. That made a save proportional to the number of blocks ever touched,
 * forced every chunk packet to re-scan the entire change list, and left the
 * world with no notion of "this chunk is mine" -- so chunks could be sent from
 * one set of data and re-saved from another. Storing whole modified subchunks
 * instead means the in-memory world, the chunk packets and the file on disk all
 * read the same bytes, and only chunks the player actually built in are kept.
 */
class SubChunkStore {
    constructor() {
        // key "cx,cz,sy" -> Uint8Array(SECTION_DATA_BYTES) of u16 LE block states
        this.sections = new Map();
        this.dirty = new Set();
    }

    clear() {
        this.sections.clear();
        this.dirty.clear();
    }

    get size() {
        return this.sections.size;
    }

    has(cx, cz, sy) {
        return this.sections.has(`${cx},${cz},${sy}`);
    }

    /**
     * Returns the stored section for a subchunk, materializing it from the
     * terrain generator on first touch. A section that has never been modified
     * stays absent and is regenerated on demand, so an untouched world costs
     * nothing in memory.
     */
    getOrCreate(cx, cz, sy) {
        const key = `${cx},${cz},${sy}`;
        let data = this.sections.get(key);
        if (data) return data;
        data = this.generateSection(cx, cz, sy);
        this.sections.set(key, data);
        this.dirty.add(key);
        return data;
    }

    get(cx, cz, sy) {
        return this.sections.get(`${cx},${cz},${sy}`);
    }

    /**
     * Fills a section with the terrain the generator would produce, so a single
     * block change does not have to store 4096 deltas.
     */
    generateSection(cx, cz, sy) {
        const out = Buffer.alloc(SECTION_DATA_BYTES);
        const baseY = sy * 16;
        const column = worldGen.getGeneratedColumn(cx, cz);

        for (let ly = 0; ly < 16; ly++) {
            const worldY = baseY + ly;
            if (worldY > 255) {
                // Above the buildable range; leave air.
                for (let lz = 0; lz < 16; lz++) {
                    for (let lx = 0; lx < 16; lx++) out.writeUInt16LE(0, sectionIndex(lx, ly, lz) * 2);
                }
                continue;
            }
            for (let lz = 0; lz < 16; lz++) {
                for (let lx = 0; lx < 16; lx++) {
                    const id = column ? column[sectionIndex(lx, worldY, lz)] : worldGen.getFlatBlockId(worldY);
                    out.writeUInt16LE(id << 4, sectionIndex(lx, ly, lz) * 2);
                }
            }
        }
        return out;
    }

    /** Reads a block state, or null when the subchunk is not stored. */
    readBlockState(x, y, z) {
        if (y < 0 || y > 255) return null;
        const data = this.get(chunkCoords(x), chunkCoords(z), y >> 4);
        if (!data) return null;
        return data.readUInt16LE(sectionIndex(x & 15, y & 15, z & 15) * 2);
    }

    writeBlockState(x, y, z, blockState) {
        if (y < 0 || y > 255) return false;
        const data = this.getOrCreate(chunkCoords(x), chunkCoords(z), y >> 4);
        data.writeUInt16LE(blockState & 0xFFFF, sectionIndex(x & 15, y & 15, z & 15) * 2);
        return true;
    }

    /** Every non-air position in a stored section, for block-tick seeding. */
    forEachModifiedBlock(callback) {
        for (const [key, data] of this.sections.entries()) {
            const [cx, cz, sy] = key.split(',').map(Number);
            for (let ly = 0; ly < 16; ly++) {
                const y = sy * 16 + ly;
                for (let lz = 0; lz < 16; lz++) {
                    for (let lx = 0; lx < 16; lx++) {
                        const idx = sectionIndex(lx, ly, lz);
                        const state = data.readUInt16LE(idx * 2);
                        if ((state >> 4) !== 0) {
                            callback(cx * 16 + lx, y, cz * 16 + lz, state);
                        }
                    }
                }
            }
        }
    }

    /**
     * Overlays every stored section belonging to a chunk column onto a freshly
     * generated section array set. Returns the per-section arrays so the caller
     * can write them into the packet buffer.
     */
    getChunkSections(cx, cz) {
        const result = [];
        for (let sy = 0; sy <= MAX_SECTION_INDEX; sy++) {
            const data = this.get(cx, cz, sy);
            if (data) result.push({ sy, data });
        }
        return result;
    }

    // ------------------------------------------------------------------
    //  Serialization
    // ------------------------------------------------------------------

    /**
     * Compresses every stored subchunk with raw DEFLATE. Terrain-derived data
     * is highly repetitive so this shrinks a section far below its 8 KB raw
     * size, and a section that was only lightly edited stays tiny.
     */
    serializeSections() {
        const out = [];
        for (const [key, data] of this.sections.entries()) {
            const [cx, cz, sy] = key.split(',').map(Number);
            out.push({ cx, cz, sy, data: deflate(data) });
        }
        return out;
    }

    /**
     * Inflates one stored section. Returns null if the payload is corrupt or
     * the wrong size, so a damaged entry drops that one subchunk instead of
     * taking the whole world down with it.
     */
    static decompressSection(compressed, expectedBytes = SECTION_DATA_BYTES) {
        let raw;
        try {
            raw = inflate(compressed);
        } catch (e) {
            return null;
        }
        if (!raw || raw.length !== expectedBytes) return null;
        // pako hands back a plain Uint8Array; the rest of the world works in
        // Buffer, so copy into one to get read/writeUInt16LE and copy().
        return Buffer.from(raw);
    }

    loadSection(cx, cz, sy, compressed) {
        const data = SubChunkStore.decompressSection(compressed);
        if (!data) return false;
        this.sections.set(`${cx},${cz},${sy}`, data);
        return true;
    }
}

export { SubChunkStore };
export default SubChunkStore;
