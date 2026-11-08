




import { globalLoopbackServer } from '../../util/IsomorphicWebSocket.js';
import { serverNameForKey } from './shared.js';

export { serverNameForKey };



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

    globalLoopbackServer.handleWorkerMessage(msg);
}

export async function startIntegratedServer(options) {
    if (stopPromise) {
        try {
            await stopPromise;
        } catch (e) {
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





export async function listServerWorlds() {
    return await post({ type: 'listWorlds' });
}





export async function saveWorldIcon(worldKey, pngBytes) {
    const data = pngBytes instanceof Uint8Array ? pngBytes : new Uint8Array(pngBytes);
    const payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    await post({ type: 'saveWorldIcon', worldKey, data: payload }, [payload]);
}

export async function deleteServerWorld(worldKey) {
    if (stopPromise) {
        try {
            await stopPromise;
        } catch (e) {
        }
    }
    await post({ type: 'deleteWorld', worldKey });
}
