import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { once } from 'node:events';

test('dedicated Vanillith terrain worker streams four native chunks independently', { timeout: 30000 }, async () => {
    const worker = new Worker(new URL('./terrain-worker-fixture.mjs', import.meta.url));
    try {
        assert.equal((await once(worker, 'message'))[0].type, 'ready');
        const coords = [[0, 0], [1, 0], [0, 1], [-1, 0]];
        worker.postMessage({ id: 1, request: { seed: '1', settings: 'overworld', coords } });
        const first = (await once(worker, 'message'))[0];
        assert.equal(first.id, 1);
        assert.equal(first.error, undefined);
        assert.equal(first.result.decorationDraft, undefined);
        assert.deepEqual(first.result.chunks.map(chunk => [chunk.chunkX, chunk.chunkZ]), coords);
        assert.ok(first.result.chunks.every(chunk => chunk.blocks.length === 98304));
        worker.postMessage({ id: 2, request: { seed: '1', settings: 'overworld', coords: [] } });
        const second = (await once(worker, 'message'))[0];
        assert.equal(second.id, 2);
        assert.match(second.error, /1..4/);
    } finally { await worker.terminate(); }
});
