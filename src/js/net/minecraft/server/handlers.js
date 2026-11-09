import { Buffer } from '../../../../../libraries/buffer.js';
import { readLongBE } from './binary.js';
import { readVarInt, readString, broadcast, ensureReadable, MalformedPacketError } from './protocol.js';
import { addPlayer, removePlayer, getPlayers, updatePosition, loadPlayerData, findPlayerByUsername, normalizeInventoryState, savePlayerData, isSpectator } from './players.js';
import { addWorldChange, saveWorld, getBlockAt, getAllBlockInventoriesState, getSpawnPosition, deleteBlockInventory, getBlockInventories, getWorldTime, getBlockMetadata, setBlockInventory, setActiveDimension, getDimensionType, NETHER_DIMENSION } from './world.js';
import { addItemEntity, removeItemEntity, getItemEntity, getAllItemEntities } from './entities.js';
import { handleCommand } from './commands.js';
import {
    sendLoginSuccess,
    sendJoinGame,
    sendServerRules,
    sendServerMods,
    sendSpawnPosition,
    sendChunks,
    sendPlayerPositionLook,
    sendSingleChunk,
    sendTimeUpdate,
    sendChatMessage,
    createSpawnPlayerPacket,
    createEntityTeleportPacket,
    createDestroyEntityPacket,
    createSpawnObjectPacket,
    sendPlayerListEntry,
    sendPlayerListData,
    createDisconnectPacket,
    sendBlockChange,
    sendSignTextUpdate,
    createEntityMetadataPacket,
    createAnimationPacket
} from './packets.js';
import config from './config.js';
import Logger from './logger.js';
import { isBanned, describeBan } from './bans.js';
import getServerWorld from './World.js';
import { emitBlockAction } from './ServerModLoader.js';
import Block from '../client/world/block/Block.js';
import { NO_MODULES } from '../util/environment.js';
import {
    OFF_GRID_CELL_PACKET_ID,
    OFF_GRID_REQUEST_PACKET_ID
} from '../util/OffGridConstants.js';
import {
    applyCellEdit as applyOffGridCellEdit,
    broadcastCellEdit as broadcastOffGridCellEdit,
    sendState as sendOffGridState
} from './offgrid.js';





let filter = null;
if (!NO_MODULES) {
    import('bad-words')
        .then((mod) => {
            const FilterClass = (mod.default && mod.default.Filter) || mod.default || mod.Filter;
            filter = new FilterClass();
        })
        .catch(() => {});
}

function sanitizeText(text) {
    return filter ? filter.clean(text) : text;
}



const FLUID_IDS = new Set([8, 9, 10, 11]);
function isSolidBlock(blockId) {
    return blockId !== 0 && !FLUID_IDS.has(blockId);
}

let log = Logger;



function doSaveWorld() {
    try {
        saveWorld();
    } catch (e) {
        log.error('Server', 'Failed to save world: ' + (e && e.message));
    }
}











const SAVE_DEBOUNCE_MS = 2000;
let pendingSaveTimer = null;

function safeSaveWorld() {
    if (pendingSaveTimer !== null) return;
    pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        doSaveWorld();
    }, SAVE_DEBOUNCE_MS);
    if (typeof pendingSaveTimer.unref === 'function') pendingSaveTimer.unref();
}




function flushSaveWorld() {
    if (pendingSaveTimer === null) return false;
    clearTimeout(pendingSaveTimer);
    pendingSaveTimer = null;
    doSaveWorld();
    return true;
}

function canSee(viewer, target) {
    if (isSpectator(target)) {
        return isSpectator(viewer);
    }
    return true;
}


const playerChunks = new Map();


function readPosition(buffer, offset) {
    const val = readLongBE(buffer, offset);

    let x = val >> 38n;
    let y = (val >> 26n) & 0xFFFn;
    let z = val & 0x3FFFFFFn;

    const xBit = 1n << 25n;
    const yBit = 1n << 11n;
    const zBit = 1n << 25n;

    if (x >= xBit) x = x - (1n << 26n);
    if (y >= yBit) y = y - (1n << 12n);
    if (z >= zBit) z = z - (1n << 26n);

    return [Number(x), Number(y), Number(z)];
}

function handlePacket(player, buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return;
    }

    setActiveDimension(player.dimension ?? 0);

    try {
        let offset = 0;
        const [length, lenBytes] = readVarInt(buffer, offset);
        offset += lenBytes;

        if (length < 1 || length + lenBytes > buffer.length) {
            throw new MalformedPacketError('Packet length mismatch');
        }

        const [packetId, idBytes] = readVarInt(buffer, offset);
        offset += idBytes;

        if (player.protocolState === 'handshake') {
            handleHandshakePacket(player, packetId, buffer, offset);
            return;
        }

        if (player.protocolState === 'login') {
            handleLoginPacket(player, packetId, buffer, offset);
            return;
        }

        handlePlayPacket(player, packetId, buffer, offset);
    } catch (err) {
        const who = player.username || 'unknown';
        if (err instanceof MalformedPacketError) {
            log.warn('Server', `Rejected malformed packet from ${who}: ${err.message}`);
            try {
                if (player.ws && player.ws.readyState === 1) {
                    player.ws.close();
                }
            } catch (e) {
            }
        } else {
            log.error('Server', `Error handling packet from ${who}: ${err.message}`);
        }
    }
}

