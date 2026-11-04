import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VanillaChunk } from '../chunk.mjs';
import { VanillaChunkStore } from '../chunk-store.mjs';
import { encodeVanillaChunk, decodeVanillaChunk, MODERN_CHUNK_PACKET_ID } from '../chunk-codec.mjs';
import { VanillaChunkRepository } from '../chunk-repository.mjs';
import { IsomorphicFilesystem } from '../../../src/js/net/minecraft/client/fs/IsomorphicFilesystem.js';
import ByteBuf from '../../../src/js/net/minecraft/client/network/util/ByteBuf.js';
import ProtocolState from '../../../src/js/net/minecraft/client/network/ProtocolState.js';
import ServerVanillaChunkDataPacket from '../../../src/js/net/minecraft/client/network/packet/play/server/ServerVanillaChunkDataPacket.js';
import { sendVanillaChunk } from '../../../src/js/net/minecraft/server/packets.js';
import BrowserFilesystem from '../../../src/js/net/minecraft/client/fs/Filesystem.js';

// The legacy registry imports a browser-only AES library at module load.
globalThis.window ??= { addEventListener() {} };
const { default: PacketRegistry } = await import('../../../src/js/net/minecraft/client/network/PacketRegistry.js');
const { default: NetworkPlayHandler } = await import('../../../src/js/net/minecraft/client/network/handler/NetworkPlayHandler.js');

function sample() {
    const chunk = new VanillaChunk(-1, 65536);
    chunk.setBlock(15, -64, 15, 0xffffffff);
    chunk.setBlock(0, 319, 0, 35722);
    chunk.setBiome(0, -64, 0, 65535);
    chunk.heightmap[0] = 320;
    chunk.fluidUpdates = new Uint8Array(chunk.blocks.length);
    chunk.fluidUpdates[chunk.index(15, -64, 15)] = 1;
    return chunk.serialize();
}

test('binary chunk codec preserves unsigned states, negative coordinates and exact array layouts', () => {
    const source = sample();
    const bytes = encodeVanillaChunk(source);
    assert.deepEqual(decodeVanillaChunk(bytes), source);
    const unaligned = new Uint8Array(bytes.length + 3);
    unaligned.set(bytes, 3);
    assert.deepEqual(decodeVanillaChunk(unaligned.subarray(3)), source);
    const end = new VanillaChunk(0, 0, 0, 128).serialize();
    assert.deepEqual(decodeVanillaChunk(encodeVanillaChunk(end)), end);
    assert.equal(decodeVanillaChunk(encodeVanillaChunk(end)).fluidUpdates, undefined);
});

test('codec rejects corrupt, truncated, trailing and oversized headers before trusting data', () => {
    const bytes = encodeVanillaChunk(sample());
    const corrupt = bytes.slice();
    corrupt[200] ^= 1;
    assert.throws(() => decodeVanillaChunk(corrupt), /checksum/);
    assert.throws(() => decodeVanillaChunk(bytes.subarray(0, 20)), /length/);
    assert.throws(() => decodeVanillaChunk(bytes.subarray(0, bytes.length - 1)), /Truncated/);
    assert.throws(() => decodeVanillaChunk(new Uint8Array([...bytes, 0])), /trailing/);
    const invalidHeader = bytes.slice();
    new DataView(invalidHeader.buffer).setUint32(20, 0xffffffff, true);
    assert.throws(() => decodeVanillaChunk(invalidHeader), /header/);
});

test('real filesystem repository persists and reopens without touching legacy world files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'breakmine-native-chunks-'));
    try {
        const fs = new IsomorphicFilesystem();
        const repository = new VanillaChunkRepository(fs, root);
        const source = sample();
        assert.deepEqual(await repository.save('test_world', '9007199254740993', 'overworld', [source]), { saved: 1 });
        const reopened = new VanillaChunkRepository(new IsomorphicFilesystem(), root);
        assert.deepEqual(await reopened.load('test_world', '9007199254740993', 'overworld', -1, 65536), source);
        assert.equal(await reopened.load('test_world', '9007199254740992', 'overworld', -1, 65536), null);
        assert.equal(await reopened.load('test_world', '9007199254740993', 'nether', -1, 65536), null);
        assert.equal(fs.existsSync(`${root}/test_world/world_data.bin`), false);
        const file = `${repository.location('test_world', '9007199254740993', 'overworld')}/-1_65536.bmvc`;
        const corrupted = encodeVanillaChunk(source);
        corrupted[60] ^= 1;
        await fs.writeFileDurable(file, corrupted);
        await assert.rejects(reopened.load('test_world', '9007199254740993', 'overworld', -1, 65536), /checksum/);
        await assert.rejects(repository.save('../escape', '1', 'overworld', [source]), /key/);
        await assert.rejects(repository.save('test_world', '1', 'nether', [source]), /range/);
    } finally { await rm(root, { recursive: true, force: true }); }
});

