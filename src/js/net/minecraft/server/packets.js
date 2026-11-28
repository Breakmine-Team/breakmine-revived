import { Buffer } from '../../../../../libraries/buffer.js';
import { writeLongBE } from './binary.js';
import { makePacket, writeVarInt, writeString, broadcast, varIntSize } from './protocol.js';
import { getPlayers, getPlayerCount } from './players.js';
import { generateFlatChunkColumn, getWorldType, getSpawnPosition, getDimensionType } from './world.js';
import { getWorldSeedText, getFlatBlockId } from './WorldGen.js';
import config from './config.js';
import { readServerMods } from './serverMods.js';
import {
    OFF_GRID_PROTOCOL_VERSION,
    OFF_GRID_STATE_PACKET_ID,
    OFF_GRID_UPDATE_ADD_GHOST,
    OFF_GRID_UPDATE_CLEAR_FIELD,
    OFF_GRID_UPDATE_CLEAR_GHOSTS,
    OFF_GRID_UPDATE_PACKET_ID,
    OFF_GRID_UPDATE_POSE,
    OFF_GRID_UPDATE_SET_CELL
} from '../util/OffGridConstants.js';

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
    data.writeUInt8(player.gamemode ?? 1, offset); offset += 1;           
    data.writeUInt8(player.dimension ?? 0, offset); offset += 1;           
    data.writeUInt8(1, offset); offset += 1;           
    data.writeUInt8(60, offset); offset += 1;          
    offset += writeString(data, getDimensionType(player.dimension ?? 0), offset); 
    data.writeUInt8(0, offset); offset += 1;           

    player.ws.send(makePacket(0x01, data.subarray(0, offset)));
}




function sendServerRules(player) {
    if (!player?.ws || player.ws.readyState !== 1) {
        return;
    }
    player.ws.send(JSON.stringify({
        type: 'serverRules',
        allowTNT: config.allowTNT !== false,
        allowLiquidFlow: config.allowLiquidFlow !== false
    }));
}




function sendServerMods(player) {
    if (!player?.ws || player.ws.readyState !== 1) {
        return;
    }

    let mods = [];
    try {
        mods = readServerMods();
    } catch (err) {
        console.warn('[Server] Could not read server mods:', err.message);
    }

    player.ws.send(JSON.stringify({ type: 'serverMods', mods }));
}

function sendRespawn(player, dimension) {
    const data = Buffer.alloc(64);
    let offset = 0;

    data.writeInt32BE(player.eid, offset); offset += 4;
    data.writeUInt8(player.gamemode ?? 1, offset); offset += 1;           
    data.writeUInt8(dimension, offset); offset += 1;   
    data.writeUInt8(1, offset); offset += 1;           
    data.writeUInt8(60, offset); offset += 1;          
    offset += writeString(data, getDimensionType(dimension), offset); 
    data.writeUInt8(0, offset); offset += 1;           

    player.ws.send(makePacket(0x07, data.subarray(0, offset)));
}

function sendSpawnPosition(player) {
    const data = Buffer.alloc(12);
    const spawn = getSpawnPosition(player.dimension ?? 0);
    data.writeInt32BE(spawn.x, 0);       
    data.writeInt32BE(spawn.y, 4);       
    data.writeInt32BE(spawn.z, 8);       
    player.ws.send(makePacket(0x05, data));
}

// Client-side world generation
// ---------------------------
// Flat and normal worlds are reproducible from their type and seed, so a
// joining client can build the terrain itself instead of receiving every
// chunk. The server still generates the few columns it needs for physics, and
// still sends chunks that hold block changes (see checkAndSendChunks).
const CLIENT_TERRAIN_VIEW_DISTANCE = 4;

let flatTerrainLayers = null;

function buildFlatTerrainLayers() {
    if (flatTerrainLayers !== null) {
        return flatTerrainLayers;
    }

    const layers = [];
    let start = 0;
    let current = getFlatBlockId(0);

    for (let y = 1; y <= 255; y++) {
        const id = getFlatBlockId(y);
        if (id === current) continue;

        if (current !== 0) {
            layers.push({ from: start, to: y - 1, block: current });
        }
        current = id;
        start = y;
    }

    if (current !== 0) {
        layers.push({ from: start, to: 255, block: current });
    }

    flatTerrainLayers = layers;
    return layers;
}

