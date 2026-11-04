import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';

globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer) };
globalThis.fetch = async url => new Response(await readFile(url));
await import('../../../src/js/net/minecraft/client/world/generator/VanillaPreviewTerrainWorker.js');
parentPort.on('message', data => self.onmessage({ data }));
parentPort.postMessage({ type: 'ready' });
