import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import { VanillaChunkStore } from '../chunk-store.mjs';

test('actual integrated worker routes modern generation, draft errors, seed changes and release', { timeout: 60000 }, async () => {
    const worker = new Worker(new URL('./integrated-worker-fixture.mjs', import.meta.url));
    const pending = new Map();
    let nextId = 1;
    const rpc = message => new Promise((resolve, reject) => {
        const reqId = nextId++;
        pending.set(reqId, { resolve, reject });
        worker.postMessage({ ...message, reqId });
    });
    try {
        const [ready] = await once(worker, 'message');
        assert.equal(ready.type, 'fixtureReady');
        worker.on('message', message => {
            const entry = pending.get(message.reqId);
            if (!entry) return;
            pending.delete(message.reqId);
            if (message.type === 'error') entry.reject(new Error(message.message));
            else entry.resolve(message.result);
        });
        worker.on('error', error => {
            for (const entry of pending.values()) entry.reject(error);
            pending.clear();
        });
        await rpc({ type: 'prepareVanillaChunkService' });
        const request = { seed: '9007199254740993', coords: [[0, 0]] };
        const first = await rpc({ type: 'generateVanillaChunks', request });
        assert.equal(first.seed, request.seed);
        assert.equal(first.playable, false);
        const store = new VanillaChunkStore();
        store.setBatch(first.chunks);
        assert.equal(store.getChunk(0, 0).blocks.length, 98304);
        const preload = await rpc({ type: 'preloadVanillaTerrainChunks', seed: request.seed, settings: 'overworld', chunks: first.chunks });
        assert.equal(preload.loaded, 1);
        assert.deepEqual(preload.terrainCacheKeys, ['0,0']);
        const [repeated, end] = await Promise.all([
            rpc({ type: 'generateVanillaChunks', request }),
            rpc({ type: 'generateVanillaChunks', request: { seed: '-1', settings: 'end', coords: [[0, 0]] } })
        ]);
        assert.deepEqual(repeated.chunks[0], first.chunks[0]);
        assert.equal(end.chunks[0].height, 128);
        await assert.rejects(rpc({ type: 'generateVanillaChunks', request: { ...request, mode: 'decoration_draft' } }), /Decoration draft 0,0:/);
        const afterDraft = await rpc({ type: 'generateVanillaChunks', request });
        assert.deepEqual(afterDraft.chunks[0], first.chunks[0]);
        assert.equal(afterDraft.decorationDraft, undefined);
        const saved = await rpc({ type: 'saveVanillaChunks', worldKey: 'test', seed: request.seed, settings: 'overworld', chunks: first.chunks });
        assert.equal(saved.saved, 1);
        const loaded = await rpc({ type: 'loadVanillaChunk', worldKey: 'test', seed: request.seed, settings: 'overworld', x: 0, z: 0 });
        const { biomeNames, ...loadedChunk } = loaded;
        assert.equal(biomeNames.length, 65);
        assert.deepEqual(loadedChunk, first.chunks[0]);
        assert.equal(await rpc({ type: 'loadVanillaChunk', worldKey: 'test', seed: '-1', settings: 'overworld', x: 0, z: 0 }), null);
        await assert.rejects(rpc({ type: 'saveVanillaChunks', worldKey: '../escape', seed: request.seed, settings: 'overworld', chunks: first.chunks }), /key/);
        await assert.rejects(rpc({ type: 'generateVanillaChunks', request: { seed: '1', coords: [] } }), /1..4/);
        await rpc({ type: 'releaseVanillaChunks' });
        const fresh = await rpc({ type: 'generateVanillaChunks', request });
        assert.deepEqual(fresh.chunks[0], first.chunks[0]);
    } finally { await worker.terminate(); }
});
