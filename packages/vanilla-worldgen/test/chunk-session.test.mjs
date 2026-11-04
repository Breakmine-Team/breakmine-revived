import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../libraries/three.module.js';
import { Buffer } from '../../../libraries/buffer.js';
import { VanillaChunk } from '../chunk.mjs';
import { validateChunkOffer, acceptChunkAcknowledgement, VANILLA_SOURCE_SHA, VANILLA_CHUNK_ACK_ID, VANILLA_CHUNK_OFFER_ID, VANILLA_CHUNK_UNLOAD_ID } from '../chunk-session.mjs';
import World from '../../../src/js/net/minecraft/client/world/World.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import ChunkProviderClient from '../../../src/js/net/minecraft/client/world/provider/ChunkProviderClient.js';
import ByteBuf from '../../../src/js/net/minecraft/client/network/util/ByteBuf.js';
import ServerVanillaChunkOfferPacket from '../../../src/js/net/minecraft/client/network/packet/play/server/ServerVanillaChunkOfferPacket.js';
import ServerVanillaChunkUnloadPacket from '../../../src/js/net/minecraft/client/network/packet/play/server/ServerVanillaChunkUnloadPacket.js';
import { sendVanillaChunkOffer, sendVanillaChunkUnload } from '../../../src/js/net/minecraft/server/packets.js';
import { makePacket } from '../../../src/js/net/minecraft/server/protocol.js';
import { handlePacket } from '../../../src/js/net/minecraft/server/handlers.js';

globalThis.window ??= { addEventListener() {} };
const { default: NetworkPlayHandler } = await import('../../../src/js/net/minecraft/client/network/handler/NetworkPlayHandler.js');
new Block(1);

const offer = () => validateChunkOffer({ protocol: 1, source: VANILLA_SOURCE_SHA, token: 1, settings: 'overworld', minY: -64, height: 384 });

function client() {
    const world = Object.create(World.prototype);
    Object.assign(world, { minY: 0, maxY: 256, height: 256, skylightSubtracted: 0, chunkProvider: null, group: new THREE.Group(), lightUpdateQueue: [],
        minecraft: { settings: { ambientOcclusion: false }, player: null, worldRenderer: { chunkSectionUpdateQueue: [] } } });
    world.updateChunkLight = chunk => { world.lastLitChunk = chunk; };
    world.chunkProvider = new ChunkProviderClient(world);
    const handler = Object.create(NetworkPlayHandler.prototype);
    handler.minecraft = { world, allowExperimentalVanillaChunks: true };
    handler.networkManager = { sendPacket: packet => { handler.lastAck = packet; } };
    return { world, provider: world.chunkProvider, handler };
}

function terrainAtlas() {
    return { loaded: true, canvas: {}, textureMap: new Map(), texturesPerRow: 64, _nextModIndex: 0,
        async loadImage() { return { width: 16, height: 16 }; },
        registerModTexture(key) { this.textureMap.set(key, { index: this._nextModIndex++ }); } };
}

