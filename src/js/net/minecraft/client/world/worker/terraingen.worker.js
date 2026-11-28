/*
 * Client-side terrain generation for multiplayer.
 *
 * The server sends a terrain descriptor (world type + seed) instead of chunk
 * payloads for flat and normal worlds, and this worker turns each requested
 * column into the same section payload a chunk packet carries. That keeps the
 * existing chunk pipeline (lighting, meshing) unchanged and keeps generation
 * off the render thread.
 */
import { generateColumnBlocks } from "../generator/ColumnGenerator.js";

const SECTION_COUNT = 16;
const SECTION_BLOCK_BYTES = 16 * 16 * 16 * 2;
const SECTION_LIGHT_BYTES = (16 * 16 * 16) / 2;
const SECTION_BYTES = SECTION_BLOCK_BYTES + SECTION_LIGHT_BYTES * 2;

function buildPayload(blocks) {
    const data = new Uint8Array(SECTION_COUNT * SECTION_BYTES);
    const view = new DataView(data.buffer, 0, data.length);

    for (let y = 0; y < 256; y++) {
        const sectionOffset = (y >> 4) * SECTION_BYTES;
        const yBase = y << 8;

        for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
                const id = blocks[yBase | (z << 4) | x] || 0;
                const localIndex = ((y & 15) << 8) | (z << 4) | x;
                view.setUint16(sectionOffset + localIndex * 2, (id << 4) & 0xFFFF, true);
            }
        }
    }

    // The chunk data worker recomputes both light maps; full sky light keeps
    // the main-thread fallback lit.
    for (let section = 0; section < SECTION_COUNT; section++) {
        const start = section * SECTION_BYTES + SECTION_BLOCK_BYTES + SECTION_LIGHT_BYTES;
        data.fill(0xFF, start, start + SECTION_LIGHT_BYTES);
    }

    return data;
}

self.onmessage = (event) => {
    const message = event.data;
    if (!message || message.type !== "generate") {
        return;
    }

    try {
        const blocks = generateColumnBlocks(message.worldType, message.seed, message.chunkX, message.chunkZ);
        const data = buildPayload(blocks);
        self.postMessage(
            { type: "generated", x: message.chunkX, z: message.chunkZ, mask: 0xFFFF, data: data },
            [data.buffer]
        );
    } catch (error) {
        self.postMessage({
            type: "error",
            x: message.chunkX,
            z: message.chunkZ,
            message: error && error.message ? error.message : String(error)
        });
    }
};
