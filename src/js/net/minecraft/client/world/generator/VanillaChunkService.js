import { createChunkService } from '../../../../../../../packages/vanilla-worldgen/chunk-service.mjs';
export { chunkTransferList } from '../../../../../../../packages/vanilla-worldgen/chunk-service.mjs';

const assets = {
    bytes: new URL('../../../../../../../packages/vanilla-worldgen/generated/worldgen.wasm', import.meta.url),
    climate: new URL('../../../../../../../packages/vanilla-worldgen/generated/climate.json', import.meta.url),
    data: new URL('../../../../../../../packages/vanilla-worldgen/generated/vanilla-data.json', import.meta.url),
    registry: new URL('../../../../../../../packages/vanilla-worldgen/generated/block-states.json', import.meta.url),
    stateRules: new URL('../../../../../../../packages/vanilla-worldgen/generated/block-rules.json', import.meta.url)
};

export function createWorkerChunkService({ terrainOnly = false, maxCachedChunks } = {}) {
    return Promise.all(Object.entries(assets).filter(([name]) => !terrainOnly || name !== 'stateRules').map(async ([name, url]) => {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Vanilla worldgen asset ${name}: HTTP ${response.status}`);
        return [name, name === 'bytes' ? await response.arrayBuffer() : await response.json()];
    })).then(entries => createChunkService({ ...Object.fromEntries(entries),
        ...(maxCachedChunks === undefined ? {} : { maxCachedChunks }) }));
}
