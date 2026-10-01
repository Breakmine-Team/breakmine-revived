import { Buffer } from '../../../../../libraries/buffer.js';
import { writeLongBE } from './binary.js';
import { makePacket, writeVarInt, writeString, broadcast, varIntSize } from './protocol.js';
import { getPlayers, getPlayerCount } from './players.js';
import { generateFlatChunkColumn, getWorldType, getSpawnPosition } from './world.js';

function createDisconnectPacket(reason) {
    const message = JSON.stringify({ text: reason || 'Disconnected from server' });
    const data = Buffer.alloc(Buffer.byteLength(message) + 6);
    let offset = 0;
    offset += writeString(data, message, offset);
    return makePacket(0x00, data.subarray(0, offset));
}

function sendLoginSuccess(player) {
    const username = String(player.username || '');
    const mockUUID = "00000000-0000-0000-0000-000000000002";
    // varint(username len, max 5) + username + varint(uuid len) + uuid
    const data = Buffer.alloc(5 + Buffer.byteLength(username) + 5 + mockUUID.length);
    let offset = 0;

    offset += writeString(data, mockUUID, offset);
    offset += writeString(data, username, offset);

    player.ws.send(makePacket(0x02, data.subarray(0, offset)));
}

function sendJoinGame(player) {
    const data = Buffer.alloc(64);
    let offset = 0;

    data.writeInt32BE(player.eid, offset); offset += 4;
    data.writeUInt8(player.gamemode ?? 1, offset); offset += 1;           // Gamemode
    data.writeUInt8(0, offset); offset += 1;           // Dimension: Overworld
    data.writeUInt8(1, offset); offset += 1;           // Difficulty: Normal
    data.writeUInt8(60, offset); offset += 1;          // Max Players
    offset += writeString(data, getWorldType(), offset); // Level Type
    data.writeUInt8(0, offset); offset += 1;           // Reduced Debug Info

    player.ws.send(makePacket(0x01, data.subarray(0, offset)));
}

function sendRespawn(player, dimension) {
    const data = Buffer.alloc(64);
    let offset = 0;

    data.writeInt32BE(player.eid, offset); offset += 4;
    data.writeUInt8(player.gamemode ?? 1, offset); offset += 1;           // Gamemode
    data.writeUInt8(dimension, offset); offset += 1;   // Dimension
    data.writeUInt8(1, offset); offset += 1;           // Difficulty: Normal
    data.writeUInt8(60, offset); offset += 1;          // Max Players
    offset += writeString(data, getWorldType(), offset); // Level Type
    data.writeUInt8(0, offset); offset += 1;           // Reduced Debug Info

    player.ws.send(makePacket(0x07, data.subarray(0, offset)));
}

function sendSpawnPosition(player) {
    const data = Buffer.alloc(12);
    const spawn = getSpawnPosition();
    data.writeInt32BE(spawn.x, 0);       // Spawn X
    data.writeInt32BE(spawn.y, 4);       // Spawn Y (on the surface, never in a cave)
    data.writeInt32BE(spawn.z, 8);       // Spawn Z
    player.ws.send(makePacket(0x05, data));
}

function sendChunks(player) {
    // Send a 5x5 chunk area around spawn to give client enough terrain
    for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
            sendSingleChunk(player, cx, cz);
        }
    }

    // Player Position and Look - THIS clears "Building terrain..."
    sendPlayerPositionLook(player);
}

function sendSingleChunk(player, chunkX, chunkZ) {
    const compressedData = generateFlatChunkColumn(chunkX, chunkZ);
    const bitmask = 0xFFFF; // Sections 0-15 present
    
    // Header: chunkX(4) + chunkZ(4) + groundUp(1) + bitmask(2) + sizeVarInt(max 5)
    const headerSize = 4 + 4 + 1 + 2 + 5;
    const packetData = Buffer.alloc(headerSize + compressedData.length);
    
    let offset = 0;
    packetData.writeInt32BE(chunkX, offset); offset += 4;
    packetData.writeInt32BE(chunkZ, offset); offset += 4;
    packetData.writeUInt8(1, offset); offset += 1;  // Ground-up continuous = true
    packetData.writeUInt16BE(bitmask, offset); offset += 2;
    offset += writeVarInt(packetData, compressedData.length, offset);
    compressedData.copy(packetData, offset);
    offset += compressedData.length;
    
    player.ws.send(makePacket(0x21, packetData.subarray(0, offset)));
}