function handleHandshakePacket(player, packetId, buffer, offset) {
    let ver, verBytes, addr, addrBytes, port, state, stateBytes;
    [ver, verBytes] = readVarInt(buffer, offset);
    offset += verBytes;
    [addr, addrBytes] = readString(buffer, offset);
    offset += addrBytes;
    ensureReadable(buffer, offset, 2);
    port = buffer.readUInt16BE(offset);
    offset += 2;
    [state, stateBytes] = readVarInt(buffer, offset);
    offset += stateBytes;

    player.protocolState = state === 2 ? 'login' : 'status';

    if (state === 2 && buffer.length - offset > 0) {
        let count, countBytes;
        [count, countBytes] = readVarInt(buffer, offset);
        offset += countBytes;
        const mods = [];
        for (let i = 0; i < count; i++) {
            let modId, modName, modVersion, bytes;
            [modId, bytes] = readString(buffer, offset);
            offset += bytes;
            [modName, bytes] = readString(buffer, offset);
            offset += bytes;
            [modVersion, bytes] = readString(buffer, offset);
            offset += bytes;
            mods.push({ id: modId, name: modName, version: modVersion });
        }
        player.mods = mods;

        if (mods.length > 0) {
            log.info('Server', `${player.username || 'Unknown'} has mods: ${mods.map(m => `${m.name} v${m.version}`).join(', ')}`);
        }
    }
}

