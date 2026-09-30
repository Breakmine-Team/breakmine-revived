import { Buffer } from '../../../../../libraries/buffer.js';
import { readLongBE } from './binary.js';
import { readVarInt, readString, broadcast, ensureReadable, MalformedPacketError } from './protocol.js';
import { addPlayer, removePlayer, getPlayers, updatePosition, loadPlayerData, findPlayerByUsername, normalizeInventoryState, savePlayerData, isSpectator } from './players.js';
import { addWorldChange, saveWorld, getBlockAt, getAllBlockInventoriesState, getSpawnPosition, deleteBlockInventory, getBlockInventories, getWorldTime, getBlockMetadata, setBlockInventory } from './world.js';
import { addItemEntity, removeItemEntity, getItemEntity, getAllItemEntities } from './entities.js';
import { handleCommand } from './commands.js';
import {
    sendLoginSuccess,
    sendJoinGame,
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
import getServerWorld from './World.js';
import Block from '../client/world/block/Block.js';
import { NO_MODULES } from '../util/environment.js';

// Sign-text censoring. The bad-words package is never loaded when the server
// runs without Node modules (singleplayer integrated server), so sign text is
// stored verbatim there. In Node it is imported lazily and applies from the
// first edit after it resolves.
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

// A block counts as "solid" for the buried-at-login check only if it fully
// occupies its cell: air, water, lava and passable plants don't count.
const FLUID_IDS = new Set([8, 9, 10, 11]);
function isSolidBlock(blockId) {
    return blockId !== 0 && !FLUID_IDS.has(blockId);
}

let log = Logger;

// A failed world save (disk full, sandboxed FS, ...) must never take down the
// connection or interrupt gameplay — log it and continue.
function doSaveWorld() {
    try {
        saveWorld();
    } catch (e) {
        log.error('Server', 'Failed to save world: ' + (e && e.message));
    }
}

// saveWorld() rewrites the entire world file, and a single action triggers
// several of them: placing a block also fires onBlockAdded, neighbour ticks
// and the dig that follows, so a burst of activity wrote the whole world over
// and over. On a world with ~1M changes that is tens of megabytes per block
// placed, which is slow enough to look like the game has hung and leaves the
// write open long enough to be interrupted.
//
// Coalesce a burst into one write. This is a throttle rather than a trailing
// debounce: the first change schedules the write and later changes ride along
// with it, so a continuous stream of edits can never starve the save.
const SAVE_DEBOUNCE_MS = 2000;
let pendingSaveTimer = null;

function safeSaveWorld() {
    if (pendingSaveTimer !== null) return;
    pendingSaveTimer = setTimeout(() => {
        pendingSaveTimer = null;
        doSaveWorld();
    }, SAVE_DEBOUNCE_MS);
    // Never hold the process open just to write a world.
    if (typeof pendingSaveTimer.unref === 'function') pendingSaveTimer.unref();
}

// A scheduled save that never fires would lose the last couple of seconds of
// edits, so the shutdown path calls this to write immediately. Returns true if
// there was something pending, so the caller can skip a redundant second write.
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

// Track which chunks each player has received
const playerChunks = new Map();

// Helper function to unpack Protocol 47 (1.8) packed 64-bit Position types
function readPosition(buffer, offset) {
    const val = readLongBE(buffer, offset);

    // Protocol 47 Bit Allocations: X (26 MSBs), Z (26 LSBs), Y (12 bits in between)
    // We use BigInt bitwise arithmetic and shift them back to signed values
    let x = val >> 38n;
    let y = (val >> 26n) & 0xFFFn;
    let z = val & 0x3FFFFFFn;

    // Handle 2's complement sign extension for negative coordinates (using BigInt)
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

    try {
        let offset = 0;
        const [length, lenBytes] = readVarInt(buffer, offset);
        offset += lenBytes;

        // The declared packet length must not exceed the bytes actually
        // present, otherwise subsequent reads would run off the end.
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
            // Protocol violations are unrecoverable — drop the connection.
            try {
                if (player.ws && player.ws.readyState === 1) {
                    player.ws.close();
                }
            } catch (e) {
                // Ignore errors while closing the broken connection.
            }
        } else {
            // Internal/gameplay errors (a failed world save, a block handler
            // edge case, ...) must not disconnect the player. Log and carry on.
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

        // Reject absurdly long names up front so downstream fixed-size packet
        // writers can never run off the end of their buffers.
        if (!username || username.length > 32) {
            log.info('Server', `Rejected login with invalid username length`);
            if (player.ws.readyState === 1) {
                player.ws.send(createDisconnectPacket('§cInvalid username.'));
                player.ws.close();
            }
            return;
        }

        player.username = username;

        if (!config.allowMods && player.mods && player.mods.length > 0) {
            const modNames = player.mods.map(m => m.name).join(', ');
            log.info('Server', `${username} kicked — mods not allowed (has: ${modNames})`);
            if (player.ws.readyState === 1) {
                player.ws.send(createDisconnectPacket(`§cThis server does not allow mods. Please disable your mods to join.`));
                player.ws.close();
            }
            return;
        }

        const existingPlayer = findPlayerByUsername(username);
        if (existingPlayer) {
            // A stale player object left behind by a previous connection or
            // session must not survive the rejoin: if it stays in the player
            // list the client sees a duplicate of itself (a clone that mirrors
            // movement and chat). Close its socket and remove it so the new
            // connection below is the only player with this username.
            if (existingPlayer.ws && existingPlayer.ws.readyState === 1) {
                existingPlayer.ws.close();
            }
            if (existingPlayer.eid !== null) {
                removePlayer(existingPlayer);
                cleanupPlayerChunks(existingPlayer.eid);
                // Mark it so the socket's own 'close' handler (which guards on
                // player.eid) skips the redundant second removal.
                existingPlayer.eid = null;
            }
        }

        player.protocolState = 'play';

        const spawn = getSpawnPosition();

        // Load player data if exists
        const playerData = loadPlayerData(username);
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

            // A saved position from a previous world type/seed can be buried
            // inside solid terrain (e.g. y=10 saved on a flat world, now
            // underground on a normal world). If the player's whole body is in
            // solid blocks, respawn at the current world spawn instead.
            const px = Math.floor(player.x);
            const py = Math.floor(player.y);
            const pz = Math.floor(player.z);
            if (isSolidBlock(getBlockAt(px, py, pz)) && isSolidBlock(getBlockAt(px, py + 1, pz))) {
                player.x = spawn.x;
                player.y = spawn.y;
                player.z = spawn.z;
            }
        } else {
            // Initialize player position at spawn
            player.x = spawn.x;
            player.y = spawn.y;
            player.z = spawn.z;
            player.yaw = 0;
            player.pitch = 0;
            player.isFlying = false;
            player.inventory = normalizeInventoryState([]);
            player.cape = null;
        }

        addPlayer(player);
        log.info('Chat', `${player.username} joined the game.`);

        sendLoginSuccess(player);
        sendJoinGame(player);
        sendSpawnPosition(player);

        // Transmit the saved position right away so the client is placed at
        // its saved spot before it can report the spawn position back to us.
        sendPlayerPositionLook(player);

        // Send the player's saved state via a custom JSON packet. This is the
        // authoritative restore: position, rotation, health and gamemode all in
        // one atomic message, so the client can apply them regardless of how the
        // vanilla 0x08 teleport happens to be ordered against world loading.
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

        // Send the player's saved inventory, health and gamemode so the client
        // starts with the same state as when they left, instead of a fresh one.
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

        // Initialize chunk tracking BEFORE sending chunks so checkAndSendChunks
        // can track which chunks have already been sent
        const sentChunks = new Set();
        // Pre-populate with the 5x5 spawn chunks that sendChunks will send
        for (let cx = -2; cx <= 2; cx++) {
            for (let cz = -2; cz <= 2; cz++) {
                sentChunks.add(`${cx},${cz}`);
            }
        }
        playerChunks.set(player.eid, sentChunks);

        // Send initial 5x5 spawn chunks + PlayerPositionLook
        sendChunks(player);

        // Immediately send the rest of the render distance worth of chunks
        // without waiting for the client's position response round-trip.
        // This prevents the loading screen from getting stuck at low progress
        // on slow connections.
        checkAndSendChunks(player);

        if (player.ws.readyState === 1) {
            player.ws.send(JSON.stringify({
                type: 'blockInventories',
                inventories: getAllBlockInventoriesState()
            }));

            // Send sign text updates for all signs
            const inventories = getBlockInventories();
            for (const [key, inv] of inventories) {
                if (inv && inv.text) {
                    const [x, y, z] = key.split(',').map(Number);
                    sendSignTextUpdate(player.ws, x, y, z, inv.text);
                }
            }
        }

        // Send initial time to client
        sendTimeUpdate(player, getWorldTime());

        // Send player list to the new player (include self so Tab list shows own username)
        const players = getPlayers();
        const visiblePlayers = Array.from(players.values()).filter(p => p.eid === player.eid || canSee(player, p));
        player.ws.send(sendPlayerListEntry(visiblePlayers, 0));
        player.ws.send(sendPlayerListData());

        for (const [eid, p] of players) {
            if (eid === player.eid) continue;
            // Only send spawn for players visible to the new player
            if (canSee(player, p)) {
                player.ws.send(createSpawnPlayerPacket(p));
            }
            // Only send new player spawn to players who can see him
            if (canSee(p, player)) {
                p.ws.send(createSpawnPlayerPacket(player));
            }
            // Only send player list entry to players who can see the new player
            if (canSee(p, player)) {
                p.ws.send(sendPlayerListEntry([player], 0));
            }
        }

        // Send existing item entities to the new player
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
        case 0x01: { // Chat Message
            const [msg] = readString(buffer, offset);

            // Check if message is a command
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

        case 0x04: { // Player Position
            ensureReadable(buffer, offset, 25);
            player.x = buffer.readDoubleBE(offset);
            player.y = buffer.readDoubleBE(offset + 8);
            player.z = buffer.readDoubleBE(offset + 16);
            player.onGround = buffer.readUInt8(offset + 24) === 1;
            broadcastMovement(player);
            checkAndSendChunks(player);
            break;
        }

        case 0x05: { // Player Look
            ensureReadable(buffer, offset, 9);
            player.yaw = buffer.readFloatBE(offset);
            player.pitch = buffer.readFloatBE(offset + 4);
            player.onGround = buffer.readUInt8(offset + 8) === 1;
            broadcastMovement(player);
            break;
        }

        case 0x06: { // Player Position And Look
            ensureReadable(buffer, offset, 33);
            player.x = buffer.readDoubleBE(offset);
            player.y = buffer.readDoubleBE(offset + 8);
            player.z = buffer.readDoubleBE(offset + 16);
            player.yaw = buffer.readFloatBE(offset + 24);
            player.pitch = buffer.readFloatBE(offset + 28);
            player.onGround = buffer.readUInt8(offset + 32) === 1;
            broadcastMovement(player);
            checkAndSendChunks(player);
            break;
        }

        case 0x07: { // Protocol 47: Player Digging (Block Breaking)
            handlePlayerDigging(player, buffer, offset);
            break;
        }

        case 0x08: { // Protocol 47: Player Block Placement
            handleBlockPlacement(player, buffer, offset);
            break;
        }

        case 0x0A: { // Animation (Arm Swing)
            broadcastAnimation(player);
            break;
        }

        case 0x0B: { // Entity Action (Player State)
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

        case 0x09: { // Client Drop Item
            handleDropItem(player, buffer, offset);
            break;
        }

        case 0x0D: { // Client Pickup Item
            handlePickupItem(player, buffer, offset);
            break;
        }

        case 0x0E: { // Client Update Sign Text
            handleUpdateSignText(player, buffer, offset);
            break;
        }


    }
}


function handlePlayerDigging(player, buffer, offset) {
    ensureReadable(buffer, offset, 10);
    const status = buffer.readUInt8(offset); // 0: Started, 1: Cancelled, 2: Finished
    const [x, y, z] = readPosition(buffer, offset + 1);
    const face = buffer.readUInt8(offset + 9);

    // Only "finished" (2) actually destroys the block. Treating "started" (0)
    // as a break made the server delete the block the moment mining began, so
    // an aborted dig could never be undone and the removal was saved and
    // broadcast before the client had even decided to break anything.
    if (status === 2) {
        const blockId = 0; // Air (broken block)
        const prevBlockId = getBlockAt(x, y, z);
        const serverWorld = getServerWorld();

        addWorldChange(x, y, z, blockId);

        // Delete sign text / block inventory state on server
        deleteBlockInventory(`${x},${y},${z}`);

        // Let the removed block clean up (door halves, pusher head, dust
        // network re-propagation) before its neighbors are woken up.
        const prevBlock = Block.getById(prevBlockId);
        if (prevBlock && prevBlock.onBlockRemoved) {
            try {
                prevBlock.onBlockRemoved(serverWorld, x, y, z);
            } catch (e) {
                log.error('Server', `onBlockRemoved error at ${x},${y},${z}: ${e.message}`);
            }
        }

        // Wake up neighbors so observers / repeaters / dust react.
        serverWorld.scheduleNeighborTicks(x, y, z);
        serverWorld.notifyNeighborBlockChange(x, y, z);

        safeSaveWorld();

        const players = getPlayers();
        const blockState = (blockId << 4) | 0; // No metadata for broken blocks
        for (const p of players.values()) {
            sendBlockChange(p.ws, x, y, z, blockState);
        }

        // Broadcast animation to other players when block is broken
        broadcastAnimation(player);
    }
}

function handleUpdateSignText(player, buffer, offset) {
    ensureReadable(buffer, offset, 8);
    const [x, y, z] = readPosition(buffer, offset);
    const [rawText, textBytes] = readString(buffer, offset + 8);

    // Clean text using the bad-words library (when enabled; singleplayer
    // integrated servers store sign text verbatim).
    const text = sanitizeText(rawText).substring(0, 200);

    log.info('Server', `Sign text update: ${x},${y},${z} = "${text}"`);

    const blockKey = `${x},${y},${z}`;
    setBlockInventory(blockKey, { text: text });
    safeSaveWorld();

    // Broadcast sign text update to all players via packet
    const players = getPlayers();
    for (const p of players.values()) {
        if (p.ws.readyState === 1) {
            sendSignTextUpdate(p.ws, x, y, z, text);
        }
    }
}

function handleBlockPlacement(player, buffer, offset) {
    ensureReadable(buffer, offset, 11);
    const [x, y, z] = readPosition(buffer, offset);
    const direction = buffer.readUInt8(offset + 8);

    // Read held item from packet (offset + 9)
    const heldItemId = buffer.readInt16BE(offset + 9);

    // Protocol 47: direction 255 means "use item / interact with block"
    // (right-click). Blocks that change state when activated (doors) are
    // handled here so the change is authoritative and broadcast to everyone.
    if (direction === 255) {
        const targetId = getBlockAt(x, y, z);
        const targetBlock = Block.getById(targetId);
        if (targetBlock && typeof targetBlock.onMouseButton === 'function') {
            const serverWorld = getServerWorld();
            try {
                targetBlock.onMouseButton(serverWorld, x, y, z, 2);
            } catch (e) {
                log.error('Server', `onMouseButton error at ${x},${y},${z}: ${e.message}`);
            }
        }
        return;
    }

    if (direction !== 255) {
        // Calculate offset block position based on face targeted
        const dx = [0, 0, 0, 0, -1, 1][direction];
        const dy = [-1, 1, 0, 0, 0, 0][direction];
        const dz = [0, 0, -1, 1, 0, 0][direction];

        const placeX = x + dx;
        const placeY = y + dy;
        const placeZ = z + dz;

        // Prevent placement below y=0
        if (placeY < 0) {
            return;
        }

        // Prevent placement inside other players
        const players = getPlayers();
        for (const p of players.values()) {
            // Player bounding box: width 0.6, height 1.8
            const playerMinX = p.x - 0.3;
            const playerMaxX = p.x + 0.3;
            const playerMinY = p.y;
            const playerMaxY = p.y + 1.8;
            const playerMinZ = p.z - 0.3;
            const playerMaxZ = p.z + 0.3;

            // Check if block intersects with player (AABB intersection)
            if (placeX < playerMaxX && placeX + 1 > playerMinX &&
                placeY < playerMaxY && placeY + 1 > playerMinY &&
                placeZ < playerMaxZ && placeZ + 1 > playerMinZ) {
                // Send block change to revert client prediction
                const currentBlockId = getBlockAt(placeX, placeY, placeZ) || 0;
                const currentMetadata = getBlockMetadata(placeX, placeY, placeZ) || 0;
                const currentBlockState = (currentBlockId << 4) | currentMetadata;
                sendBlockChange(player.ws, placeX, placeY, placeZ, currentBlockState);
                return;
            }
        }

        // The client reports which block it placed. Only a real, placeable
        // block may be written: an absent id, an id the registry doesn't know
        // or a non-block item (bucket, flint, ...) must be dropped, because
        // such an id survives the save file and is then decoded as an unknown
        // block on the next chunk load, which the client renders as stone.
        const heldBlock = heldItemId > 0 ? Block.getById(heldItemId) : null;
        if (heldBlock === null || typeof heldBlock.isItem === 'function' && heldBlock.isItem()) {
            return;
        }
        const blockId = heldItemId;

        // Custom Stair Block IDs registered in BlockRegistry:
        // 150: Oak, 151: Spruce, 152: Birch, 153: Jungle, 154: Acacia,
        // 155: Cobblestone, 156: Mossy Cobblestone, 157: Brick
        const isStair = [150, 151, 152, 153, 154, 155, 156, 157].includes(blockId);

        // Calculate metadata based on block type and placement direction
        let metadata = 0;

        if (blockId === 50) { // Torch
            if (direction === 1) metadata = 5;
            else if (direction === 2) metadata = 4;
            else if (direction === 3) metadata = 3;
            else if (direction === 4) metadata = 2;
            else if (direction === 5) metadata = 1;
            else metadata = 5;
        } else if (blockId === 17 || blockId === 59 || blockId === 62 || blockId === 65 || blockId === 68) { // Logs
            if (direction === 4 || direction === 5) metadata = 1;
            else if (direction === 2 || direction === 3) metadata = 2;
            else metadata = 0;
        } else if (blockId >= 70 && blockId <= 77) { // Slabs
            if (direction === 0) metadata = 1;
            else metadata = 0;
        } else if (blockId === 32 || blockId === 34) { // Chest and Furnace
            let yaw = player.yaw ?? player.rotationYaw ?? 0;
            let dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
            metadata = [2, 5, 3, 4][dirIndex];
        } else if (isStair) { // Custom Stair Rotation
            let yaw = player.yaw ?? player.rotationYaw ?? 0;
            let dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
            // Inverted array mapping (3: NORTH, 0: EAST, 2: SOUTH, 1: WEST) to match client placement
            metadata = [3, 0, 2, 1][dirIndex];
            // Upside-down stair if placed against bottom face of overhead block
            if (direction === 0) metadata |= 4;
        } else if (blockId === 121) { // BlockRegistry.SIGN
            let yaw = player.yaw ?? player.rotationYaw ?? 0;
            let dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
            // 0: South, 2: North -> X-axis rotation (data = 1); 1: West, 3: East -> Z-axis rotation (data = 0)
            if (dirIndex === 0 || dirIndex === 2) {
                metadata = 1;
            } else {
                metadata = 0;
            }
        } else if (blockId === 160) { // Oak Door (bottom half places the top half)
            let yaw = player.yaw ?? player.rotationYaw ?? 0;
            let dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
            metadata = [2, 5, 3, 4][dirIndex];
        } else if (blockId === 168 || blockId === 169) { // Bluestone Repeater / Observer
            let yaw = player.yaw ?? player.rotationYaw ?? 0;
            let dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
            // Direction stored in bits 1-2 (0: SOUTH, 1: WEST, 2: NORTH, 3: EAST)
            metadata = dirIndex << 1;
        } else if (blockId === 178) { // Bluestone Lever
            // Mounted face (opposite of the clicked face) stored in bits 1-3
            metadata = ([1, 0, 3, 2, 5, 4][direction] ?? 0) << 1;
        }

        addWorldChange(placeX, placeY, placeZ, blockId, metadata);

        // Doors are two blocks tall; the bottom half always carries the top.
        const doorTop = blockId === 160 && getBlockAt(placeX, placeY + 1, placeZ) !== 161;
        if (doorTop) {
            addWorldChange(placeX, placeY + 1, placeZ, 161, metadata);
        }

        // Trigger the block's server-side lifecycle + wake up neighbors so the
        // bluestone simulation (dust propagation, lamps, repeaters, observers,
        // doors) runs authoritatively on the server.
        const serverWorld = getServerWorld();
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

        // Broadcast animation to other players when block is placed
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

    // The client sends the exact spawn position: the broken block's position
    // when an item is dropped from breaking, or the player's position when
    // dropping the held item (Q).
    const spawnX = buffer.readInt32BE(offset + 2) + 0.5;
    const spawnY = buffer.readInt32BE(offset + 6) + 0.5;
    const spawnZ = buffer.readInt32BE(offset + 10) + 0.5;

    // Only Q-drops keep the pickup delay on the client.
    const hasPickupDelay = buffer.readUInt8(offset + 14) === 1;

    // Motion: pop upward with a little random drift
    const motionX = (Math.random() - 0.5) * 0.15;
    const motionY = 0.2;
    const motionZ = (Math.random() - 0.5) * 0.15;

    const entity = addItemEntity(blockId, spawnX, spawnY, spawnZ, motionX, motionY, motionZ, player.eid, hasPickupDelay);

    // Broadcast spawn to all players
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

    // Remove from server tracking
    removeItemEntity(entityId);

    // Broadcast destroy to all players
    const destroyPacket = createDestroyEntityPacket(entityId);
    const players = getPlayers();
    for (const p of players.values()) {
        if (p.ws.readyState === 1) {
            p.ws.send(destroyPacket);
        }
    }
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

// Respawn a player after death: reset to the world spawn, push fresh chunks
// around it, and tell the client to re-arm its loading gate so the player only
// becomes active once the terrain around the spawn is loaded. Returns nothing.
function respawnPlayer(player) {
    const spawn = getSpawnPosition();

    player.x = spawn.x;
    player.y = spawn.y;
    player.z = spawn.z;
    player.yaw = 0.0;
    player.pitch = 0.0;
    player.onGround = false;
    player.health = 20;
    player.isFlying = false;
    savePlayerData(player);

    // Reset per-player chunk tracking so every chunk around the new spawn is
    // sent again instead of being skipped as "already sent" from the old spot.
    const sentChunks = new Set();
    for (let cx = -2; cx <= 2; cx++) {
        for (let cz = -2; cz <= 2; cz++) {
            sentChunks.add(`${cx},${cz}`);
        }
    }
    playerChunks.set(player.eid, sentChunks);

    if (player.ws.readyState === 1) {
        // Authoritative respawn state must arrive BEFORE chunks so the client
        // re-arms its loading screen and targets the new position while it
        // streams terrain in (it cannot fall while frozen on the loading screen).
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

    // Let other players see the respawned player at the new position.
    broadcast(createEntityTeleportPacket(player), getPlayers());
}

export {
    handlePacket,
    cleanupPlayerChunks,
    respawnPlayer,
    flushSaveWorld
};