function unloadChunk(player, chunkX, chunkZ) {
    // Send chunk data with bitmask 0 to unload the chunk
    const data = Buffer.alloc(11);
    let offset = 0;

    data.writeInt32BE(chunkX, offset); offset += 4;
    data.writeInt32BE(chunkZ, offset); offset += 4;
    data.writeUInt8(1, offset); offset += 1;  // Ground-up continuous = true
    data.writeUInt16BE(0, offset); offset += 2;  // Bitmask 0 = no sections = unload

    player.ws.send(makePacket(0x21, data));
}

function sendResetWorldPacket(player) {
    // Send packet 0x48 to tell client to clear all chunks
    const data = Buffer.alloc(0);
    player.ws.send(makePacket(0x48, data));
}

function sendTimeUpdate(player, worldTime) {
    // Send packet 0x03 with world time (long, 8 bytes)
    const data = Buffer.alloc(8);
    writeLongBE(worldTime, data, 0);
    player.ws.send(makePacket(0x03, data));
}

function sendPlayerPositionLook(player) {
    const data = Buffer.alloc(50);
    let offset = 0;
    
    data.writeDoubleBE(player.x, offset); offset += 8;
    data.writeDoubleBE(player.y, offset); offset += 8;
    data.writeDoubleBE(player.z, offset); offset += 8;
    data.writeFloatBE(player.yaw, offset); offset += 4;
    data.writeFloatBE(player.pitch, offset); offset += 4;
    data.writeUInt8(0x00, offset); offset += 1;  // Flags: absolute
    offset += writeVarInt(data, 1, offset);      // Teleport ID
    
    player.ws.send(makePacket(0x08, data.subarray(0, offset)));
}

function sendBlockChange(ws, x, y, z, blockState) {
    const data = Buffer.alloc(16);
    let offset = 0;

    // Protocol 47: Pack position as 64-bit long
    // Bit layout: X (26 bits), Y (12 bits), Z (26 bits)
    // Handle 2's complement for negative coordinates
    let xPacked = BigInt(x) & ((1n << 26n) - 1n);
    let yPacked = BigInt(y) & ((1n << 12n) - 1n);
    let zPacked = BigInt(z) & ((1n << 26n) - 1n);

    // Pack into 64-bit unsigned
    let packedPos = (xPacked << 38n) | (yPacked << 26n) | zPacked;

    // Write as unsigned 64-bit
    writeLongBE(packedPos, data, offset); offset += 8;
    offset += writeVarInt(data, blockState, offset);

    ws.send(makePacket(0x23, data.subarray(0, offset)));
}

function sendSignTextUpdate(ws, x, y, z, text) {
    const str = String(text || '');
    const data = Buffer.alloc(8 + 5 + Buffer.byteLength(str));
    let offset = 0;

    // Protocol 47: Pack position as 64-bit long
    let xPacked = BigInt(x) & ((1n << 26n) - 1n);
    let yPacked = BigInt(y) & ((1n << 12n) - 1n);
    let zPacked = BigInt(z) & ((1n << 26n) - 1n);
    let packedPos = (xPacked << 38n) | (yPacked << 26n) | zPacked;

    writeLongBE(packedPos, data, offset); offset += 8;
    offset += writeString(data, text, offset);

    ws.send(makePacket(0x49, data.subarray(0, offset)));
}

function sendChatMessage(text) {
    const chatJson = JSON.stringify({ text });
    const chatData = Buffer.alloc(Buffer.byteLength(chatJson) + 6);
    let offset = 0;
    offset += writeString(chatData, chatJson, offset);
    chatData.writeUInt8(0, offset); offset += 1;
    
    broadcast(makePacket(0x02, chatData.subarray(0, offset)), getPlayers());
}

