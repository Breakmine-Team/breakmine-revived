import { atlasBlockTextures, atlasItemTextures } from '../../../../assetManifest.js';

const blockAliases = Object.freeze({
    grass_top: 'grass_block_top',
    grass_side: 'grass_block_side',
    log_oak: 'oak_log',
    log_oak_top: 'oak_log_top',
    leaves_oak_opaque: 'oak_leaves',
    torch_on: 'torch',
    grass_path_top: 'dirt_path_top',
    grass_path_side: 'dirt_path_side',
    chest_bottom: 'chest',
    chest_side: 'chest',
    chest_front: 'chest',
    brick: 'bricks',
    grass: 'short_grass',
    lava: 'lava_still'
});

const blockNames = new Set(atlasBlockTextures.map(name => name.replace(/\.png$/i, '')));
const itemNames = new Set(atlasItemTextures.map(name => name.replace(/\.png$/i, '')));

export function resolveTexturePackImagePaths(path) {
    if (typeof path !== 'string' || !path.toLowerCase().endsWith('.png')) return null;
    const match = path.match(/^(?:assets\/minecraft\/)?textures\/(block|blocks|item|items)\/([^/]+\.png)$/i)
        ?? path.match(/^(?:assets\/minecraft\/textures\/)?(block|blocks|item|items)\/([^/]+\.png)$/i)
        ?? path.match(/^(block|blocks|item|items)\/([^/]+\.png)$/i);
    if (!match) return null;
    const directory = match[1].toLowerCase(), filename = match[2];
    const name = filename.slice(0, -4);
    if (directory === 'block' || directory === 'blocks') {
        const requestedName = blockNames.has(name) ? name : Object.keys(blockAliases).find(alias => blockAliases[alias] === name);
        const destinations = new Set();
        if (requestedName) destinations.add(requestedName);
        if (blockNames.has(name)) destinations.add(name);
        for (const [legacyName, modernName] of Object.entries(blockAliases)) {
            if (modernName === name && blockNames.has(legacyName)) destinations.add(legacyName);
        }
        return destinations.size ? [...destinations].map(target => `blocks/${target}.png`) : null;
    }
    return itemNames.has(name) ? [`items/${name}.png`] : null;
}
