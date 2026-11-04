import CommandHandler from '../client/command/CommandHandler.js';
import CommandRegistry from '../client/command/CommandRegistry.js';
import Logger from './logger.js';
import { sendChatMessageToPlayer, createCommandContext, syncCommandState } from './CommandContext.js';
import { getPlayers, isOp, isSuperOp, savePlayerData, loadPlayerData, normalizeInventoryState, findPlayerByUsername } from './players.js';
import { sendResetWorldPacket, sendRespawn, sendServerRules, sendServerMods, sendChunks, sendSpawnPosition, sendPlayerPositionLook, createDisconnectPacket } from './packets.js';
import { banPlayer, unban as unbanPlayer, parseDuration, formatDuration, describeBan } from './bans.js';
import { reloadServerSideMods } from './ServerModLoader.js';
import { initWorld, saveWorld, getCurrentWorldName, getSpawnPosition } from './world.js';
import { cleanupPlayerChunks } from './handlers.js';
import { handleOffGridCommand } from './offgridCommands.js';
import { sendState as sendOffGridState } from './offgrid.js';
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
const OP_ONLY_COMMANDS = new Set([
    'tp', 'gamemode', 'heal', 'give', 'setblock', 'place', 'summon', 'util',
    'offgridrenderer', 'ofr', 'ofrclear'
]);

// Moderation commands act on other players' sessions and on the ban/op lists,
// so they are handled here rather than by the client command classes.
const MODERATION_COMMANDS = new Set(['kick', 'ban', 'tempban', 'unban', 'op', 'deop', 'sop', 'unsop']);

const MODERATION_USAGE = {
    kick: '/kick <player> [reason]',
    ban: '/ban <player> [reason]',
    tempban: '/tempban <player> <time_in_days> [reason]   (30, 4m, 4d, 4w, 4months, 1yr)',
    unban: '/unban <player>',
    op: '/op <player>',
    deop: '/deop <player>',
    sop: '/sop <player>',
    unsop: '/unsop <player>'
};

const VALID_USERNAME = /^[A-Za-z0-9_]{1,32}$/;

// Mods register their commands into CommandRegistry, the same registry the
// client reads. A mod marks a command op-only by setting `opOnly` when it
// registers it, and everything else stays open to any player, like the
// built-in read-only commands.
function isOpOnlyCommand(name) {
    return OP_ONLY_COMMANDS.has(name) || CommandRegistry.isOpOnly(name);
}

function requireOp(player) {
    if (isOp(player)) {
        return true;
    }
    sendChatMessageToPlayer(player, '§cYou do not have permission to use this command!');
    return false;
}

// Moderation (kick/ban/unban, and handing out super op) is reserved for super
// ops, so an ordinary operator cannot ban people or promote themselves.
function requireSuperOp(player) {
    if (isSuperOp(player)) {
        return true;
    }
    sendChatMessageToPlayer(player, '§cOnly super operators can use this command!');
    return false;
}