function handleLoginPacket(player, packetId, buffer, offset) {
    if (packetId === 0x00) {
        const [username, bytesConsumed] = readString(buffer, offset);

        if (!username || username.length > 32) {
            log.info('Server', `Rejected login with invalid username length`);
            if (player.ws.readyState === 1) {
                player.ws.send(createDisconnectPacket('§cInvalid username.'));
                player.ws.close();
            }
            return;
        }

        player.username = username;

        const ban = isBanned(username);
        if (ban) {
            log.info('Server', `${username} refused - banned${ban.reason ? ': ' + ban.reason : ''}`);
            if (player.ws.readyState === 1) {
                player.ws.send(createDisconnectPacket(describeBan(ban)));
                player.ws.close();
            }
            return;
        }

        if (!config.allowMods && player.mods && player.mods.length > 0) {
            const modNames = player.mods.map(m => m.name).join(', ');
            log.info('Server', `${username} kicked - mods not allowed (has: ${modNames})`);
            if (player.ws.readyState === 1) {
                player.ws.send(createDisconnectPacket(`§cThis server does not allow mods. Please disable your mods to join.`));
                player.ws.close();
            }
            return;
        }

        const existingPlayer = findPlayerByUsername(username);
        if (existingPlayer) {
            if (existingPlayer.ws && existingPlayer.ws.readyState === 1) {
                existingPlayer.ws.close();
            }
            if (existingPlayer.eid !== null) {
                removePlayer(existingPlayer);
                cleanupPlayerChunks(existingPlayer.eid);
                existingPlayer.eid = null;
            }
        }

        player.protocolState = 'play';

        let spawn = getSpawnPosition();

        const playerData = loadPlayerData(username);
        player.dimension = playerData && Number(playerData.dimension) === NETHER_DIMENSION
            ? NETHER_DIMENSION
            : 0;
        if (player.dimension === NETHER_DIMENSION) {
            spawn = getSpawnPosition(NETHER_DIMENSION);
        }
        if (playerData) {
            player.x = typeof playerData.x === 'number' ? playerData.x : spawn.x;
            player.y = typeof playerData.y === 'number' ? playerData.y : spawn.y;
            player.z = typeof playerData.z === 'number' ? playerData.z : spawn.z;
            player.yaw = typeof playerData.yaw === 'number' ? playerData.yaw : 0;
            player.pitch = typeof playerData.pitch === 'number' ? playerData.pitch : 0;
            player.isFlying = playerData.isFlying || false;
            player.gamemode = typeof playerData.gamemode === 'number' ? playerData.gamemode : player.gamemode;
            player.health = typeof playerData.health === 'number' && playerData.health > 0 ? playerData.health : 20;
            player.inventory = normalizeInventoryState(playerData.inventory);
            player.cape = typeof playerData.cape === 'string' ? playerData.cape : null;
            const savedCamera = playerData.cctvCamera;
            player.cctvCamera = savedCamera
                && Number.isFinite(savedCamera.x) && Number.isFinite(savedCamera.y) && Number.isFinite(savedCamera.z)
                ? { x: Math.floor(savedCamera.x), y: Math.floor(savedCamera.y), z: Math.floor(savedCamera.z) }
                : null;

            const px = Math.floor(player.x);
            const py = Math.floor(player.y);
            const pz = Math.floor(player.z);
            if (isSolidBlock(getBlockAt(px, py, pz, player.dimension)) && isSolidBlock(getBlockAt(px, py + 1, pz, player.dimension))) {
                player.x = spawn.x;
                player.y = spawn.y;
                player.z = spawn.z;
            }
        } else {
            player.x = spawn.x;
            player.y = spawn.y;
            player.z = spawn.z;
            player.yaw = 0;
            player.pitch = 0;
            player.isFlying = false;
            player.inventory = normalizeInventoryState([]);
            player.cape = null;
            player.cctvCamera = null;
        }

        addPlayer(player);
        log.info('Chat', `${player.username} joined the game.`);

        sendLoginSuccess(player);
        sendServerRules(player);
        sendJoinGame(player);
        sendServerMods(player);
        sendSpawnPosition(player);

        sendPlayerPositionLook(player);

        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: 'playerState',
                x: player.x,
                y: player.y,
                z: player.z,
                yaw: player.yaw,
                pitch: player.pitch,
                health: player.health,
                gamemode: player.gamemode,
                flying: !!player.isFlying
            }));
        }

        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: 'inventory',
                inventory: player.inventory
            }));
            player.ws.send(JSON.stringify({
                type: 'health',
                health: player.health
            }));
            player.ws.send(JSON.stringify({
                type: 'gamemode',
                gamemode: player.gamemode,
                flying: !!player.isFlying
            }));
        }

        const sentChunks = new Set();
        for (let cx = -2; cx <= 2; cx++) {
            for (let cz = -2; cz <= 2; cz++) {
                sentChunks.add(`${cx},${cz}`);
            }
        }
        playerChunks.set(player.eid, sentChunks);

        sendChunks(player);

        checkAndSendChunks(player);

        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: 'blockInventories',
                inventories: getAllBlockInventoriesState()
            }));

            player.ws.send(JSON.stringify({
                type: 'cctv:state',
                camera: player.cctvCamera || null
            }));

            const inventories = getBlockInventories();
            for (const [key, inv] of inventories) {
                if (inv && inv.text) {
                    const [x, y, z] = key.split(',').map(Number);
                    sendSignTextUpdate(player.ws, x, y, z, inv.text);
                }
            }
        }

        sendTimeUpdate(player, getWorldTime());

        const players = getPlayers();
        const visiblePlayers = Array.from(players.values()).filter(p => p.eid === player.eid || canSee(player, p));
        player.ws.send(sendPlayerListEntry(visiblePlayers, 0));
        player.ws.send(sendPlayerListData());

        for (const [eid, p] of players) {
            if (eid === player.eid) continue;
            if (canSee(player, p)) {
                player.ws.send(createSpawnPlayerPacket(p));
            }
            if (canSee(p, player)) {
                p.ws.send(createSpawnPlayerPacket(player));
            }
            if (canSee(p, player)) {
                p.ws.send(sendPlayerListEntry([player], 0));
            }
        }

        const allItems = getAllItemEntities();
        for (const item of allItems) {
            player.ws.send(createSpawnObjectPacket(item));
        }

        sendChatMessage(`§e${player.username} joined the game.`);
    } else {
        log.error('Server', `Unknown login packet ID: 0x${packetId.toString(16)}`);
    }
}

