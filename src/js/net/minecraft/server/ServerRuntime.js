import { initWorld, saveWorld, getSubChunkStore, loadCurrentWorld, getWorldTime, tickWorldTime, setBlockInventory, getBlockInventories, getCurrentWorldName } from './world.js';
import { tickAllFurnaces, broadcastFurnaceChanges } from './Furnace.js';
import { sendTimeUpdate, sendChatMessage, sendPlayerListEntry } from './packets.js';
import { handlePacket, cleanupPlayerChunks, respawnPlayer, flushSaveWorld } from './handlers.js';
import { addPlayer, removePlayer, getPlayerCount, getPlayers, savePlayerData, normalizeInventoryState } from './players.js';
import Logger from './logger.js';
import { BlockRegistry } from '../client/world/block/BlockRegistry.js';
import getServerWorld from './World.js';
import config from './config.js';
import * as protocol from './protocol.js';

const log = Logger;

let tickInterval = null;
let autosaveInterval = null;
let playerSaveInterval = null;
let started = false;

const MAX_CAPE_DATA_URL_LENGTH = 512 * 1024;

function isValidCapeDataUrl(value) {
    return value === null || (
        typeof value === 'string' &&
        value.startsWith('data:image/png;base64,') &&
        value.length <= MAX_CAPE_DATA_URL_LENGTH
    );
}

function sendCapeStates(target) {
    if (!target?.ws || target.ws.readyState !== 1) return;
    for (const player of getPlayers().values()) {
        if (!player.cape) continue;
        target.ws.send(JSON.stringify({
            type: 'cape:state',
            username: player.username,
            cape: player.cape
        }));
    }
}

function broadcastCapeState(player) {
    const message = JSON.stringify({
        type: 'cape:state',
        username: player.username,
        cape: player.cape || null
    });
    for (const peer of getPlayers().values()) {
        if (peer.ws.readyState === 1) peer.ws.send(message);
    }
}

// Initialize the world: pick the server (CLI flag wins, else last used),
// load its config + world data, register game blocks and seed pending block
// ticks. Safe to call once; subsequent calls are no-ops until stopServer().
export function initServer() {
    if (started) {
        return;
    }
    started = true;

    const currentWorld = config.requestedServer || loadCurrentWorld();
    config.reload(currentWorld);
    initWorld(currentWorld);
    BlockRegistry.create(); // Initialize block registry from game code
    const serverWorld = getServerWorld(); // Initialize server world for block ticking

    // Seed block ticks for any saved bluestone components so loaded networks
    // (dust, lamps, repeaters, doors) settle to their correct state.
    serverWorld.seedScheduledTicks(getSubChunkStore());

    // Start server tick loop for block ticking and world time synchronization
    tickInterval = setInterval(() => {
        try {
            serverWorld.onTick();
            tickWorldTime();

            const furnaces = tickAllFurnaces(getBlockInventories());
            broadcastFurnaceChanges(getPlayers(), furnaces);

            const worldTime = getWorldTime();
            const players = getPlayers();
            for (const player of players.values()) {
                if (player.ws.readyState === 1) {
                    sendTimeUpdate(player, worldTime);
                }
            }
        } catch (e) {
            // A single bad tick must never take down the whole server.
            log.error('Server', 'Error during server tick: ' + e.message);
        }
    }, 1000 / 20); // Tick every 1/20th second

    // Save world time and world state every 15 seconds.
    autosaveInterval = setInterval(() => {
        saveWorld();
    }, 15 * 1000);

    // Periodically save player positions (every 15 seconds) for crash resilience
    playerSaveInterval = setInterval(() => {
        const players = getPlayers();
        for (const player of players.values()) {
            if (player.username) {
                savePlayerData(player);
            }
        }
    }, 15 * 1000);

    log.info('Server', `Minecraft server started (world: ${getCurrentWorldName()})`);
}