function handleCommand(player, command) {
    if (typeof command !== 'string' || command.length === 0) {
        return;
    }

    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase().replace(/^\/+/, '');
    const args = parts.slice(1);

    if (MODERATION_COMMANDS.has(cmd)) {
        handleModerationCommand(player, cmd, args);
        return;
    }

    // Server-specific commands that have no client-side equivalent.
    if (cmd === 'server' || cmd === 'world') {
        handleServer(player, args);
        return;
    }

    // Off-grid state is shared and owned by the server, so these commands must
    // run here even though the client also registers command classes for
    // offline/local use.
    if (cmd === 'offgridrenderer' || cmd === 'ofr' || cmd === 'ofrclear') {
        handleOffGridCommand(player, cmd, args);
        return;
    }

    // /time (no args) only shows the time; setting/adding needs op.
    if (cmd === 'time' && (args[0] === 'set' || args[0] === 'add') && !requireOp(player)) {
        return;
    }
    if (isOpOnlyCommand(cmd) && !requireOp(player)) {
        return;
    }

    // A mod command only works if the mod is installed here too. Say so
    // instead of the bare "unknown command" a player would get otherwise.
    if (!commandHandler.hasCommand(cmd)) {
        if (player.mods && player.mods.length > 0) {
            const names = player.mods.map(mod => mod.name).join(', ');
            sendChatMessageToPlayer(player, `§cUnknown command! Type "/help" for help.`);
            return;
        }
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

function moderationUsage(player, cmd) {
    sendChatMessageToPlayer(player, `§cUsage: ${MODERATION_USAGE[cmd]}`);
}

function readReason(args) {
    return args.join(' ').trim().replace(/^["']|["']$/g, '').slice(0, 256);
}

// Send the disconnect reason, then drop the socket. The socket's own close
// handler saves the player's data and takes them out of the player list.
function disconnectPlayer(target, message) {
    if (!target || !target.ws) {
        return false;
    }

    try {
        if (target.ws.readyState === 1) {
            target.ws.send(createDisconnectPacket(message));
        }
        target.ws.close();
        return true;
    } catch (e) {
        log.warn('Server', `Could not disconnect ${target.username}: ${e.message}`);
        return false;
    }
}

function handleModerationCommand(player, cmd, args) {
    // /op and /deop need operator rights; everything else that acts on other
    // players' sessions needs a super op.
    if (cmd === 'op' || cmd === 'deop') {
        if (!requireOp(player)) {
            return;
        }
    } else if (!requireSuperOp(player)) {
        return;
    }

    const name = args[0];
    if (!name) {
        moderationUsage(player, cmd);
        return;
    }

    if (!VALID_USERNAME.test(name)) {
        sendChatMessageToPlayer(player, '§cPlayer names may only contain letters, numbers and underscores.');
        return;
    }

    if (cmd === 'kick') {
        handleKick(player, name, args.slice(1));
    } else if (cmd === 'ban' || cmd === 'tempban') {
        handleBan(player, cmd, name, args.slice(1));
    } else if (cmd === 'unban') {
        handleUnban(player, name);
    } else if (cmd === 'sop' || cmd === 'unsop') {
        handleSuperOp(player, cmd, name);
    } else {
        handleOp(player, cmd, name);
    }
}

function handleKick(player, name, reasonArgs) {
    const target = findPlayerByUsername(name);
    if (!target) {
        sendChatMessageToPlayer(player, `§cNo player called "${name}" is online.`);
        return;
    }

    // The kicked player gets the same three-line screen a ban shows, with the
    // reason on its own line.
    const reason = readReason(reasonArgs) || 'No reason given';
    const message = [
        '§cYou have been kicked from this server!',
        '§7Reason: §f' + reason,
        '§oPlease stop your behaviour elsewhere a ban may take place.'
    ].join('\n');

    log.info('Server', `${player.username} kicked ${target.username}${reason ? ' (' + reason + ')' : ''}`);
    disconnectPlayer(target, message);
    sendChatMessageToPlayer(player, `§eKicked §f${target.username}§e${reason ? '§7: ' + reason : '.'}`);
}

function handleBan(player, cmd, name, rest) {
    // A super op should not be able to remove themselves - with /ban, the only
    // way back in is editing the ban file by hand. Someone else has to do it.
    if (String(player.username || '').toLowerCase() === name.toLowerCase()) {
        sendChatMessageToPlayer(player, '§cYou cannot ban yourself.');
        return;
    }

    let expiresIn = null;
    let reasonArgs = rest;

    if (cmd === 'tempban') {
        const durationArg = rest[0];
        if (!durationArg) {
            moderationUsage(player, cmd);
            return;
        }

        expiresIn = parseDuration(durationArg);
        if (!expiresIn) {
            sendChatMessageToPlayer(player, `§c"${durationArg}" is not a valid time. Try 30, 4m, 4d, 4w, 4months or 1yr.`);
            return;
        }
        reasonArgs = rest.slice(1);
    }

    const reason = readReason(reasonArgs);
    const entry = banPlayer(name, { reason, by: player.username, expires: expiresIn });
    if (!entry) {
        sendChatMessageToPlayer(player, `§cCould not ban "${name}".`);
        return;
    }

    // Someone can be banned while online: drop them with the ban reason so
    // they see why, instead of just losing the connection.
    const target = findPlayerByUsername(name);
    if (target) {
        disconnectPlayer(target, describeBan(entry));
    }

    const length = entry.expires
        ? 'for ' + formatDuration(entry.expires - Date.now())
        : 'permanently';
    log.info('Server', `${player.username} banned ${name} ${length}${reason ? ' (' + reason + ')' : ''}`);
    sendChatMessageToPlayer(player, `§eBanned §o${entry.name || name}§e ${length}${reason ? '§7: ' + reason : '.'}`);
}

function handleUnban(player, name) {
    const removed = unbanPlayer(name);
    if (!removed) {
        sendChatMessageToPlayer(player, `§c${name} is not banned.`);
        return;
    }

    log.info('Server', `${player.username} unbanned ${removed.name || name}`);
    sendChatMessageToPlayer(player, `§eUnbanned §o${removed.name || name}§e.`);
}

// Replace any casing-insensitive match of `name` in `list`.
function withoutName(list, name) {
    const matches = (entry) => String(entry).toLowerCase() === name.toLowerCase();
    return list.filter((entry) => !matches(entry));
}

function handleSuperOp(player, cmd, name) {
    if (config.isEnvSuperOp(name)) {
        sendChatMessageToPlayer(player, cmd === 'sop'
            ? `§e${name} is already a super operator (set by the SUPER_OPS environment variable).`
            : `§c${name} is a super operator set by the SUPER_OPS environment variable and cannot be unsop'd here.`);
        return;
    }

    const list = Array.isArray(config.super_op_player_list) ? [...config.super_op_player_list] : [];
    const matches = (entry) => String(entry).toLowerCase() === name.toLowerCase();
    const existing = list.find(matches);
    const target = findPlayerByUsername(existing || name);
    const label = (target && target.username) || existing || name;
    const grant = cmd === 'sop';

    const next = withoutName(list, name);
    if (grant) {
        next.push(existing || name);
    }
    config.super_op_player_list = next;

    try {
        config.writePlayerLists();
    } catch (e) {
        log.error('Server', `Could not save the super op list: ${e.message}`);
        sendChatMessageToPlayer(player, `§cCould not save the super op list: ${e.message}`);
        return;
    }

    if (grant) {
        sendChatMessageToPlayer(player, `§eGave super operator permissions to §f${label}§e.`);
        if (target && target.eid !== player.eid) {
            sendChatMessageToPlayer(target, '§eYou are now a super operator.');
        }
    } else {
        sendChatMessageToPlayer(player, `§eRemoved super operator permissions from §f${label}§e.`);
        if (target && target.eid !== player.eid) {
            sendChatMessageToPlayer(target, '§cYou are no longer a super operator.');
        }
    }

    log.info('Server', `${player.username} ${grant ? 'gave' : 'removed'} super op ${grant ? 'to' : 'from'} ${label}`);
}

function handleOp(player, cmd, name) {
    const opList = Array.isArray(config.op_player_list) ? [...config.op_player_list] : [];
    const deopList = Array.isArray(config.deop_player_list) ? [...config.deop_player_list] : [];
    const matches = (entry) => String(entry).toLowerCase() === name.toLowerCase();

    // A super op outranks /deop; demote them with /unsop first.
    const superOps = Array.isArray(config.super_op_player_list) ? config.super_op_player_list : [];
    if (cmd === 'deop' && (superOps.some(matches) || config.isEnvSuperOp(name))) {
        sendChatMessageToPlayer(player, `§c${name} is a super operator - use /unsop first.`);
        return;
    }

    const existing = opList.find(matches);
    const label = findPlayerByUsername(existing || name)?.username || existing || name;

    if (cmd === 'op') {
        if (!existing) {
            opList.push(name);
        }
        for (let i = deopList.length - 1; i >= 0; i--) {
            if (matches(deopList[i])) {
                deopList.splice(i, 1);
            }
        }
    } else {
        for (let i = opList.length - 1; i >= 0; i--) {
            if (matches(opList[i])) {
                opList.splice(i, 1);
            }
        }
        // The deop list is what makes /deop stick on a server whose
        // serverconfig has default_op=true.
        if (!deopList.some(matches)) {
            deopList.push(name);
        }
    }

    config.op_player_list = opList;
    config.deop_player_list = deopList;

    try {
        config.writePlayerLists();
    } catch (e) {
        log.error('Server', `Could not save the op list: ${e.message}`);
        sendChatMessageToPlayer(player, `§cCould not save the op list: ${e.message}`);
        return;
    }

    const target = findPlayerByUsername(name);
    if (cmd === 'op') {
        sendChatMessageToPlayer(player, `§eGave operator permissions to §f${label}§e.`);
        if (target && target.eid !== player.eid) {
            sendChatMessageToPlayer(target, '§eYou are now an operator.');
        }
    } else {
        sendChatMessageToPlayer(player, `§eRemoved operator permissions from §f${label}§e.`);
        if (target && target.eid !== player.eid) {
            sendChatMessageToPlayer(target, '§cYou are no longer an operator.');
        }
    }

    log.info('Server', `${player.username} ${cmd === 'op' ? 'opped' : 'deopped'} ${label}`);
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

    // Swap the server-side mod set before the new world is read, so block ids
    // from the target server's mods resolve while its chunks are loaded.
    reloadServerSideMods();

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

        // The target server may have different gameplay rules and mods.
        sendServerRules(p);
        sendServerMods(p);

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

        // The new world has its own off-grid state (loaded by initWorld).
        sendOffGridState(p);
    }
}

export {
    handleCommand
};