function handlePlayPacket(player, packetId, buffer, offset) {
    switch (packetId) {
        case 0x01: { 
            const [msg] = readString(buffer, offset);

            if (msg.startsWith('/')) {
                handleCommand(player, msg);
                log.info('Chat', `<${player.username}> executed command: ${msg}`);
            } else {
                log.info('Chat', `<${player.username}>: ${msg}`);
                let newname = player.username;
                if (player.username === "AlexMinecrafter") newname = '§d' + player.username + '§7';
                if (player.username === "developer") newname = '§4' + player.username + '§7';
                if (player.username === "kai") newname = '§b' + player.username + '§7';
                if (player.username === "LowQualityCoding") newname = '§a</>§f ' + player.username + '§7';
                if (player.username === "Marw-Programmer") newname = '§a' + player.username + '§7';
                if (player.username === "Hoofries") newname = '§1' + player.username + '§7';
                sendChatMessage(`§7<§f${newname}§7> §f${msg}`);
            }
            break;
        }

        case 0x04: { 
            ensureReadable(buffer, offset, 25);
            player.x = buffer.readDoubleBE(offset);
            player.y = buffer.readDoubleBE(offset + 8);
            player.z = buffer.readDoubleBE(offset + 16);
            player.onGround = buffer.readUInt8(offset + 24) === 1;
            broadcastMovement(player);
            checkAndSendChunks(player);
            checkPortalTravel(player);
            break;
        }

        case 0x05: { 
            ensureReadable(buffer, offset, 9);
            player.yaw = buffer.readFloatBE(offset);
            player.pitch = buffer.readFloatBE(offset + 4);
            player.onGround = buffer.readUInt8(offset + 8) === 1;
            broadcastMovement(player);
            break;
        }

        case 0x06: { 
            ensureReadable(buffer, offset, 33);
            player.x = buffer.readDoubleBE(offset);
            player.y = buffer.readDoubleBE(offset + 8);
            player.z = buffer.readDoubleBE(offset + 16);
            player.yaw = buffer.readFloatBE(offset + 24);
            player.pitch = buffer.readFloatBE(offset + 28);
            player.onGround = buffer.readUInt8(offset + 32) === 1;
            broadcastMovement(player);
            checkAndSendChunks(player);
            checkPortalTravel(player);
            break;
        }

        case 0x07: { 
            handlePlayerDigging(player, buffer, offset);
            break;
        }

        case 0x08: { 
            handleBlockPlacement(player, buffer, offset);
            break;
        }

        case 0x0A: { 
            broadcastAnimation(player);
            break;
        }

        case 0x0B: { 
            const [entityId, eidBytes] = readVarInt(buffer, offset);
            ensureReadable(buffer, offset + eidBytes, 1);
            const state = buffer.readUInt8(offset + eidBytes);
            const [jumpBoost, boostBytes] = readVarInt(buffer, offset + eidBytes + 1);

            if (entityId === player.eid) {
                if (state === 0) { 
                    player.isSneaking = true;
                    broadcastEntityMetadata(player);
                } else if (state === 1) { 
                    player.isSneaking = false;
                    broadcastEntityMetadata(player);
                }
            }
            break;
        }

        case 0x09: { 
            handleDropItem(player, buffer, offset);
            break;
        }

        case 0x0D: { 
            handlePickupItem(player, buffer, offset);
            break;
        }

        case 0x0E: { 
            handleUpdateSignText(player, buffer, offset);
            break;
        }

        case OFF_GRID_REQUEST_PACKET_ID: { 
            sendOffGridState(player);
            break;
        }

        case OFF_GRID_CELL_PACKET_ID: { 
            handleOffGridCellEdit(player, buffer, offset);
            break;
        }


    }
}

function handleOffGridCellEdit(player, buffer, offset) {
    if (isSpectator(player)) {
        return;
    }

    ensureReadable(buffer, offset, 4);
    const x = buffer.readInt32BE(offset);
    offset += 4;

    let y;
    let bytes;
    [y, bytes] = readVarInt(buffer, offset);
    offset += bytes;

    ensureReadable(buffer, offset, 4);
    const z = buffer.readInt32BE(offset);
    offset += 4;

    let typeId;
    [typeId, bytes] = readVarInt(buffer, offset);
    typeId = typeId >>> 0;
    offset += bytes;

    ensureReadable(buffer, offset, 1);
    const data = buffer.readUInt8(offset);

    const result = applyOffGridCellEdit(x, y, z, typeId, data);
    if (!result.valid) {
        sendOffGridState(player);
        return;
    }
    if (!result.changed) {
        return;
    }

    broadcastOffGridCellEdit(x, y, z, typeId === 0 ? 0 : typeId, typeId === 0 ? 0 : data);
}


function getHeldItemId(player) {
    const inventory = player.inventory;
    if (!inventory) return 0;
    const slot = Number(inventory.selectedSlotIndex) || 0;
    return inventory.items?.[slot]?.typeId || 0;
}

function revertBlockForPlayer(player, x, y, z) {
    const blockId = getBlockAt(x, y, z) || 0;
    const metadata = getBlockMetadata(x, y, z) || 0;
    sendBlockChange(player.ws, x, y, z, (blockId << 4) | metadata);
}

function isInteractiveBlock(block) {
    return !!block &&
        typeof block.onMouseButton === 'function' &&
        block.onMouseButton !== Block.prototype.onMouseButton;
}