test('repository rejects malformed batches before writes and surfaces persistence failures', async () => {
    let writes = 0;
    const repository = new VanillaChunkRepository({ mkdirSync() {}, writeFileDurable: async () => { writes++; throw new Error('disk full'); } }, '/test');
    await assert.rejects(repository.save('world', '1', 'overworld', [sample(), { ...sample(), blocks: new Uint16Array(0) }]), /Malformed/);
    assert.equal(writes, 0);
    await assert.rejects(repository.save('world', '1', 'overworld', [sample()]), /disk full/);
    assert.equal(writes, 1);
    await assert.rejects(repository.save('world', '1', 'overworld', [sample()]), /disk full/);
});

test('modern server packet travels through actual framing, client parser and handler', () => {
    const source = sample();
    let framed;
    assert.throws(() => sendVanillaChunk({ ws: { send() {} } }, source), /opted/);
    sendVanillaChunk({ vanillaChunkProtocol: 1, ws: { send: data => { framed = data; } } }, source);
    const buffer = new ByteBuf(new Uint8Array(framed));
    const frameLength = buffer.readVarInt();
    assert.equal(frameLength, buffer.length() - buffer.getPosition());
    assert.equal(buffer.readVarInt(), MODERN_CHUNK_PACKET_ID);
    const packet = new ServerVanillaChunkDataPacket();
    packet.read(buffer);
    const world = { vanillaChunkProtocol: 1, minY: -64, maxY: 320 };
    world.nativeChunks = new VanillaChunkStore();
    world.getChunkProvider = () => ({ loadVanillaChunk: chunk => world.nativeChunks.setBatch([chunk]) });
    const handler = Object.create(NetworkPlayHandler.prototype);
    handler.minecraft = { world };
    packet.handle(handler);
    assert.equal(world.nativeChunks.getBlockState(-1, -64, 65536 * 16 + 15), 0xffffffff);
    world.vanillaChunkProtocol = 0;
    assert.throws(() => packet.handle(handler), /not enabled/);
    assert.equal(new PacketRegistry().getServerBoundById(ProtocolState.PLAY, MODERN_CHUNK_PACKET_ID), ServerVanillaChunkDataPacket);
});

test('packet rejects declared payload lengths beyond the received frame', () => {
    const bytes = new ByteBuf();
    bytes.writeVarInt(9999);
    bytes.setPosition(0);
    assert.throws(() => new ServerVanillaChunkDataPacket().read(bytes), /length/);
});

test('browser binary persistence acknowledges transaction completion, not put success', async () => {
    const fs = Object.create(BrowserFilesystem.prototype);
    let transaction, record, acknowledged = false;
    fs._getDb = async () => ({ transaction: () => {
        transaction = { objectStore: () => ({ put: value => { record = value; return {}; } }) };
        return transaction;
    } });
    const saving = fs.saveBinaryFileDurable(new Uint8Array([0, 255, 128]), 'test.bmvc').then(() => { acknowledged = true; });
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(acknowledged, false);
    assert.equal(record.fileName, 'test.bmvc');
    transaction.oncomplete();
    await saving;
    assert.equal(acknowledged, true);
});

test('browser binary persistence propagates aborted transactions', async () => {
    const fs = Object.create(BrowserFilesystem.prototype);
    let transaction;
    fs._getDb = async () => ({ transaction: () => {
        transaction = { error: new Error('quota exceeded'), objectStore: () => ({ put() {} }) };
        return transaction;
    } });
    const rejected = assert.rejects(fs.saveBinaryFileDurable(new Uint8Array([1]), 'test.bmvc'), /quota exceeded/);
    await new Promise(resolve => setTimeout(resolve, 0));
    transaction.onabort();
    await rejected;
});