// Handle an incoming connection. `ws` is any object exposing the subset of the
// ws API the server uses (on/send/close/readyState): a native ws socket in
// Node.js, or a LoopbackSocket adapter in the browser.
export function onConnection(ws) {
    const player = {
        ws,
        eid: null,
        username: null,
        protocolState: 'handshake', // Start in handshake state
        x: 0.0,
        y: 64.0,
        z: 0.0,
        yaw: 0.0,
        pitch: 0.0,
        onGround: true,
        isSneaking: false
    };

    ws.on('message', (message, isBinary) => {
        try {
            if (isBinary) {
                handlePacket(player, message);
                return;
            }

            const text = typeof message === 'string' ? message : message.toString('utf8');
            if (text === 'ping' || text === 'status') {
                const payload = {
                    type: 'status',
                    players: getPlayerCount(),
                    maxPlayers: 35,
                    motd: config.motd || ''
                };
                ws.send(JSON.stringify(payload));
                return;
            }

            const payload = JSON.parse(text);
            if (payload && payload.type === 'inventory') {
                player.inventory = normalizeInventoryState(payload.inventory);
                savePlayerData(player);
            } else if (payload && payload.type === 'cape:request') {
                sendCapeStates(player);
            } else if (payload && payload.type === 'cape:update') {
                // The username is taken from the authenticated login state;
                // clients cannot update another player's cape.
                if (!player.username || payload.username !== player.username) {
                    return;
                }
                if (!isValidCapeDataUrl(payload.cape)) {
                    log.warn('Server', `Rejected invalid cape from ${player.username}`);
                    return;
                }
                player.cape = payload.cape;
                savePlayerData(player);
                broadcastCapeState(player);
            } else if (payload && payload.type === 'health') {
                if (typeof payload.health === 'number') {
                    player.health = Math.max(0, Math.min(20, payload.health));
                    savePlayerData(player);
                }
            } else if (payload && payload.type === 'gamemode') {
                if (typeof payload.gamemode === 'number') {
                    player.gamemode = payload.gamemode;
                    if (typeof payload.flying === 'boolean') {
                        player.isFlying = payload.flying;
                    }
                    savePlayerData(player);
                    protocol.broadcast(sendPlayerListEntry([player], 1), getPlayers());
                }
            } else if (payload && payload.type === 'blockInventory') {
                const blockKey = payload.key || `chest:${payload.position?.x}:${payload.position?.y}:${payload.position?.z}`;
                if (blockKey && payload.inventory) {
                    setBlockInventory(blockKey, payload.inventory);
                    saveWorld();
                }
            } else if (payload && payload.type === 'death' && player) {
                const deathMsg = `${payload.username} ${payload.message}`;
                sendChatMessage(deathMsg);
                player.health = 0;
                savePlayerData(player);
            } else if (payload && payload.type === 'respawn' && player) {
                respawnPlayer(player);
            } else if (payload && payload.type === 'attack' && player) {
                const targetId = payload.target;
                const damage = payload.damage || 2;
                const attacker = player.username;
                if (targetId != null) {
                    const players = getPlayers();
                    const hurtPacket = JSON.stringify({ type: 'hurt', eid: targetId, damage, attacker });
                    for (const [eid, p] of players) {
                        if (eid !== player.eid && p.ws.readyState === 1) {
                            p.ws.send(hurtPacket);
                        }
                    }
                }
            }
        } catch (err) {
            // Malformed packets and non-JSON text messages are handled here so
            // a single bad connection can never crash the whole server.
            log.warn('Server', 'Rejected bad message from client: ' + (err && err.message));
        }
    });

    // Abrupt disconnects emit 'error' on the socket; without a listener that
    // unhandled 'error' event would crash the entire server process.
    ws.on('error', () => {
        // The 'close' handler does the actual cleanup.
    });

    ws.on('close', () => {
        if (player.eid !== null) {
            removePlayer(player);
            cleanupPlayerChunks(player.eid);
        }
    });
}

// Stop the tick/autosave loops and persist the world. Used when the integrated
// server is shut down (e.g. returning to the main menu in singleplayer).
export function stopServer() {
    if (!started) {
        return;
    }
    started = false;

    if (tickInterval !== null) clearInterval(tickInterval);
    if (autosaveInterval !== null) clearInterval(autosaveInterval);
    if (playerSaveInterval !== null) clearInterval(playerSaveInterval);
    tickInterval = null;
    autosaveInterval = null;
    playerSaveInterval = null;

    // Block edits are persisted by a debounced save; if one is still queued it
    // has to be written now or the last couple of seconds of changes are lost.
    // If nothing was pending, fall through to the full save so anything the
    // tick loop changed (time, entities) is still flushed.
    if (flushSaveWorld()) return;

    try {
        saveWorld();
    } catch (e) {
        log.error('Server', 'Failed to save world on shutdown: ' + e.message);
    }
}