function createSpawnPlayerPacket(target) {
    const username = String(target.username || '');
    // varint(eid, max 5) + uuid(16) + position/rotation(16) + metadata(1)
    // + username string (varint max 5 + bytes) + metadata terminator(1)
    const data = Buffer.alloc(5 + 16 + 16 + 1 + 5 + Buffer.byteLength(username) + 1);
    let offset = 0;
    offset += writeVarInt(data, target.eid, offset);

    const uuid = Buffer.alloc(16);
    uuid.writeUInt32BE(target.eid, 12);
    uuid.copy(data, offset);
    offset += 16;

    data.writeInt32BE(packFixedPoint(target.x), offset);
    data.writeInt32BE(packFixedPoint(target.y), offset + 4);
    data.writeInt32BE(packFixedPoint(target.z), offset + 8);
    const yaw = ((target.yaw % 360) + 360) % 360;
    const pitch = ((target.pitch % 360) + 360) % 360;
    data.writeUInt8(Math.floor(yaw * 256 / 360), offset + 12);
    data.writeUInt8(Math.floor(pitch * 256 / 360), offset + 13);
    data.writeUInt16BE(0, offset + 14);
    offset += 16; // Move past the position/rotation data

    // Add metadata with username (index 2, type 4 = string)
    data.writeUInt8((4 << 5) | 2, offset); // Type 4 (string) | Index 2
    offset += 1;
    offset += writeString(data, username, offset);
    data.writeUInt8(127, offset); // Metadata terminator
    offset += 1;

    return makePacket(0x0C, data.subarray(0, offset));
}

function createEntityTeleportPacket(target) {
    const data = Buffer.alloc(5 + 15); // varint(eid, max 5) + 12 bytes pos + 3 bytes yaw/pitch/onGround
    // Capture the exact number of bytes written by writeVarInt
    let offset = writeVarInt(data, target.eid, 0); 
    
    data.writeInt32BE(packFixedPoint(target.x), offset);
    data.writeInt32BE(packFixedPoint(target.y), offset + 4);
    data.writeInt32BE(packFixedPoint(target.z), offset + 8);
    
    const yaw = ((target.yaw % 360) + 360) % 360;
    const pitch = ((target.pitch % 360) + 360) % 360;
    
    data.writeUInt8(Math.floor(yaw * 256 / 360), offset + 12);
    data.writeUInt8(Math.floor(pitch * 256 / 360), offset + 13);
    data.writeUInt8(target.onGround ? 1 : 0, offset + 14);
    
    return makePacket(0x18, data.subarray(0, offset + 15));
}

function createDestroyEntityPacket(eid) {
    const data = Buffer.alloc(16);
    let offset = 0;
    offset += writeVarInt(data, 1, offset);
    offset += writeVarInt(data, eid, offset);
    return makePacket(0x13, data.subarray(0, offset));
}

function createEntityMetadataPacket(player) {
    const data = Buffer.alloc(10);
    let offset = 0;
    offset += writeVarInt(data, player.eid, offset);

    // Entity metadata: packed byte (type << 5 | index) + value
    // Index 0: Entity Flags (byte)
    // Type 0: Byte
    // Packed byte: (0 << 5) | 0 = 0x00
    // Value: 0x02 for sneaking, 0x00 for not sneaking
    data.writeUInt8(0x00, offset); offset += 1;  // Packed: type=0, index=0
    data.writeUInt8(player.isSneaking ? 0x02 : 0x00, offset); offset += 1;  // Value

    // End of metadata (0x7F)
    data.writeUInt8(0x7F, offset); offset += 1;

    return makePacket(0x1C, data.subarray(0, offset));
}

function createAnimationPacket(player) {
    const data = Buffer.alloc(6);
    let offset = 0;
    offset += writeVarInt(data, player.eid, offset);
    data.writeUInt8(0, offset); offset += 1;  // Animation type: 0 = swing arm

    return makePacket(0x0B, data.subarray(0, offset));
}

function packFixedPoint(value) {
    if (!isFinite(value)) return 0;
    const scaled = Math.floor(value * 32);
    if (scaled > 2147483647) return 2147483647;
    if (scaled < -2147483648) return -2147483648;
    return scaled;
}

