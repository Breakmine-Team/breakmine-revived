import { Buffer } from '../../../../../libraries/buffer.js';
import { deflate, inflate } from '../lib/pako.js';
import * as worldGen from './WorldGen.js';

export const SECTION_BLOCK_COUNT = 4096;              
export const SECTION_DATA_BYTES = SECTION_BLOCK_COUNT * 2; 
export const MAX_SECTION_INDEX = 15;                  





export function sectionIndex(lx, ly, lz) {
    return (ly << 8) | (lz << 4) | lx;
}

export function chunkCoords(x) {
    return x >> 4; 
}

class SubChunkStore {
    constructor(worldType = null) {
        this.worldType = worldType;
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

    
    generateSection(cx, cz, sy) {
        const out = Buffer.alloc(SECTION_DATA_BYTES);
        const baseY = sy * 16;
        const column = worldGen.getGeneratedColumn(cx, cz, this.worldType || undefined);

        for (let ly = 0; ly < 16; ly++) {
            const worldY = baseY + ly;
            if (worldY > 255) {
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

    
    getChunkSections(cx, cz) {
        const result = [];
        for (let sy = 0; sy <= MAX_SECTION_INDEX; sy++) {
            const data = this.get(cx, cz, sy);
            if (data) result.push({ sy, data });
        }
        return result;
    }


    
    serializeSections() {
        const out = [];
        for (const [key, data] of this.sections.entries()) {
            const [cx, cz, sy] = key.split(',').map(Number);
            out.push({ cx, cz, sy, data: deflate(data) });
        }
        return out;
    }

    
    static decompressSection(compressed, expectedBytes = SECTION_DATA_BYTES) {
        let raw;
        try {
            raw = inflate(compressed);
        } catch (e) {
            return null;
        }
        if (!raw || raw.length !== expectedBytes) return null;
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
