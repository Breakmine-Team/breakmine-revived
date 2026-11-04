import CommandHandler from '../client/command/CommandHandler.js';
import Logger from './logger.js';
import { sendChatMessageToPlayer, createCommandContext, syncCommandState } from './CommandContext.js';
import { getPlayers, isOp, savePlayerData, loadPlayerData, normalizeInventoryState } from './players.js';
import { sendResetWorldPacket, sendRespawn, sendChunks, sendSpawnPosition, sendPlayerPositionLook } from './packets.js';
import { initWorld, saveWorld, getCurrentWorldName, getSpawnPosition } from './world.js';
import { cleanupPlayerChunks } from './handlers.js';
import config from './config.js';

const log = Logger;

// All command registration/dispatch comes from the client command system:
// CommandHandler wires up the same Command classes the singleplayer client
// uses (help, time, tp, gamemode, setblock, place, heal, give, util). Each
// command runs against a per-player CommandContext adapter that maps the
// client-facing `minecraft` interface onto the server's world/player state.
const commandHandler = new CommandHandler(null);

// Commands that mutate shared state or affect other players. Non-ops get a
// permission error instead of the command executing.
const OP_ONLY_COMMANDS = new Set(['tp', 'gamemode', 'heal', 'give', 'setblock', 'place', 'summon', 'util']);

function requireOp(player) {
    if (isOp(player)) {
        return true;
    }
    sendChatMessageToPlayer(player, '§cYou do not have permission to use this command.');
    return false;
}

function handleCommand(player, command) {
    if (typeof command !== 'string' || command.length === 0) {
        return;
    }

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\/+/, '');
    const args = parts.slice(1);

    // Server-specific commands that have no client-side equivalent.
    if (cmd === 'server' || cmd === 'world') {
        handleServer(player, args);
        return;
    }

    // /time (no args) only shows the time; setting/adding needs op.
    if (cmd === 'time' && (args[0] === 'set' || args[0] === 'add') && !requireOp(player)) {
        return;
    }
    if (OP_ONLY_COMMANDS.has(cmd) && !requireOp(player)) {
        return;
    }

    const context = createCommandContext(player, commandHandler);
    commandHandler.minecraft = context;
    try {
        commandHandler.handleCommand(cmd, args);
    } catch (e) {
        log.error('Server', `Command /${cmd} failed: ${e.message}`);
        sendChatMessageToPlayer(player, `§cCommand failed: ${e.message}`);
    }

    syncCommandState(player, context);
}

function handleServer(player, args) {
    if (args.length === 0) {
        sendChatMessageToPlayer(player, `§6Current server: §e${getCurrentWorldName()}`);
        return;
    }

    const subCommand = args[0].toLowerCase();

    if (subCommand === 'list') {
        const servers = config.listServers();
        sendChatMessageToPlayer(player, '§6Available servers:');
        servers.forEach(server => {
            const isCurrent = server === getCurrentWorldName() ? ' §7(current)' : '';
            sendChatMessageToPlayer(player, `§e- ${server}${isCurrent}`);
        });
        return;
    }

    const serverName = subCommand;

    if (!requireOp(player)) {
        return;
    }

    if (serverName === getCurrentWorldName()) {
        sendChatMessageToPlayer(player, `§cYou are already in server "${serverName}"`);
        return;
    }

    // Persist each player's state on the server they are leaving before
    // switching, so their position/inventory stay intact per server.
    const players = getPlayers();
    for (const p of players.values()) {
        if (p.username) {
            savePlayerData(p);
        }
    }

    // Save current server
    saveWorld();

    // Load the target server's own config (world type, seed, gamemode, ...).
    // If it has no serverconfig.conf the current settings are kept.
    config.reload(serverName);

    // Load new server
    initWorld(serverName);

    const spawn = getSpawnPosition();

    for (const p of players.values()) {
        // Apply the player's saved state for the new server, or fall back to
        // the spawn point if they have never been there.
        const playerData = loadPlayerData(p.username);
        if (playerData) {
            p.x = typeof playerData.x === 'number' ? playerData.x : spawn.x;
            p.y = typeof playerData.y === 'number' ? playerData.y : spawn.y;
            p.z = typeof playerData.z === 'number' ? playerData.z : spawn.z;
            p.yaw = typeof playerData.yaw === 'number' ? playerData.yaw : 0;
            p.pitch = typeof playerData.pitch === 'number' ? playerData.pitch : 0;
            p.isFlying = playerData.isFlying || false;
            p.gamemode = typeof playerData.gamemode === 'number' ? playerData.gamemode : p.gamemode;
            p.health = typeof playerData.health === 'number' && playerData.health > 0 ? playerData.health : 20;
            p.inventory = normalizeInventoryState(playerData.inventory);
        } else {
            p.x = spawn.x;
            p.y = spawn.y;
            p.z = spawn.z;
            p.yaw = 0;
            p.pitch = 0;
            p.isFlying = false;
            p.health = 20;
            p.inventory = normalizeInventoryState([]);
        }

        // Forget which chunks were already sent so every chunk around the
        // player's (possibly far away) saved position is streamed fresh.
        cleanupPlayerChunks(p.eid);

        // Send reset world packet to clear all chunks
        sendResetWorldPacket(p);

        // Send respawn packet (dimension 0 = overworld)
        sendRespawn(p, 0);

        // Authoritative restore so the client targets the saved position while
        // it streams in the new server's terrain.
        if (p.ws.readyState === 1) {
            p.ws.send(JSON.stringify({
                type: 'playerState',
                x: p.x,
                y: p.y,
                z: p.z,
                yaw: p.yaw,
                pitch: p.pitch,
                health: p.health,
                gamemode: p.gamemode,
                flying: !!p.isFlying
            }));
            p.ws.send(JSON.stringify({ type: 'inventory', inventory: p.inventory }));
            p.ws.send(JSON.stringify({ type: 'health', health: p.health }));
            p.ws.send(JSON.stringify({ type: 'gamemode', gamemode: p.gamemode, flying: !!p.isFlying }));
        }

        // Send chunks from the new server
        sendChunks(p);

        // Send spawn position
        sendSpawnPosition(p);

        // Send position update
        sendPlayerPositionLook(p);
    }
}

export {
    handleCommand
};