function emitServerBlockAction(action, player, x, y, z, options = {}) {
    const world = getServerWorld();
    const targetBlockId = getBlockAt(x, y, z) || 0;
    const targetBlock = Block.getById(targetBlockId);
    const currentBlockId = options.currentBlockId ?? getHeldItemId(player);
    const currentBlock = Block.getById(currentBlockId);
    const clicked = options.clickedPos || { x, y, z };
    const clickedBlockId = getBlockAt(clicked.x, clicked.y, clicked.z) || 0;

    return emitBlockAction(action, {
        action,
        username: player.username,
        x, y, z,
        pos: { x, y, z },
        currentBlock,
        currentBlockId,
        targetBlock,
        targetBlockId,
        clickedBlock: Block.getById(clickedBlockId),
        clickedBlockId,
        clickedPos: { x: clicked.x, y: clicked.y, z: clicked.z },
        placePos: { x, y, z },
        face: options.face ?? null,
        metadata: options.metadata ?? (getBlockMetadata(x, y, z) || 0),
        world,
        minecraft: null
    });
}

function handlePlayerDigging(player, buffer, offset) {
    setActiveDimension(player.dimension ?? 0);
    ensureReadable(buffer, offset, 10);
    const status = buffer.readUInt8(offset); 
    const [x, y, z] = readPosition(buffer, offset + 1);
    const face = buffer.readUInt8(offset + 9);

    if (status === 2) {
        const blockId = 0; 
        const prevBlockId = getBlockAt(x, y, z);
        const serverWorld = getServerWorld();

        if (prevBlockId !== 0) {
            const breakAction = emitServerBlockAction('break', player, x, y, z, {
                face,
                metadata: getBlockMetadata(x, y, z) || 0
            });
            if (breakAction.canceled) {
                revertBlockForPlayer(player, x, y, z);
                return;
            }
        }

        addWorldChange(x, y, z, blockId);

        deleteBlockInventory(`${x},${y},${z}`);

        const prevBlock = Block.getById(prevBlockId);
        if (prevBlock && prevBlock.onBlockRemoved) {
            try {
                prevBlock.onBlockRemoved(serverWorld, x, y, z);
            } catch (e) {
                log.error('Server', `onBlockRemoved error at ${x},${y},${z}: ${e.message}`);
            }
        }

        serverWorld.scheduleNeighborTicks(x, y, z);
        serverWorld.notifyNeighborBlockChange(x, y, z);

        safeSaveWorld();

        const players = getPlayers();
        const blockState = (blockId << 4) | 0; 
        for (const p of players.values()) {
            sendBlockChange(p.ws, x, y, z, blockState);
        }

        broadcastAnimation(player);
    }
}

function handleUpdateSignText(player, buffer, offset) {
    ensureReadable(buffer, offset, 8);
    const [x, y, z] = readPosition(buffer, offset);
    const [rawText, textBytes] = readString(buffer, offset + 8);

    const text = sanitizeText(rawText).substring(0, 200);

    log.info('Server', `Sign text update: ${x},${y},${z} = "${text}"`);

    const blockKey = `${x},${y},${z}`;
    setBlockInventory(blockKey, { text: text });
    safeSaveWorld();

    const players = getPlayers();
    for (const p of players.values()) {
        if (p.ws.readyState === 1) {
            sendSignTextUpdate(p.ws, x, y, z, text);
        }
    }
}