function getClientTerrain(player) {
    if (config.clientWorldGen === false || player?.clientWorldGen !== true) {
        return null;
    }

    const dimension = player?.dimension ?? 0;
    if (dimension !== 0) {
        return null;
    }

    const worldType = getDimensionType(0);
    if (worldType !== 'flat' && worldType !== 'normal') {
        return null;
    }

    const descriptor = {
        type: 'terrain',
        generator: worldType,
        viewDistance: CLIENT_TERRAIN_VIEW_DISTANCE
    };

    if (worldType === 'flat') {
        descriptor.layers = buildFlatTerrainLayers();
    } else {
        descriptor.seed = getWorldSeedText();
    }

    return descriptor;
}

// Sends the descriptor when the player first joins (or when it changes) and
// returns it when this player generates the world locally.
function announceClientTerrain(player) {
    const descriptor = getClientTerrain(player);
    if (descriptor === null) {
        player.clientTerrainKey = null;
        return null;
    }

    const key = `${descriptor.generator}:${descriptor.seed ?? ''}:${descriptor.viewDistance}`;
    if (player.clientTerrainKey !== key && player.ws && player.ws.readyState === 1) {
        player.clientTerrainKey = key;
        player.ws.send(JSON.stringify(descriptor));
    }

    return descriptor;
}

function sendChunks(player) {
    const dimension = player.dimension ?? 0;
    if (announceClientTerrain(player) !== null) {
        sendPlayerPositionLook(player);
        return;
    }

    for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
            sendSingleChunk(player, cx, cz, dimension);
        }
    }

    sendPlayerPositionLook(player);
}

function sendSingleChunk(player, chunkX, chunkZ, dimension = player.dimension ?? 0) {
    const compressedData = generateFlatChunkColumn(chunkX, chunkZ, dimension);
    const bitmask = 0xFFFF; 
    
    const headerSize = 4 + 4 + 1 + 2 + 5;
    const packetData = Buffer.alloc(headerSize + compressedData.length);
    
    let offset = 0;
    packetData.writeInt32BE(chunkX, offset); offset += 4;
    packetData.writeInt32BE(chunkZ, offset); offset += 4;
    packetData.writeUInt8(1, offset); offset += 1;  
    packetData.writeUInt16BE(bitmask, offset); offset += 2;
    offset += writeVarInt(packetData, compressedData.length, offset);
    compressedData.copy(packetData, offset);
    offset += compressedData.length;
    
    player.ws.send(makePacket(0x21, packetData.subarray(0, offset)));
}

function unloadChunk(player, chunkX, chunkZ) {
    const data = Buffer.alloc(11);
    let offset = 0;

    data.writeInt32BE(chunkX, offset); offset += 4;
    data.writeInt32BE(chunkZ, offset); offset += 4;
    data.writeUInt8(1, offset); offset += 1;  
    data.writeUInt16BE(0, offset); offset += 2;  

    player.ws.send(makePacket(0x21, data));
}

function sendResetWorldPacket(player) {
    const data = Buffer.alloc(0);
    player.ws.send(makePacket(0x48, data));
}

function sendTimeUpdate(player, worldTime) {
    const data = Buffer.alloc(8);
    writeLongBE(worldTime, data, 0);
    player.ws.send(makePacket(0x03, data));
}

function sendWeatherUpdate(player, weatherState) {
    const data = Buffer.alloc(1);
    data.writeUInt8(weatherState & 0xFF, 0);
    player.ws.send(makePacket(0x4A, data));
}

function sendPlayerPositionLook(player) {
    const data = Buffer.alloc(50);
    let offset = 0;
    
    data.writeDoubleBE(player.x, offset); offset += 8;
    data.writeDoubleBE(player.y, offset); offset += 8;
    data.writeDoubleBE(player.z, offset); offset += 8;
    data.writeFloatBE(player.yaw, offset); offset += 4;
    data.writeFloatBE(player.pitch, offset); offset += 4;
    data.writeUInt8(0x00, offset); offset += 1;  
    offset += writeVarInt(data, 1, offset);      
    
    player.ws.send(makePacket(0x08, data.subarray(0, offset)));
}

