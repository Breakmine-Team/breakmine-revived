import { initWorld, saveWorld, getSubChunkStore, loadCurrentWorld, getWorldTime, tickWorldTime, setBlockInventory, getBlockInventories, getCurrentWorldName, setActiveDimension } from './world.js';
import { tickAllFurnaces, broadcastFurnaceChanges } from './Furnace.js';
import { sendTimeUpdate, sendChatMessage, sendPlayerListEntry } from './packets.js';
import { handlePacket, cleanupPlayerChunks, respawnPlayer, flushSaveWorld } from './handlers.js';
import { createConnectionGate } from './security.js';
import { verifyConnection } from './security.js';

export { verifyConnection };
import { addPlayer, removePlayer, getPlayerCount, getPlayers, savePlayerData, normalizeInventoryState } from './players.js';
import Logger from './logger.js';
import { BlockRegistry } from '../client/world/block/BlockRegistry.js';
import { handleModMessage, loadServerSideMods } from './ServerModLoader.js';
import { handleStructurePaste } from './structurePaste.js';
import getServerWorld from './World.js';
import config from './config.js';
import * as protocol from './protocol.js';

const log = Logger;

let tickInterval = null;
let autosaveInterval = null;
let playerSaveInterval = null;
let latencyInterval = null;
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





function probeLatency(player) {
    if (!player?.ws || player.ws.readyState !== 1) return;

    const now = Date.now();
    if (player.pingSentAt && now - player.pingSentAt < 5000) return;

    player.pingId = (player.pingId || 0) + 1;
    player.pingSentAt = now;
    try {
        player.ws.send(JSON.stringify({ type: 'ping', id: player.pingId }));
    } catch (e) {
        player.pingSentAt = 0;
    }
}




export function initServer() {
    if (started) {
        return;
    }
    started = true;

    const currentWorld = config.requestedServer || loadCurrentWorld();
    config.reload(currentWorld);
    log.info('Server', `TNT ${config.allowTNT !== false ? 'enabled' : 'disabled'}, liquid flow ${config.allowLiquidFlow !== false ? 'enabled' : 'disabled'}`);
    initWorld(currentWorld);
    BlockRegistry.create(); 
    loadServerSideMods(); 
    const serverWorld = getServerWorld(); 

    serverWorld.seedScheduledTicks(getSubChunkStore());

    tickInterval = setInterval(() => {
        try {
            setActiveDimension(0);
            serverWorld.onTick();
            tickWorldTime();

            const furnaces = tickAllFurnaces(getBlockInventories());
            broadcastFurnaceChanges(getPlayers(), furnaces);

            const players = getPlayers();
            for (const player of players.values()) {
                if (player.ws.readyState === 1) {
                    sendTimeUpdate(player, getWorldTime(player.dimension ?? 0));
                }
            }
        } catch (e) {
            log.error('Server', 'Error during server tick: ' + e.message);
        }
    }, 1000 / 20); 

    autosaveInterval = setInterval(() => {
        saveWorld();
    }, 15 * 1000);

    playerSaveInterval = setInterval(() => {
        const players = getPlayers();
        for (const player of players.values()) {
            if (player.username) {
                savePlayerData(player);
            }
        }
    }, 15 * 1000);

    latencyInterval = setInterval(() => {
        for (const player of getPlayers().values()) {
            probeLatency(player);
        }
    }, 2 * 1000);

    log.info('Server', `Minecraft server started (world: ${getCurrentWorldName()})`);
}




export function onConnection(ws, req) {
    const player = {
        ws,
        eid: null,
        username: null,
        protocolState: 'handshake', 
        x: 0.0,
        y: 64.0,
        z: 0.0,
        yaw: 0.0,
        pitch: 0.0,
        onGround: true,
        isSneaking: false
    };

    const gate = createConnectionGate(req, ws);
    if (gate) {
        player.ip = gate.ip;
        player.gate = gate;
    }

    let loginTimer = null;
    if (gate) {
        loginTimer = setTimeout(() => {
            if (player.protocolState !== 'play' && ws.readyState === 1) {
                try {
                    ws.close();
                } catch (e) {
                }
            }
        }, 60 * 1000);
        if (typeof loginTimer.unref === 'function') loginTimer.unref();
    }

    const handleMessage = (message, isBinary) => {
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
                    motd: config.motd || '',
                    icon: config.getServerIcon()
                };
                ws.send(JSON.stringify(payload));
                return;
            }

            const payload = JSON.parse(text);
            if (payload && payload.type === 'pong') {
                if (player.pingSentAt && payload.id === player.pingId) {
                    const rtt = Date.now() - player.pingSentAt;
                    if (Number.isFinite(rtt) && rtt >= 0 && rtt <= 60000) {
                        player.ping = Math.round(rtt);
                        protocol.broadcast(sendPlayerListEntry([player], 2), getPlayers());
                    }
                    player.pingSentAt = 0;
                }
            } else if (payload && payload.type === 'inventory') {
                player.inventory = normalizeInventoryState(payload.inventory);
                savePlayerData(player);
            } else if (payload && payload.type === 'structurePaste') {
                handleStructurePaste(player, payload);
            } else if (payload && payload.type === 'modMessage') {
                if (player.username && typeof payload.modId === 'string' && payload.modId.length <= 64) {
                    handleModMessage(player, payload.modId, payload.payload);
                }
            } else if (payload && payload.type === 'cape:request') {
                sendCapeStates(player);
            } else if (payload && payload.type === 'cape:update') {
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
            } else if (payload && payload.type === 'voice' && player) {
                if (payload.action === 'announce') {
                    const relay = JSON.stringify({
                        type: 'voice',
                        action: 'announce',
                        username: String(payload.username || '').slice(0, 32),
                        peerId: String(payload.peerId || '')
                    });
                    for (const [eid, p] of getPlayers()) {
                        if (eid !== player.eid && p.ws.readyState === 1) {
                            p.ws.send(relay);
                        }
                    }
                }
            }
        } catch (err) {
            log.warn('Server', 'Rejected bad message from client: ' + (err && err.message));
        }
    };

    ws.on('message', (message, isBinary) => {
        if (gate) {
            const action = gate.beforeMessage(message, isBinary);
            if (action !== 'ok') return;
        }
        handleMessage(message, isBinary);
    });

    if (gate) {
        gate.onFlush = (message, isBinary) => handleMessage(message, isBinary);
    }

    ws.on('error', () => {
    });

    ws.on('close', () => {
        if (loginTimer !== null) clearTimeout(loginTimer);
        if (gate) {
            gate.dispose();
            gate.onFlush = null;
        }
        if (player.eid !== null) {
            removePlayer(player);
            cleanupPlayerChunks(player.eid);
        }
    });
}



export function stopServer() {
    if (!started) {
        return;
    }
    started = false;

    if (tickInterval !== null) clearInterval(tickInterval);
    if (autosaveInterval !== null) clearInterval(autosaveInterval);
    if (playerSaveInterval !== null) clearInterval(playerSaveInterval);
    if (latencyInterval !== null) clearInterval(latencyInterval);
    tickInterval = null;
    autosaveInterval = null;
    playerSaveInterval = null;
    latencyInterval = null;

    if (flushSaveWorld()) return;

    try {
        saveWorld();
    } catch (e) {
        log.error('Server', 'Failed to save world on shutdown: ' + e.message);
    }
}
