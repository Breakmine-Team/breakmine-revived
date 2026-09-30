import Logger from './logger.js';
import fs from '../client/fs/ServerFs.js';
import path from '../util/path.js';
import config from './config.js';
import * as world from './world.js';
import * as packets from './packets.js';
import * as protocol from './protocol.js';

const players = new Map();
let nextEntityId = 1;

let log = Logger;

// Player data is stored inside each server's own directory so every server
// keeps its players' positions, inventories and states separate:
//   main    -> <root>/players/<username>.json
//   server2 -> <root>/worlds/server2/players/<username>.json
function getPlayersDir() {
    return path.join(world.getWorldDir(world.getCurrentWorldName()), 'players');
}

function ensurePlayersDir() {
    const dir = getPlayersDir();
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
}

function normalizeItem(item) {
    if (!item || typeof item !== 'object') {
        return { typeId: 0, count: 0 };
    }

    return {
        typeId: item.typeId ?? 0,
        count: item.count ?? 0
    };
}

function normalizeInventoryState(inventory) {
    if (Array.isArray(inventory)) {
        return {
            selectedSlotIndex: 0,
            itemInCursor: { typeId: 0, count: 0 },
            items: inventory.map(normalizeItem)
        };
    }

    if (!inventory || typeof inventory !== 'object') {
        return {
            selectedSlotIndex: 0,
            itemInCursor: { typeId: 0, count: 0 },
            items: []
        };
    }

    const items = Array.isArray(inventory.items) ? inventory.items.map(normalizeItem) : [];
    while (items.length < 36) {
        items.push({ typeId: 0, count: 0 });
    }

    return {
        selectedSlotIndex: Number(inventory.selectedSlotIndex || 0),
        itemInCursor: normalizeItem(inventory.itemInCursor),
        items
    };
}

const GAMEMODE_MAP = { survival: 0, creative: 1, spectator: 3 };

function resolveDefaultGamemode() {
    const value = config.default_gamemode;
    if (value === 0 || value === 1 || value === 3 || value === '0' || value === '1' || value === '3') {
        return Number(value);
    }
    return GAMEMODE_MAP[String(value).toLowerCase()] ?? 1;
}

function isOp(player) {
    const username = String((player && player.username) || '').toLowerCase();
    if (!username) {
        return false;
    }
    if (config.default_op === true) {
        return true;
    }
    const list = Array.isArray(config.op_player_list) ? config.op_player_list : [];
    return list.some(name => String(name).toLowerCase() === username);
}

function addPlayer(player) {
    player.eid = nextEntityId++;
    player.joinTime = Date.now();
    player.gamemode = player.gamemode ?? resolveDefaultGamemode();
    player.health = typeof player.health === 'number' ? player.health : 20;
    player.inventory = normalizeInventoryState(player.inventory);
    players.set(player.eid, player);
}

function findPlayerByUsername(username) {
    if (!username) {
        return null;
    }

    const normalized = username.toLowerCase();
    for (const player of players.values()) {
        if (player && player.username && player.username.toLowerCase() === normalized) {
            return player;
        }
    }

    return null;
}

function removePlayer(player) {
    // Send player list removal (action 4 = REMOVE_PLAYER) BEFORE deleting from map
    if (packets.sendPlayerListEntry && protocol.broadcast) {
        const removePacket = packets.sendPlayerListEntry([player], 4);
        protocol.broadcast(removePacket, players);

        // Send destroy entity packet to remove player entity from all clients
        protocol.broadcast(packets.createDestroyEntityPacket(player.eid), players);
    }

    // Save player data before removing
    savePlayerData(player);

    // Remove from players map
    players.delete(player.eid);

    const playTime = Math.floor((Date.now() - player.joinTime) / 1000);
    log.info('Chat', `${player.username} left the game. (Play time: ${playTime}s)`);

    if (packets.sendChatMessage) {
        packets.sendChatMessage(`§e${player.username} left the game.`);
    }
}

function getPlayers() {
    return players;
}

function isSpectator(player) {
    return player.gamemode === 3;
}

function getPlayerCount() {
    return players.size;
}

function updatePosition(player) {
    // Placeholder for position validation if needed
}

function getPlayerFile(username) {
    const sanitized = username.toLowerCase().replace(/[^a-z0-9_]/g, '');
    return path.join(getPlayersDir(), `${sanitized}.json`);
}

function savePlayerData(player) {
    ensurePlayersDir();
    const playerFile = getPlayerFile(player.username);
    const data = {
        username: player.username,
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        pitch: player.pitch,
        isFlying: player.isFlying || false,
        gamemode: player.gamemode,
        health: player.health,
        cape: player.cape || null,
        inventory: normalizeInventoryState(player.inventory)
    };
    fs.writeFileSync(playerFile, JSON.stringify(data, null, 2));
}

function loadPlayerData(username) {
    const playerFile = getPlayerFile(username);
    if (fs.existsSync(playerFile)) {
        try {
            const data = JSON.parse(fs.readFileSync(playerFile, 'utf8'));
            return data;
        } catch (e) {
            log.warn('Players', `Failed to load player data for ${username}: ${e.message}`);
            return null;
        }
    }
    return null;
}

export {
    addPlayer,
    findPlayerByUsername,
    removePlayer,
    getPlayers,
    getPlayerCount,
    isSpectator,
    isOp,
    updatePosition,
    savePlayerData,
    loadPlayerData,
    normalizeInventoryState
};
