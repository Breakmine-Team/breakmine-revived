import { parentPort } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';

globalThis.self = {
    postMessage: (message, transfer) => parentPort.postMessage(message, transfer)
};
globalThis.fetch = async url => {
    const data = await readFile(url);
    return new Response(data);
};
const { default: serverFs } = await import('../../../src/js/net/minecraft/client/fs/ServerFs.js');
const files = new Map();
serverFs.existsSync = file => files.has(file);
serverFs.mkdirSync = () => {};
serverFs.writeFileDurable = async (file, bytes) => files.set(file, new Uint8Array(bytes));
serverFs.readFile = async file => {
    if (!files.has(file)) throw new Error('ENOENT');
    return new Uint8Array(files.get(file));
};
await import('../../../src/js/net/minecraft/client/integrated/integrated.worker.js');
parentPort.on('message', data => self.onmessage({ data }));
parentPort.postMessage({ type: 'fixtureReady' });