function handleBlockPlacement(player, buffer, offset) {
    setActiveDimension(player.dimension ?? 0);
    ensureReadable(buffer, offset, 11);
    const [x, y, z] = readPosition(buffer, offset);
    const direction = buffer.readUInt8(offset + 8);

    const heldItemId = buffer.readInt16BE(offset + 9);

    let metadataOverride = -1;
    if (buffer.length > offset + 18) {
        const override = buffer.readUInt8(offset + 18);
        if (override !== 255) {
            metadataOverride = override & 0xF;
        }
    }

    if (direction === 255) {
        const serverWorld = getServerWorld();
        const heldBlock = heldItemId > 0 ? Block.getById(heldItemId) : null;

        const targetId = getBlockAt(x, y, z);

        if (heldItemId === 236) {
            const ignitionTarget = Block.getById(targetId);
            if (ignitionTarget && typeof ignitionTarget.ignite === 'function') {
                const interactAction = emitServerBlockAction('interact', player, x, y, z, {
                    currentBlockId: heldItemId,
                    face: direction
                });
                if (interactAction.canceled) {
                    revertBlockForPlayer(player, x, y, z);
                    return;
                }

                try {
                    ignitionTarget.onMouseButton(serverWorld, x, y, z, 2, heldItemId);
                } catch (e) {
                    log.error('Server', `onMouseButton error at ${x},${y},${z}: ${e.message}`);
                }
                return;
            }

            lightPortal(player, x, y, z);
            return;
        }

        if (heldBlock?.isPavementSlope === true && targetId === heldItemId) {
            const layerData = (getBlockMetadata(x, y, z) || 0) & 7;
            if (layerData < 7) {
                const placeAction = emitServerBlockAction('place', player, x, y, z, {
                    currentBlockId: heldItemId,
                    face: direction,
                    metadata: layerData
                });
                if (placeAction.canceled) {
                    revertBlockForPlayer(player, x, y, z);
                    return;
                }

                addWorldChange(x, y, z, targetId, layerData + 1);
                safeSaveWorld();
                const blockState = (targetId << 4) | (layerData + 1);
                for (const p of getPlayers().values()) {
                    sendBlockChange(p.ws, x, y, z, blockState);
                }
            }
            return;
        }

        if (heldBlock && typeof heldBlock.onUseOnBlockServer === 'function') {
            const interactAction = emitServerBlockAction('interact', player, x, y, z, {
                currentBlockId: heldItemId,
                face: direction
            });
            if (interactAction.canceled) {
                revertBlockForPlayer(player, x, y, z);
                return;
            }

            try {
                heldBlock.onUseOnBlockServer(serverWorld, x, y, z, player);
            } catch (e) {
                log.error('Server', `onUseOnBlockServer error at ${x},${y},${z}: ${e.message}`);
            }
            return;
        }

        const targetBlock = Block.getById(targetId);
        if (isInteractiveBlock(targetBlock)) {
            const interactAction = emitServerBlockAction('interact', player, x, y, z, {
                currentBlockId: heldItemId,
                face: direction
            });
            if (interactAction.canceled) {
                revertBlockForPlayer(player, x, y, z);
                return;
            }

            try {
                targetBlock.onMouseButton(serverWorld, x, y, z, 2, heldItemId);
            } catch (e) {
                log.error('Server', `onMouseButton error at ${x},${y},${z}: ${e.message}`);
            }
        }
        return;
    }

    if (direction !== 255) {
        const dx = [0, 0, 0, 0, -1, 1][direction];
        const dy = [-1, 1, 0, 0, 0, 0][direction];
        const dz = [0, 0, -1, 1, 0, 0][direction];

        const placeX = x + dx;
        const placeY = y + dy;
        const placeZ = z + dz;

        if (placeY < 0) {
            return;
        }

        const players = getPlayers();
        for (const p of players.values()) {
            const playerMinX = p.x - 0.3;
            const playerMaxX = p.x + 0.3;
            const playerMinY = p.y;
            const playerMaxY = p.y + 1.8;
            const playerMinZ = p.z - 0.3;
            const playerMaxZ = p.z + 0.3;

            if (placeX < playerMaxX && placeX + 1 > playerMinX &&
                placeY < playerMaxY && placeY + 1 > playerMinY &&
                placeZ < playerMaxZ && placeZ + 1 > playerMinZ) {
                const currentBlockId = getBlockAt(placeX, placeY, placeZ) || 0;
                const currentMetadata = getBlockMetadata(placeX, placeY, placeZ) || 0;
                const currentBlockState = (currentBlockId << 4) | currentMetadata;
                sendBlockChange(player.ws, placeX, placeY, placeZ, currentBlockState);
                return;
            }
        }

        const heldBlock = heldItemId > 0 ? Block.getById(heldItemId) : null;
        if (heldBlock === null || typeof heldBlock.isItem === 'function' && heldBlock.isItem()) {
            return;
        }
        const blockId = heldItemId;

        const serverWorld = getServerWorld();
        if (typeof heldBlock.canPlaceAt === 'function' &&
            !heldBlock.canPlaceAt(serverWorld, placeX, placeY, placeZ, direction)) {
            const currentBlockState = (getBlockAt(placeX, placeY, placeZ) << 4) |
                (getBlockMetadata(placeX, placeY, placeZ) & 0xF);
            sendBlockChange(player.ws, placeX, placeY, placeZ, currentBlockState);
            return;
        }

        const placeAction = emitServerBlockAction('place', player, placeX, placeY, placeZ, {
            currentBlockId: blockId,
            face: direction,
            clickedPos: { x, y, z },
            metadata: getBlockMetadata(placeX, placeY, placeZ) || 0
        });
        if (placeAction.canceled) {
            revertBlockForPlayer(player, placeX, placeY, placeZ);
            return;
        }

        const heldBlockForMeta = Block.getById(blockId);
        let metadata = 0;
        if (metadataOverride >= 0) {
            metadata = metadataOverride;
        } else if (heldBlockForMeta && typeof heldBlockForMeta.getPlacementMetadata === 'function') {
            metadata = heldBlockForMeta.getPlacementMetadata(
                serverWorld,
                placeX, placeY, placeZ,
                direction,
                player.yaw ?? player.rotationYaw ?? 0
            ) || 0;
        }

        addWorldChange(placeX, placeY, placeZ, blockId, metadata);

        const doorTop = blockId === 160 && getBlockAt(placeX, placeY + 1, placeZ) !== 161;
        if (doorTop) {
            addWorldChange(placeX, placeY + 1, placeZ, 161, metadata);
        }

        const placedBlock = Block.getById(blockId);
        if (placedBlock && typeof placedBlock.onBlockAdded === 'function') {
            try {
                placedBlock.onBlockAdded(serverWorld, placeX, placeY, placeZ);
            } catch (e) {
                log.error('Server', `onBlockAdded error at ${placeX},${placeY},${placeZ}: ${e.message}`);
            }
        }
        serverWorld.scheduleNeighborTicks(placeX, placeY, placeZ);
        serverWorld.notifyNeighborBlockChange(placeX, placeY, placeZ);

        safeSaveWorld();

        const blockStates = [[placeX, placeY, placeZ, (blockId << 4) | metadata]];
        if (doorTop) {
            blockStates.push([placeX, placeY + 1, placeZ, (161 << 4) | metadata]);
        }
        for (const [bx, by, bz, state] of blockStates) {
            for (const p of players.values()) {
                sendBlockChange(p.ws, bx, by, bz, state);
            }
        }

        broadcastAnimation(player);
    }
}