function sendBlockChange(ws, x, y, z, blockState) {
    const data = Buffer.alloc(16);
    let offset = 0;

    let xPacked = BigInt(x) & ((1n << 26n) - 1n);
    let yPacked = BigInt(y) & ((1n << 12n) - 1n);
    let zPacked = BigInt(z) & ((1n << 26n) - 1n);

    let packedPos = (xPacked << 38n) | (yPacked << 26n) | zPacked;

    writeLongBE(packedPos, data, offset); offset += 8;
    offset += writeVarInt(data, blockState, offset);

    ws.send(makePacket(0x23, data.subarray(0, offset)));
}

const BLOCK_EFFECT_PACKET_ID = 0x24;
const BLOCK_EFFECT_BREAK = 0;
const BLOCK_EFFECT_PLACE = 1;

// Another player's break/place, so nearby clients can replay its particles and
// block sound (the block change itself carries no effects).
function createBlockEffectPacket(x, y, z, blockId, action) {
    const data = Buffer.alloc(16);
    let offset = 0;

    let xPacked = BigInt(x) & ((1n << 26n) - 1n);
    let yPacked = BigInt(y) & ((1n << 12n) - 1n);
    let zPacked = BigInt(z) & ((1n << 26n) - 1n);

    let packedPos = (xPacked << 38n) | (yPacked << 26n) | zPacked;

    writeLongBE(packedPos, data, offset); offset += 8;
    offset += writeVarInt(data, blockId >>> 0, offset);
    data.writeUInt8(action & 0xFF, offset); offset += 1;

    return makePacket(BLOCK_EFFECT_PACKET_ID, data.subarray(0, offset));
}

function sendSignTextUpdate(ws, x, y, z, text) {
    const str = String(text || '');
    const data = Buffer.alloc(8 + 5 + Buffer.byteLength(str));
    let offset = 0;

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
    offset += 16; 

    data.writeUInt8((4 << 5) | 2, offset); 
    offset += 1;
    offset += writeString(data, username, offset);
    data.writeUInt8(127, offset); 
    offset += 1;

    return makePacket(0x0C, data.subarray(0, offset));
}

