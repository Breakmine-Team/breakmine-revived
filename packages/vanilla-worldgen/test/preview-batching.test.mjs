import test from 'node:test';
import assert from 'node:assert/strict';
import VanillaPreviewChunkProvider from '../../../src/js/net/minecraft/client/world/provider/VanillaPreviewChunkProvider.js';

test('decoration preview streams each chunk as soon as its write-neighborhood is complete', async () => {
    const calls = [];
    const events = [];
    const coordinates = [];
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) coordinates.push([dx, dz]);
    coordinates.sort((a, b) => a[0] ** 2 + a[1] ** 2 - b[0] ** 2 - b[1] ** 2);

    const provider = Object.create(VanillaPreviewChunkProvider.prototype);
    provider.closed = false;
    provider.error = null;
    provider.decorationFocus = '0,0';
    provider.decorationDesired = new Map(coordinates.map(pair => [pair.join(','), pair]));
    provider.desired = new Map(provider.decorationDesired);
    provider.chunks = new Map();
    provider.provisional = new Set();
    provider.source = {
        decorationDraft: true,
        store: { chunks: new Map() },
        async ensureDecorationTerrain(coords) { events.push(`terrain:${coords.length}`); },
        async getChunksAtAsync(coords, { onChunk }) {
            calls.push(coords);
            events.push(`decorate:${coords.length}`);
            const chunks = coords.map(([x, z]) => ({ chunkX: x, chunkZ: z, serialize() { return this; } }));
            for (const chunk of chunks) onChunk(chunk);
            return chunks;
        }
    };
    provider.world = { vanillaPreviewError: null };
    provider.onProgress = () => {};
    provider.loadVanillaChunk = payload => {
        const key = `${payload.chunkX},${payload.chunkZ}`;
        provider.chunks.set(key, payload);
        provider.provisional.delete(key);
    };

    await provider.pumpDecoration();

    assert.equal(calls.length, 1);
    assert.deepEqual(events, ['terrain:9', 'decorate:9']);
    assert.equal(calls[0].length, 9);
    assert.ok(calls[0].some(([x, z]) => x === 0 && z === 0));
    assert.equal(provider.chunks.size, 9);
});
