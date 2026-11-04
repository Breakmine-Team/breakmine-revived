// Integrated server controller (main thread). The singleplayer server itself
// runs in a Web Worker (integrated.worker.js) so world ticking, chunk
// generation and save I/O never block the render thread. This module owns the
// worker lifecycle, RPC (start/stop/listWorlds/deleteWorld) and routes
// loopback socket traffic to the worker through LoopbackServer.
import { globalLoopbackServer } from '../../util/IsomorphicWebSocket.js';
import { serverNameForKey } from './shared.js';
import { assertWorldGeneratorReady } from '../world/generator/VanillaWorldgenStatus.js';

export { serverNameForKey };

// worldKey is always 'w_<timestamp>_<random>'

export const integrated = {
    running: false,
    serverName: null,
};

let worker = null;
let nextReqId = 1;
const pending = new Map();
let stopPromise = null;

function ensureWorker() {
    if (worker) return worker;

    worker = new Worker(new URL('./integrated.worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => handleWorkerMessage(e.data);
    worker.onerror = (e) => {
        console.error('[IntegratedServer] worker error:', e && e.message, e && e.filename, e && e.lineno);
        for (const entry of pending.values()) entry.reject(new Error(e.message || 'Integrated server worker failed'));
        pending.clear();
    };
    globalLoopbackServer.attachWorker(worker);

    return worker;
}

// Fire a message at the worker and resolve with its ack/result.
function post(message, transfer, { onChunk } = {}) {
    const w = ensureWorker();
    return new Promise((resolve, reject) => {
        const reqId = nextReqId++;
        pending.set(reqId, { resolve, reject, onChunk });
        if (transfer) {
            w.postMessage({ ...message, reqId }, transfer);
        } else {
            w.postMessage({ ...message, reqId });
        }
    });
}

function handleWorkerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'chunk' && msg.reqId) {
        pending.get(msg.reqId)?.onChunk?.(msg.chunk);
        return;
    }

    if ((msg.type === 'ack' || msg.type === 'result') && msg.reqId) {
        const entry = pending.get(msg.reqId);
        if (entry) {
            pending.delete(msg.reqId);
            entry.resolve(msg.result);
        }
        return;
    }

    if (msg.type === 'error' && msg.reqId) {
        const entry = pending.get(msg.reqId);
        if (entry) {
            pending.delete(msg.reqId);
            entry.reject(new Error(msg.message || 'Integrated server worker error'));
        }
        return;
    }

    // Socket traffic relayed from the integrated server worker.
    globalLoopbackServer.handleWorkerMessage(msg);
}

export async function startIntegratedServer(options) {
    assertWorldGeneratorReady(options.worldType);
    // Wait for an in-flight stop so the worker processes start after stop.
    if (stopPromise) {
        try {
            await stopPromise;
        } catch (e) {
            // Ignore stop failures; proceed with the start.
        }
    }

    await post({ type: 'start', ...options });
    integrated.running = true;
    integrated.serverName = serverNameForKey(options.worldKey);
}

export async function generateVanillaChunks(request) {
    return await post({ type: 'generateVanillaChunks', request });
}

export async function generateVanillaChunksStreaming(request, onChunk) {
    return await post({ type: 'generateVanillaChunks', request, streamChunks: true }, undefined, { onChunk });
}

export async function preloadVanillaTerrainChunks(seed, settings, chunks) {
    return await post({ type: 'preloadVanillaTerrainChunks', seed, settings, chunks },
        [...new Set(chunks.flatMap(chunk => [chunk.blocks.buffer, chunk.biomes.buffer, chunk.heightmap.buffer,
            ...(chunk.fluidUpdates ? [chunk.fluidUpdates.buffer] : [])]))]);
}

export async function prepareVanillaChunkService() {
    return await post({ type: 'prepareVanillaChunkService' });
}

export async function saveVanillaChunks(worldKey, seed, settings, chunks) {
    if (!Array.isArray(chunks)) throw new TypeError('Vanilla chunks to save must be an array');
    if (chunks.length === 0) return { saved: 0 };
    let saved = 0;
    for (let offset = 0; offset < chunks.length; offset += 4) {
        const batch = chunks.slice(offset, offset + 4);
        const result = await post({ type: 'saveVanillaChunks', worldKey, seed, settings, chunks: batch });
        saved += result?.saved ?? batch.length;
    }
    return { saved };
}

export async function loadVanillaChunk(worldKey, seed, settings, x, z) {
    return await post({ type: 'loadVanillaChunk', worldKey, seed, settings, x, z });
}

export async function createVanillaChunkProvider(seed, settings = 'overworld', options = {}) {
    const { default: VanillaChunkProvider } = await import('../world/provider/VanillaChunkProvider.js');
    return new VanillaChunkProvider(seed, settings, options);
}

export async function releaseVanillaChunks() {
    if (worker) await post({ type: 'releaseVanillaChunks' });
}

export async function stopIntegratedServer() {
    if (stopPromise) return stopPromise;
    if (!integrated.running && !worker) return;

    stopPromise = (async () => {
        if (worker) {
            try {
                await post({ type: 'stop' });
                await releaseVanillaChunks();
            } catch (err) {
                console.error('[IntegratedServer] stop error:', err);
            }
        }
        integrated.running = false;
        integrated.serverName = null;
    })().finally(() => {
        stopPromise = null;
    });

    return stopPromise;
}

export function isIntegratedRunning() {
    return integrated.running;
}

export function getIntegratedServerName() {
    return integrated.serverName;
}

// World listing and deletion live in the worker (the owner of the world
// files), so the main thread never does synchronous reads over the world
// directory.

export async function listServerWorlds() {
    return await post({ type: 'listWorlds' });
}

export async function deleteServerWorld(worldKey) {
    // Wait for an in-flight stop (which saves the world) before removing its
    // files, otherwise the server's final save can recreate them.
    if (stopPromise) {
        try {
            await stopPromise;
        } catch (e) {
            // Ignore stop failures; proceed with the delete.
        }
    }
    await post({ type: 'deleteWorld', worldKey });
}