test('real atlas negotiation waits for textures and maps modern cubes before ACK', async () => {
    const { world, handler } = client();
    const atlas = terrainAtlas();
    handler.minecraft.worldRenderer = { textureAtlas: atlas };
    const pending = handler.handleVanillaChunkOffer({ offer: offer() });
    assert.equal(handler.lastAck, undefined);
    assert.equal(world.vanillaChunkProtocol, undefined);
    await pending;
    const fs = await import('node:fs/promises');
    const renderManifests = await Promise.all(['terrain-render', 'decoration-render', 'feature-render'].map(name =>
        fs.readFile(new URL(`../generated/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)));
    assert.equal(atlas.textureMap.size, new Set(renderManifests.flatMap(manifest => Object.keys(manifest.textures))).size);
    assert.equal(handler.lastAck.ack.accepted, true);
    const manifest = JSON.parse(await fs.readFile(new URL('../generated/terrain-render.json', import.meta.url), 'utf8'));
    const descriptor = manifest.blocks.find(block => block.name === 'minecraft:deepslate');
    const chunk = new VanillaChunk(0, 0);
    chunk.setBlock(0, -64, 0, descriptor.stateId);
    handler.handleVanillaChunkData({ chunk: chunk.serialize() });
    assert.equal(Block.getById(world.getBlockAt(0, -64, 0)).description, 'minecraft:deepslate');
    assert.equal(world.nativeChunks.getBlockState(0, -64, 0), descriptor.stateId);
});

test('texture failure and world replacement decline asynchronous offer without enabling old world', async t => {
    t.mock.method(console, 'error', () => {});
    for (const mode of ['failure', 'world-change']) {
        const { world, handler } = client();
        const atlas = terrainAtlas();
        atlas.loadImage = async () => {
            if (mode === 'failure') throw new Error('Cannot decode terrain PNG');
            handler.minecraft.world = {};
            return { width: 16, height: 16 };
        };
        handler.minecraft.worldRenderer = { textureAtlas: atlas };
        await handler.handleVanillaChunkOffer({ offer: offer() });
        assert.equal(handler.lastAck.ack.accepted, false);
        assert.equal(world.vanillaChunkProtocol, undefined);
        assert.equal(world.height, 256);
        assert.equal(handler.pendingVanillaOffer, null);
        assert.ok(handler.vanillaTerrainError instanceof Error);
    }
});

test('offers validate pinned source, protocol and dimension-specific ranges', () => {
    assert.throws(() => validateChunkOffer({ ...offer(), source: 'wrong' }), /Unsupported/);
    assert.throws(() => validateChunkOffer({ ...offer(), height: 256 }), /range/);
    assert.throws(() => validateChunkOffer({ ...offer(), token: 0 }), /Unsupported/);
    assert.equal(validateChunkOffer({ ...offer(), settings: 'end', minY: 0, height: 128 }).height, 128);
});

test('actual offer framing, client configuration, ACK encoding and server dispatch negotiate a session', async () => {
    const { world, provider, handler } = client();
    let framed;
    const player = { experimentalVanillaChunks: true, protocolState: 'play', ws: { readyState: 1, send: bytes => { framed = bytes; } } };
    sendVanillaChunkOffer(player);
    assert.equal(player.vanillaChunkProtocol, undefined);
    const bytes = new ByteBuf(new Uint8Array(framed));
    bytes.readVarInt();
    assert.equal(bytes.readVarInt(), VANILLA_CHUNK_OFFER_ID);
    const packet = new ServerVanillaChunkOfferPacket();
    packet.read(bytes);
    await packet.handle(handler);
    assert.equal(world.minY, -64);
    assert.equal(world.maxY, 320);
    assert.equal(provider.emptyChunk.sections.length, 24);
    const ack = new ByteBuf();
    handler.lastAck.write(ack);
    handlePacket(player, makePacket(VANILLA_CHUNK_ACK_ID, Buffer.from(ack.array)));
    assert.equal(player.vanillaChunkProtocol, 1);
    assert.equal(player.pendingVanillaOffer, null);
    assert.throws(() => acceptChunkAcknowledgement(player, handler.lastAck.ack), /Unexpected/);
});

test('disabled clients decline offers without changing the classic world', () => {
    const { world, handler } = client();
    handler.minecraft.allowExperimentalVanillaChunks = false;
    handler.handleVanillaChunkOffer({ offer: offer() });
    assert.equal(handler.lastAck.ack.accepted, false);
    assert.equal(world.height, 256);
    assert.equal(world.vanillaChunkProtocol, undefined);
    const player = { pendingVanillaOffer: offer() };
    assert.equal(acceptChunkAcknowledgement(player, handler.lastAck.ack), false);
    assert.equal(player.vanillaChunkProtocol, 0);
});

test('native packet handler attaches sections to scene and preserves unsigned native state data', () => {
    const { world, provider, handler } = client();
    handler.handleVanillaChunkOffer({ offer: offer() });
    const chunk = new VanillaChunk(-1, 0);
    chunk.setBlock(15, -64, 1, 1);
    chunk.setBlock(15, 319, 1, 1);
    handler.handleVanillaChunkData({ chunk: chunk.serialize() });
    const rendered = provider.getChunkAt(-1, 0);
    assert.equal(rendered.group.parent, world.group);
    assert.equal(rendered.getSection(-4).group.position.y, -64);
    assert.equal(rendered.getSection(19).boundingBox.max.y, 320);
    assert.equal(world.getBlockAt(-1, -64, 1), 1);
    assert.equal(world.nativeChunks.getBlockState(-1, 319, 1), 1);
    assert.equal(world.lastLitChunk, rendered);
    assert.throws(() => handler.handleChunkData({}), /Legacy/);
});

test('unsupported replacement fails before removing the previous render/native chunk', () => {
    const { world, provider, handler } = client();
    handler.handleVanillaChunkOffer({ offer: offer() });
    const chunk = new VanillaChunk(0, 0);
    chunk.setBlock(0, 0, 0, 1);
    handler.handleVanillaChunkData({ chunk: chunk.serialize() });
    const previous = provider.getChunkAt(0, 0);
    chunk.setBlock(0, 0, 0, 35722);
    assert.throws(() => handler.handleVanillaChunkData({ chunk: chunk.serialize() }), /Unsupported render mapping/);
    assert.equal(provider.getChunkAt(0, 0), previous);
    assert.equal(previous.group.parent, world.group);
    assert.equal(world.nativeChunks.getBlockState(0, 0, 0), 1);
});

test('modern coordinate keys, unload packets and clear keep scene/cache/queue aligned', () => {
    const { world, provider, handler } = client();
    handler.handleVanillaChunkOffer({ offer: offer() });
    for (const [x, z] of [[65536, 0], [0, 1]]) handler.handleVanillaChunkData({ chunk: new VanillaChunk(x, z).serialize() });
    assert.equal(provider.getChunks().size, 2);
    const removed = provider.getChunkAt(65536, 0);
    world.minecraft.worldRenderer.chunkSectionUpdateQueue.push(removed.sections[0], provider.getChunkAt(0, 1).sections[0]);
    let framed;
    sendVanillaChunkUnload({ vanillaChunkProtocol: 1, ws: { send: bytes => { framed = bytes; } } }, 65536, 0);
    const bytes = new ByteBuf(new Uint8Array(framed));
    bytes.readVarInt();
    assert.equal(bytes.readVarInt(), VANILLA_CHUNK_UNLOAD_ID);
    const packet = new ServerVanillaChunkUnloadPacket();
    packet.read(bytes);
    packet.handle(handler);
    assert.equal(removed.group.parent, null);
    assert.equal(world.nativeChunks.getChunk(65536, 0), undefined);
    assert.equal(provider.getChunks().size, 1);
    assert.equal(world.minecraft.worldRenderer.chunkSectionUpdateQueue.length, 1);
    provider.clearChunks();
    assert.equal(world.group.children.length, 0);
    assert.equal(world.nativeChunks.chunks.size, 0);
    assert.equal(world.minecraft.worldRenderer.chunkSectionUpdateQueue.length, 0);
});

test('populated worlds cannot silently switch coordinate and storage formats', () => {
    const { world, provider, handler } = client();
    provider.loadChunk(0, 0);
    assert.throws(() => handler.handleVanillaChunkOffer({ offer: offer() }), /populated/);
    assert.equal(world.height, 256);
    assert.equal(provider.getChunks().size, 1);
});