function broadcastMovement(player) {
    const packet = createEntityTeleportPacket(player);
    const players = getPlayers();
    for (const [eid, p] of players) {
        if (eid === player.eid) continue;
        if (!canSee(p, player)) continue;
        p.ws.send(packet);
    }
}

function broadcastEntityMetadata(player) {
    const packet = createEntityMetadataPacket(player);
    const players = getPlayers();
    for (const [eid, p] of players) {
        if (eid === player.eid) continue;
        if (!canSee(p, player)) continue;
        p.ws.send(packet);
    }
}

function broadcastAnimation(player) {
    const packet = createAnimationPacket(player);
    const players = getPlayers();
    for (const [eid, p] of players) {
        if (eid === player.eid) continue;
        if (!canSee(p, player)) continue;
        p.ws.send(packet);
    }
}

function handleDropItem(player, buffer, offset) {
    ensureReadable(buffer, offset, 15);
    const blockId = buffer.readInt16BE(offset);

    const spawnX = buffer.readInt32BE(offset + 2) + 0.5;
    const spawnY = buffer.readInt32BE(offset + 6) + 0.5;
    const spawnZ = buffer.readInt32BE(offset + 10) + 0.5;

    const hasPickupDelay = buffer.readUInt8(offset + 14) === 1;

    const motionX = (Math.random() - 0.5) * 0.15;
    const motionY = 0.2;
    const motionZ = (Math.random() - 0.5) * 0.15;

    const entity = addItemEntity(blockId, spawnX, spawnY, spawnZ, motionX, motionY, motionZ, player.eid, hasPickupDelay);

    const packet = createSpawnObjectPacket(entity);
    const players = getPlayers();
    for (const p of players.values()) {
        if (p.ws.readyState === 1) {
            p.ws.send(packet);
        }
    }
}

function handlePickupItem(player, buffer, offset) {
    const [entityId, eidBytes] = readVarInt(buffer, offset);

    const entity = getItemEntity(entityId);
    if (!entity) return;

    removeItemEntity(entityId);

    const destroyPacket = createDestroyEntityPacket(entityId);
    const players = getPlayers();
    for (const p of players.values()) {
        if (p.ws.readyState === 1) {
            p.ws.send(destroyPacket);
        }
    }
}

const PORTAL_ID = 356;
const PORTAL_COOLDOWN_MS = 3000;

function broadcastBlockToDimension(dimension, x, y, z, blockId, metadata) {
    for (const other of getPlayers().values()) {
        if ((other.dimension ?? 0) !== dimension || other.ws?.readyState !== 1) continue;
        sendBlockChange(other.ws, x, y, z, (blockId << 4) | (metadata & 0xF));
    }
}




function lightPortal(player, x, y, z) {
    const dimension = player.dimension ?? 0;
    const isFrame = (bx, by, bz) => getBlockAt(bx, by, bz, dimension) === 256;
    const isOpen = (bx, by, bz) => {
        const id = getBlockAt(bx, by, bz, dimension);
        return id === 0 || id === PORTAL_ID;
    };

    for (const [dx, dz] of [[1, 0], [0, 1]]) {
        for (let ox = -1; ox <= 2; ox++) {
            for (let oy = -1; oy <= 3; oy++) {
                const bx = x - ox * dx;
                const by = y - oy;
                const bz = z - ox * dz;

                let valid = true;
                for (let i = 0; i < 2 && valid; i++) {
                    for (let j = 0; j < 3; j++) {
                        if (!isOpen(bx + i * dx, by + j, bz + i * dz)) {
                            valid = false;
                            break;
                        }
                    }
                }
                if (!valid) continue;

                for (let i = -1; i <= 2 && valid; i++) {
                    if (!isFrame(bx + i * dx, by - 1, bz + i * dz)
                        || !isFrame(bx + i * dx, by + 3, bz + i * dz)) {
                        valid = false;
                    }
                }
                for (let j = 0; j < 3 && valid; j++) {
                    if (!isFrame(bx - dx, by + j, bz - dz)
                        || !isFrame(bx + 2 * dx, by + j, bz + 2 * dz)) {
                        valid = false;
                    }
                }
                if (!valid) continue;

                const portalData = dx === 0 ? 1 : 0;
                for (let i = 0; i < 2; i++) {
                    for (let j = 0; j < 3; j++) {
                        addWorldChange(bx + i * dx, by + j, bz + i * dz, PORTAL_ID, portalData, dimension);
                        broadcastBlockToDimension(dimension, bx + i * dx, by + j, bz + i * dz, PORTAL_ID, portalData);
                    }
                }
                return true;
            }
        }
    }

    return false;
}



