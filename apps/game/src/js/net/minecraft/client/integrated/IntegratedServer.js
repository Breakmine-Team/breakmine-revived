// Integrated server controller (main thread). The singleplayer server itself
// runs in a Web Worker (integrated.worker.js) so world ticking, chunk
// generation and save I/O never block the render thread. This module owns the
// worker lifecycle, RPC (start/stop/listWorlds/deleteWorld) and routes
// loopback socket traffic to the worker through LoopbackServer.
import { globalLoopbackServer } from '../../util/IsomorphicWebSocket.js';
import { serverNameForKey } from './shared.js';

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
    };
    globalLoopbackServer.attachWorker(worker);

    return worker;
}

// Fire a message at the worker and resolve with its ack/result.
function post(message, transfer) {
    const w = ensureWorker();
    return new Promise((resolve, reject) => {
        const reqId = nextReqId++;
        pending.set(reqId, { resolve, reject });
        if (transfer) {
            w.postMessage({ ...message, reqId }, transfer);
        } else {
            w.postMessage({ ...message, reqId });
        }
    });
}

function handleWorkerMessage(msg) {
    if (!msg || typeof msg !== 'object') return;

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

export async function stopIntegratedServer() {
    if (stopPromise) return stopPromise;
    if (!integrated.running && !worker) return;

    stopPromise = (async () => {
        if (worker) {
            try {
                await post({ type: 'stop' });
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
