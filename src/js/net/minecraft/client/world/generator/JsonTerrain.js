/*
 * Client-side terrain for the QuickJSON "terrain" message.
 *
 * A server can describe its terrain once instead of sending chunk payloads:
 *
 *   {"type":"terrain","generator":"flat","viewDistance":4,
 *    "layers":[{"from":0,"to":0,"block":7},
 *              {"from":1,"to":7,"block":1},
 *              {"from":8,"to":8,"block":3},
 *              {"from":9,"to":9,"block":2}]}
 *
 * Chunks are built as the same payload the "chunk" message carries, so the
 * normal chunk pipeline (worker, lighting, meshing) handles them unchanged.
 * This module must stay free of game/render imports so it can be reused and
 * tested in isolation.
 */

const CHUNK_SIZE = 16;
const SECTION_VOLUME = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
const SECTION_BLOCK_BYTES = SECTION_VOLUME * 2;
const SECTION_LIGHT_BYTES = SECTION_VOLUME / 2;
const SECTION_BYTES = SECTION_BLOCK_BYTES + SECTION_LIGHT_BYTES * 2;
const SECTION_AMOUNT = 16;

const MIN_VIEW_DISTANCE = 2;
const MAX_VIEW_DISTANCE = 8;
const DEFAULT_VIEW_DISTANCE = 2;

function toInt(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number) : null;
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

// Normalizes a "terrain" JSON message, or returns null when it is not a
// generator the client understands.
export function parseTerrainDescriptor(message) {
    if (!message || typeof message !== "object") {
        return null;
    }

    if (message.generator !== "flat") {
        return null;
    }

    const layers = [];
    if (Array.isArray(message.layers)) {
        for (const rawLayer of message.layers) {
            if (!rawLayer || typeof rawLayer !== "object") continue;

            const block = toInt(rawLayer.block);
            if (block === null || block < 0 || block > 4095) continue;

            let from = toInt(rawLayer.from ?? rawLayer.y);
            let to = toInt(rawLayer.to ?? rawLayer.from ?? rawLayer.y);
            if (from === null || to === null) continue;

            if (from > to) {
                const swap = from;
                from = to;
                to = swap;
            }

            layers.push({
                from: clamp(from, 0, 255),
                to: clamp(to, 0, 255),
                block: block,
                metadata: clamp(toInt(rawLayer.metadata) ?? 0, 0, 15)
            });
        }
    }

    const viewDistance = toInt(message.viewDistance);

    return {
        generator: "flat",
        viewDistance: clamp(viewDistance ?? DEFAULT_VIEW_DISTANCE, MIN_VIEW_DISTANCE, MAX_VIEW_DISTANCE),
        skyLight: message.skyLight !== false,
        layers: layers
    };
}

// Builds one chunk payload (section 6 of the protocol spec) for the descriptor.
// Every chunk is identical for the flat generator, so servers can share the
// resulting bytes between chunks.
export function buildTerrainPayload(descriptor) {
    let maxY = 0;
    for (const layer of descriptor.layers) {
        maxY = Math.max(maxY, layer.to);
    }

    const sections = clamp(Math.floor(maxY / CHUNK_SIZE) + 1, 1, SECTION_AMOUNT);
    const mask = ((1 << sections) - 1) & 0xFFFF;

    const data = new Uint8Array(sections * SECTION_BYTES);
    const view = new DataView(data.buffer);

    for (const layer of descriptor.layers) {
        const state = ((layer.block & 0xFFF) << 4) | (layer.metadata & 0xF);
        const lastY = Math.min(layer.to, sections * CHUNK_SIZE - 1);

        for (let y = layer.from; y <= lastY; y++) {
            const section = y >> 4;
            const offset = section * SECTION_BYTES + (y & 15) * CHUNK_SIZE * CHUNK_SIZE * 2;

            for (let i = 0; i < CHUNK_SIZE * CHUNK_SIZE; i++) {
                view.setUint16(offset + i * 2, state, true);
            }
        }
    }

    if (descriptor.skyLight) {
        for (let section = 0; section < sections; section++) {
            const start = section * SECTION_BYTES + SECTION_BLOCK_BYTES + SECTION_LIGHT_BYTES;
            data.fill(0xFF, start, start + SECTION_LIGHT_BYTES);
        }
    }

    return { data, mask };
}

// A terrain message can arrive while the client world is still loading, so keep
// the descriptor until a world with a compatible chunk provider exists.
let queuedDescriptor = null;

export function clearQueuedTerrain() {
    queuedDescriptor = null;
}

export function queueTerrain(world, descriptor) {
    if (!descriptor) {
        return false;
    }

    if (applyTerrain(world, descriptor)) {
        queuedDescriptor = null;
        return true;
    }

    queuedDescriptor = descriptor;
    return false;
}

export function applyQueuedTerrain(world) {
    if (queuedDescriptor === null || !world) {
        return false;
    }

    if (!applyTerrain(world, queuedDescriptor)) {
        return false;
    }

    queuedDescriptor = null;
    return true;
}

function applyTerrain(world, descriptor) {
    if (!world || typeof world.getChunkProvider !== "function") {
        return false;
    }

    const provider = world.getChunkProvider();
    if (!provider || typeof provider.setTerrain !== "function") {
        return false;
    }

    provider.setTerrain(descriptor);

    const spawn = world.spawn || { x: 0, z: 0 };
    provider.updateTerrainChunks(spawn.x, spawn.z);
    return true;
}