function createEntityTeleportPacket(target) {
    const data = Buffer.alloc(5 + 15); 
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

const ENTITY_EQUIPMENT_PACKET_ID = 0x04;

// The item a player holds is not entity metadata, so other clients get it in
// its own packet whenever the held stack or the selected hotbar slot changes.
function createEntityEquipmentPacket(player) {
    const data = Buffer.alloc(32);
    const inventory = player.inventory;
    const slot = Number(inventory?.selectedSlotIndex) || 0;
    const item = inventory?.items?.[slot];
    const typeId = item?.typeId || 0;

    let offset = 0;
    offset += writeVarInt(data, player.eid, offset);
    data.writeInt16BE(slot, offset); offset += 2;

    if (typeId > 0) {
        data.writeInt16BE(typeId, offset); offset += 2;
        data.writeUInt8(Math.max(1, Math.min(64, item.count || 1)), offset); offset += 1;
        data.writeInt16BE(0, offset); offset += 2;   // damage
    } else {
        data.writeInt16BE(-1, offset); offset += 2;
    }

    return makePacket(ENTITY_EQUIPMENT_PACKET_ID, data.subarray(0, offset));
}

function createEntityMetadataPacket(player) {
    const data = Buffer.alloc(10);
    let offset = 0;
    offset += writeVarInt(data, player.eid, offset);

    data.writeUInt8(0x00, offset); offset += 1;  
    data.writeUInt8(player.isSneaking ? 0x02 : 0x00, offset); offset += 1;  

    data.writeUInt8(0x7F, offset); offset += 1;

    return makePacket(0x1C, data.subarray(0, offset));
}

function createAnimationPacket(player) {
    const data = Buffer.alloc(6);
    let offset = 0;
    offset += writeVarInt(data, player.eid, offset);
    data.writeUInt8(0, offset); offset += 1;  

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
    data.writeUInt8(entity.type, offset); offset += 1;  
    data.writeInt32BE(packFixedPoint(entity.x), offset); offset += 4;
    data.writeInt32BE(packFixedPoint(entity.y), offset); offset += 4;
    data.writeInt32BE(packFixedPoint(entity.z), offset); offset += 4;
    data.writeUInt8(0, offset); offset += 1;  
    data.writeUInt8(0, offset); offset += 1;  
    data.writeInt32BE(entity.blockId, offset); offset += 4;  
    data.writeUInt8(entity.hasPickupDelay ? 1 : 0, offset); offset += 1;  
    data.writeUInt16BE(0, offset); offset += 2;  
    data.writeUInt16BE(0, offset); offset += 2;  
    data.writeUInt16BE(0, offset); offset += 2;  

    return makePacket(0x0E, data.subarray(0, offset));
}

function sendPlayerListEntry(players, action = 0) {
    const getPing = (player) => Math.max(0, Math.round(Number(player.ping) || 0));

    let dataSize = varIntSize(action) + varIntSize(players.length);
    for (const player of players) {
        dataSize += 16; 
        switch (action) {
            case 0: 
                dataSize += varIntSize(Buffer.byteLength(player.username || '')) + Buffer.byteLength(player.username || '');
                dataSize += varIntSize(0) + varIntSize(player.gamemode ?? 1) + varIntSize(getPing(player)) + 1;
                break;
            case 1: 
                dataSize += varIntSize(player.gamemode ?? 1);
                break;
            case 2: 
                dataSize += varIntSize(getPing(player));
                break;
            case 3: 
                dataSize += 1;
                break;
            case 4: 
                break;
        }
    }

    const data = Buffer.alloc(dataSize);
    let offset = 0;

    offset += writeVarInt(data, action, offset);  
    offset += writeVarInt(data, players.length, offset);  

    for (const player of players) {
        const uuid = Buffer.alloc(16);
        uuid.writeUInt32BE(player.eid, 12);
        uuid.copy(data, offset);
        offset += 16;

        switch (action) {
            case 0: 
                offset += writeString(data, player.username, offset);
                offset += writeVarInt(data, 0, offset);  
                offset += writeVarInt(data, player.gamemode ?? 1, offset);  
                offset += writeVarInt(data, getPing(player), offset);  
                data.writeUInt8(0, offset); offset += 1;  
                break;
            case 1: 
                offset += writeVarInt(data, player.gamemode ?? 1, offset);
                break;
            case 2: 
                offset += writeVarInt(data, getPing(player), offset);  
                break;
            case 3: 
                data.writeUInt8(0, offset); offset += 1;  
                break;
            case 4: 
                break;
        }
    }

    return makePacket(0x38, data.subarray(0, offset));
}




class PacketDataWriter {
    constructor() {
        this.parts = [];
        this.size = 0;
    }

    write(part) {
        this.parts.push(part);
        this.size += part.length;
    }

    byte(value) {
        const part = Buffer.alloc(1);
        part.writeUInt8(value & 0xFF, 0);
        this.write(part);
    }

    bool(value) {
        this.byte(value ? 1 : 0);
    }

    int(value) {
        const part = Buffer.alloc(4);
        part.writeInt32BE(Number.isFinite(value) ? (value | 0) : 0, 0);
        this.write(part);
    }

    float(value) {
        const part = Buffer.alloc(4);
        part.writeFloatBE(Number.isFinite(value) ? value : 0, 0);
        this.write(part);
    }

    varInt(value) {
        const part = Buffer.alloc(5);
        const unsigned = Number.isFinite(value) ? (Math.trunc(value) >>> 0) : 0;
        const length = writeVarInt(part, unsigned, 0);
        this.write(part.subarray(0, length));
    }

    toBuffer() {
        return Buffer.concat(this.parts, this.size);
    }
}

function createOffGridStatePacket(state) {
    const writer = new PacketDataWriter();
    const cells = Array.isArray(state.cells) ? state.cells : [];
    const ghosts = Array.isArray(state.ghosts) ? state.ghosts : [];
    const rotation = state.rotation || { x: 0, y: 0, z: 0 };
    const offset = state.offset || { x: 0, y: 0, z: 0 };
    const pivot = state.pivot || null;

    writer.varInt(OFF_GRID_PROTOCOL_VERSION);
    writer.varInt(cells.length);
    for (const cell of cells) {
        writer.int(cell.x);
        writer.varInt(cell.y);
        writer.int(cell.z);
        writer.varInt(cell.typeId);
        writer.byte(cell.data & 0xF);
    }

    writer.float(rotation.x);
    writer.float(rotation.y);
    writer.float(rotation.z);
    writer.float(offset.x);
    writer.float(offset.y);
    writer.float(offset.z);
    writer.bool(pivot !== null);
    if (pivot !== null) {
        writer.float(pivot.x);
        writer.float(pivot.y);
        writer.float(pivot.z);
    }

    writer.varInt(ghosts.length);
    for (const ghost of ghosts) {
        writer.float(ghost.x);
        writer.float(ghost.y);
        writer.float(ghost.z);
        writer.varInt(ghost.typeId);
        writer.byte(ghost.data & 0xF);
    }

    return makePacket(OFF_GRID_STATE_PACKET_ID, writer.toBuffer());
}

function createOffGridUpdatePacket(update) {
    const writer = new PacketDataWriter();
    const action = update.action;
    writer.byte(action);

    switch (action) {
        case OFF_GRID_UPDATE_SET_CELL:
            writer.int(update.x);
            writer.varInt(update.y);
            writer.int(update.z);
            writer.varInt(update.typeId);
            writer.byte(update.data & 0xF);
            break;

        case OFF_GRID_UPDATE_POSE: {
            const rotation = update.rotation || { x: 0, y: 0, z: 0 };
            const offset = update.offset || { x: 0, y: 0, z: 0 };
            const pivot = update.pivot || null;
            writer.float(rotation.x);
            writer.float(rotation.y);
            writer.float(rotation.z);
            writer.float(offset.x);
            writer.float(offset.y);
            writer.float(offset.z);
            writer.bool(pivot !== null);
            if (pivot !== null) {
                writer.float(pivot.x);
                writer.float(pivot.y);
                writer.float(pivot.z);
            }
            break;
        }

        case OFF_GRID_UPDATE_ADD_GHOST:
            writer.float(update.x);
            writer.float(update.y);
            writer.float(update.z);
            writer.varInt(update.typeId);
            writer.byte(update.data & 0xF);
            break;

        case OFF_GRID_UPDATE_CLEAR_FIELD:
        case OFF_GRID_UPDATE_CLEAR_GHOSTS:
        default:
            break;
    }

    return makePacket(OFF_GRID_UPDATE_PACKET_ID, writer.toBuffer());
}

function sendPlayerListData(header = null, footer = null) {
    const data = Buffer.alloc(512);
    let offset = 0;

    offset += writeString(data, header || '{"text":""}', offset);
    offset += writeString(data, footer || '{"text":""}', offset);

    return makePacket(0x47, data.subarray(0, offset));
}

export {
    createDisconnectPacket,
    sendLoginSuccess,
    sendJoinGame,
    sendServerRules,
    sendServerMods,
    sendRespawn,
    sendSpawnPosition,
    sendChunks,
    announceClientTerrain,
    sendSingleChunk,
    unloadChunk,
    sendResetWorldPacket,
    sendTimeUpdate,
    sendWeatherUpdate,
    sendPlayerPositionLook,
    sendBlockChange,
    createBlockEffectPacket,
    BLOCK_EFFECT_BREAK,
    BLOCK_EFFECT_PLACE,
    sendSignTextUpdate,
    sendChatMessage,
    createSpawnPlayerPacket,
    createEntityTeleportPacket,
    createDestroyEntityPacket,
    createEntityEquipmentPacket,
    createEntityMetadataPacket,
    createAnimationPacket,
    createSpawnObjectPacket,
    sendPlayerListEntry,
    sendPlayerListData,
    createOffGridStatePacket,
    createOffGridUpdatePacket
};