function createSpawnObjectPacket(entity) {
    const data = Buffer.alloc(64);
    let offset = 0;

    offset += writeVarInt(data, entity.id, offset);
    data.writeUInt8(entity.type, offset); offset += 1;  // Object type (1 = Item)
    data.writeInt32BE(packFixedPoint(entity.x), offset); offset += 4;
    data.writeInt32BE(packFixedPoint(entity.y), offset); offset += 4;
    data.writeInt32BE(packFixedPoint(entity.z), offset); offset += 4;
    data.writeUInt8(0, offset); offset += 1;  // Pitch
    data.writeUInt8(0, offset); offset += 1;  // Yaw
    data.writeInt32BE(entity.blockId, offset); offset += 4;  // Object data (blockId for items)
    data.writeUInt8(entity.hasPickupDelay ? 1 : 0, offset); offset += 1;  // Pickup delay (Q-drop)
    data.writeUInt16BE(0, offset); offset += 2;  // Velocity X
    data.writeUInt16BE(0, offset); offset += 2;  // Velocity Y
    data.writeUInt16BE(0, offset); offset += 2;  // Velocity Z

    return makePacket(0x0E, data.subarray(0, offset));
}

function sendPlayerListEntry(players, action = 0) {
    // Size the buffer from the actual data instead of a fixed cap so long
    // usernames / many players can never overrun it.
    let dataSize = varIntSize(action) + varIntSize(players.length);
    for (const player of players) {
        dataSize += 16; // UUID
        switch (action) {
            case 0: // ADD_PLAYER
                dataSize += varIntSize(Buffer.byteLength(player.username || '')) + Buffer.byteLength(player.username || '');
                dataSize += varIntSize(0) + varIntSize(player.gamemode ?? 1) + varIntSize(0) + 1;
                break;
            case 1: // UPDATE_GAMEMODE
                dataSize += varIntSize(player.gamemode ?? 1);
                break;
            case 2: // UPDATE_LATENCY
                dataSize += varIntSize(0);
                break;
            case 3: // UPDATE_DISPLAY_NAME
                dataSize += 1;
                break;
            case 4: // REMOVE_PLAYER
                break;
        }
    }

    const data = Buffer.alloc(dataSize);
    let offset = 0;

    offset += writeVarInt(data, action, offset);  // Action
    offset += writeVarInt(data, players.length, offset);  // Amount

    for (const player of players) {
        // UUID (16 bytes) - use EID as mock UUID
        const uuid = Buffer.alloc(16);
        uuid.writeUInt32BE(player.eid, 12);
        uuid.copy(data, offset);
        offset += 16;

        switch (action) {
            case 0: // ADD_PLAYER
                offset += writeString(data, player.username, offset);
                offset += writeVarInt(data, 0, offset);  // Properties count
                offset += writeVarInt(data, player.gamemode ?? 1, offset);  // Game mode
                offset += writeVarInt(data, 0, offset);  // Ping
                data.writeUInt8(0, offset); offset += 1;  // Has display name
                break;
            case 1: // UPDATE_GAMEMODE
                offset += writeVarInt(data, player.gamemode ?? 1, offset);
                break;
            case 2: // UPDATE_LATENCY
                offset += writeVarInt(data, 0, offset);  // Ping
                break;
            case 3: // UPDATE_DISPLAY_NAME
                data.writeUInt8(0, offset); offset += 1;  // Has display name
                break;
            case 4: // REMOVE_PLAYER
                // Just UUID, no additional data
                break;
        }
    }

    return makePacket(0x38, data.subarray(0, offset));
}

function sendPlayerListData(header = null, footer = null) {
    const data = Buffer.alloc(512);
    let offset = 0;

    // Send empty JSON objects instead of empty strings to avoid JSON parse errors
    offset += writeString(data, header || '{"text":""}', offset);
    offset += writeString(data, footer || '{"text":""}', offset);

    return makePacket(0x47, data.subarray(0, offset));
}

export {
    createDisconnectPacket,
    sendLoginSuccess,
    sendJoinGame,
    sendRespawn,
    sendSpawnPosition,
    sendChunks,
    sendSingleChunk,
    unloadChunk,
    sendResetWorldPacket,
    sendTimeUpdate,
    sendPlayerPositionLook,
    sendBlockChange,
    sendSignTextUpdate,
    sendChatMessage,
    createSpawnPlayerPacket,
    createEntityTeleportPacket,
    createDestroyEntityPacket,
    createEntityMetadataPacket,
    createAnimationPacket,
    createSpawnObjectPacket,
    sendPlayerListEntry,
    sendPlayerListData
};