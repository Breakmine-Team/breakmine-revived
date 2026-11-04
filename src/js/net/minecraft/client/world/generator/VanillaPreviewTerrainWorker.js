import { createWorkerChunkService, chunkTransferList } from './VanillaChunkService.js';

let servicePromise;

self.onmessage = async ({ data }) => {
    const { id, request } = data;
    try {
        servicePromise ??= createWorkerChunkService({ terrainOnly: true, maxCachedChunks: 0 });
        const service = await servicePromise;
        const result = service.generate({ ...request, mode: 'terrain' });
        self.postMessage({ id, result }, chunkTransferList(result));
    } catch (error) {
        self.postMessage({ id, error: error?.message ?? String(error) });
    }
};