function checkPortalTravel(player) {
    if (Date.now() < (player.portalCooldown || 0)) return;

    const dimension = player.dimension ?? 0;
    const px = Math.floor(player.x);
    const py = Math.floor(player.y);
    const pz = Math.floor(player.z);

    if (getBlockAt(px, py, pz, dimension) !== PORTAL_ID && getBlockAt(px, py + 1, pz, dimension) !== PORTAL_ID) {
        return;
    }

    travelToDimension(player, dimension === NETHER_DIMENSION ? 0 : NETHER_DIMENSION);
}

function travelToDimension(player, targetDimension) {
    if ((player.dimension ?? 0) === targetDimension) return;

    const scale = targetDimension === NETHER_DIMENSION ? 1 / 8 : 8;
    const tx = Math.floor(player.x * scale);
    const tz = Math.floor(player.z * scale);
    const ty = Math.max(4, Math.min(Math.floor(player.y), targetDimension === NETHER_DIMENSION ? 100 : 200));

    for (let dx = 0; dx < 4; dx++) {
        for (let dz = 0; dz < 2; dz++) {
            for (let dy = 0; dy < 5; dy++) {
                addWorldChange(tx + dx, ty + dy, tz + dz, 0, 0, targetDimension);
            }
            addWorldChange(tx + dx, ty - 1, tz + dz, 256, 0, targetDimension);
        }
    }

    for (let dx = 0; dx < 2; dx++) {
        for (let dy = 0; dy < 3; dy++) {
            addWorldChange(tx + dx, ty + dy, tz, PORTAL_ID, 0, targetDimension);
        }
    }

    player.dimension = targetDimension;
    player.x = tx + 2.5;
    player.y = ty;
    player.z = tz + 0.5;
    player.onGround = false;
    player.portalCooldown = Date.now() + PORTAL_COOLDOWN_MS;

    playerChunks.set(player.eid, new Set());
    savePlayerData(player);

    if (player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({
            type: 'dimension',
            dimension: targetDimension,
            worldType: getDimensionType(targetDimension)
        }));
    }

    checkAndSendChunks(player);
    sendSpawnPosition(player);
    sendPlayerPositionLook(player);
    broadcast(createEntityTeleportPacket(player), getPlayers());
}

function checkAndSendChunks(player) {
    const renderDistance = 5;
    const playerChunkX = Math.floor(player.x / 16);
    const playerChunkZ = Math.floor(player.z / 16);

    const sentChunks = playerChunks.get(player.eid) || new Set();

    for (let cx = playerChunkX - renderDistance; cx <= playerChunkX + renderDistance; cx++) {
        for (let cz = playerChunkZ - renderDistance; cz <= playerChunkZ + renderDistance; cz++) {
            const chunkKey = `${cx},${cz}`;
            if (!sentChunks.has(chunkKey)) {
                sendSingleChunk(player, cx, cz);
                sentChunks.add(chunkKey);
            }
        }
    }

    playerChunks.set(player.eid, sentChunks);
}

function cleanupPlayerChunks(eid) {
    playerChunks.delete(eid);
}




function respawnPlayer(player) {
    const spawn = getSpawnPosition(player.dimension ?? 0);

    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = 0.0;
    player.pitch = 0.0;
    player.onGround = false;
    player.health = 20;
    player.isFlying = false;
    savePlayerData(player);

    const sentChunks = new Set();
    for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
            sentChunks.add(`${cx},${cz}`);
        }
    }
    playerChunks.set(player.eid, sentChunks);

    if (player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({
            type: 'respawn',
            x: player.x,
            y: player.y,
            z: player.z,
            yaw: player.yaw,
            pitch: player.pitch,
            health: player.health,
            gamemode: player.gamemode,
            flying: !!player.isFlying
        }));
    }

    sendChunks(player);
    checkAndSendChunks(player);
    sendSpawnPosition(player);

    broadcast(createEntityTeleportPacket(player), getPlayers());
}

export {
    handlePacket,
    cleanupPlayerChunks,
    respawnPlayer,
    flushSaveWorld,
    lightPortal
};
