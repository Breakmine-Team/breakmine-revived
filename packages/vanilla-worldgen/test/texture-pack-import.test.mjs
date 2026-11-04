import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTexturePackImagePaths } from '../../../src/js/net/minecraft/client/render/TexturePackImport.js';

test('Java resource pack singular 26.1 texture paths map to supported atlas entries', () => {
    assert.deepEqual(resolveTexturePackImagePaths('assets/minecraft/textures/block/stone.png'), ['blocks/stone.png']);
    assert.deepEqual(resolveTexturePackImagePaths('assets/minecraft/textures/item/iron_sword.png'), ['items/iron_sword.png']);
    assert.deepEqual(resolveTexturePackImagePaths('textures/block/diamond_ore.png'), ['blocks/diamond_ore.png']);
    assert.deepEqual(resolveTexturePackImagePaths('blocks/dirt.png'), ['blocks/dirt.png']);
});

test('Java modern vanilla filenames normalize to atlas names', () => {
    assert.deepEqual(resolveTexturePackImagePaths('assets/minecraft/textures/block/grass_block_top.png'), ['blocks/grass_top.png']);
    assert.deepEqual(resolveTexturePackImagePaths('assets/minecraft/textures/block/oak_log.png'), ['blocks/oak_log.png', 'blocks/log_oak.png']);
    assert.deepEqual(resolveTexturePackImagePaths('assets/minecraft/textures/block/oak_leaves.png'), ['blocks/oak_leaves.png', 'blocks/leaves_oak_opaque.png']);
    assert.deepEqual(resolveTexturePackImagePaths('assets/minecraft/textures/block/dirt_path_side.png'), ['blocks/grass_path_side.png']);
});

test('unsupported images, metadata, traversal paths and nested variants are skipped', () => {
    assert.equal(resolveTexturePackImagePaths('assets/minecraft/textures/block/stone.png.mcmeta'), null);
    assert.equal(resolveTexturePackImagePaths('assets/minecraft/models/block/stone.png'), null);
    assert.equal(resolveTexturePackImagePaths('../stone.png'), null);
    assert.equal(resolveTexturePackImagePaths('assets/other/textures/block/stone.png'), null);
    assert.equal(resolveTexturePackImagePaths('assets/minecraft/textures/block/copper_block.png'), null);
});
