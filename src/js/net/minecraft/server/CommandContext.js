import { Buffer } from '../../../../../libraries/buffer.js';
import {
    sendPlayerPositionLook,
    createEntityTeleportPacket,
    sendPlayerListEntry,
    createSpawnPlayerPacket,
    createDestroyEntityPacket,
    sendBlockChange,
    sendTimeUpdate
} from './packets.js';
import { getPlayers, isSpectator, savePlayerData, findPlayerByUsername } from './players.js';
import { getWorldTime, setWorldTime, addWorldChange, getBlockAt as getServerBlockAt } from './world.js';
import { makePacket, writeString } from './protocol.js';
import config from './config.js';

function canSee(viewer, target) {
    if (isSpectator(target)) {
        return isSpectator(viewer);
    }
    return true;
}

// Send a chat message (packet 0x02) to a single player only.
export function sendChatMessageToPlayer(player, message) {
    const chatJson = JSON.stringify({ text: message });
    const chatData = Buffer.alloc(Buffer.byteLength(chatJson) + 6);
    let offset = 0;
    offset += writeString(chatData, chatJson, offset);
    chatData.writeUInt8(0, offset);
    player.ws.send(makePacket(0x02, chatData.subarray(0, offset)));
}

function broadcastTimeUpdate() {
    const time = getWorldTime();
    for (const p of getPlayers().values()) {
        if (p.ws.readyState === 1) {
            sendTimeUpdate(p, time);
        }
    }
}

function broadcastBlockChange(x, y, z, typeId) {
    const blockState = typeId << 4;
    for (const p of getPlayers().values()) {
        if (p.ws.readyState === 1) {
            sendBlockChange(p.ws, x, y, z, blockState);
        }
    }
}

// Snapshot of everything a command could mutate, taken right before it runs.
// syncCommandState() diffs against it and pushes the needed packets.
function snapshotState(player) {
    const healths = new Map();
    for (const [eid, p] of getPlayers()) {
        healths.set(eid, p.health);
    }
    return {
        x: player.x,
        y: player.y,
        z: player.z,
        gamemode: player.gamemode,
        healths
    };
}

// Wrap a raw server player so the client command classes can mutate it through
// the same interface they use on the client (creative/spectator/flying flags,
// setPosition, getBlockPos*, health, inventory.addItem, ...).
function createPlayerAdapter(player) {
    const flags = {
        creative: player.gamemode === 1,
        spectator: player.gamemode === 3,
        flying: !!player.isFlying
    };

    let inventoryChanged = false;

    const inventoryAdapter = {
        addItem(typeId, count = 1) {
            const amount = Math.max(0, parseInt(count) || 0);
            if (amount <= 0) {
                return false;
            }
            const inv = player.inventory || { selectedSlotIndex: 0, itemInCursor: { typeId: 0, count: 0 }, items: [] };
            while (inv.items.length < 36) {
                inv.items.push({ typeId: 0, count: 0 });
            }

            const stackSize = 64;
            let remaining = amount;
            let changed = false;

            // Stack onto existing non-full stacks of the same item first.
            for (let i = 0; i < inv.items.length && remaining > 0; i++) {
                const slot = inv.items[i];
                if (slot && slot.typeId === typeId && slot.count > 0 && slot.count < stackSize) {
                    const add = Math.min(stackSize - slot.count, remaining);
                    slot.count += add;
                    remaining -= add;
                    changed = true;
                }
            }

            // Then fill empty slots.
            for (let i = 0; i < inv.items.length && remaining > 0; i++) {
                const slot = inv.items[i];
                if (!slot || slot.typeId === 0 || slot.count === 0) {
                    const add = Math.min(stackSize, remaining);
                    inv.items[i] = { typeId, count: add };
                    remaining -= add;
                    changed = true;
                }
            }

            player.inventory = inv;
            if (changed) {
                inventoryChanged = true;
            }
            return changed;
        }
    };

    function applyGamemode() {
        if (flags.spectator) {
            player.gamemode = 3;
        } else if (flags.creative) {
            player.gamemode = 1;
        } else {
            player.gamemode = 0;
        }
    }

    const adapter = {
        get username() {
            return player.username;
        },
        get x() {
            return player.x;
        },
        get y() {
            return player.y;
        },
        get z() {
            return player.z;
        },
        get health() {
            return player.health ?? 20;
        },
        set health(value) {
            player.health = value;
        },
        get creative() {
            return flags.creative;
        },
        set creative(value) {
            flags.creative = value;
            applyGamemode();
        },
        get spectator() {
            return flags.spectator;
        },
        set spectator(value) {
            flags.spectator = value;
            applyGamemode();
        },
        get flying() {
            return flags.flying;
        },
        set flying(value) {
            flags.flying = value;
            player.isFlying = value;
        },
        get gamemode() {
            return player.gamemode;
        },
        get inventory() {
            return inventoryAdapter;
        },
        get _inventoryChanged() {
            return inventoryChanged;
        },
        setPosition(x, y, z) {
            player.x = x;
            player.y = y;
            player.z = z;
        },
        getBlockPosX() {
            return Math.trunc(player.x);
        },
        getBlockPosY() {
            return Math.trunc(player.y);
        },
        getBlockPosZ() {
            return Math.trunc(player.z);
        }
    };

    return adapter;
}

// Adapt the server's shared world state (time, seed, block access) to the
// interface the client commands expect from `minecraft.world`.
function createWorldAdapter() {
    return {
        get time() {
            return getWorldTime();
        },
        set time(value) {
            setWorldTime(value);
            broadcastTimeUpdate();
        },
        get seed() {
            return config.seed;
        },
        setBlockAt(x, y, z, typeId) {
            const bx = Math.floor(x);
            const by = Math.floor(y);
            const bz = Math.floor(z);
            addWorldChange(bx, by, bz, typeId);
            broadcastBlockChange(bx, by, bz, typeId);
        },
        getBlockAt(x, y, z) {
            return getServerBlockAt(Math.floor(x), Math.floor(y), Math.floor(z));
        }
    };
}

// Build a "minecraft"-like object for a player so the client command classes
// can run against the server. Everything the commands read/mutate is either a
// getter/setter into server state or a stub for client-only subsystems.
export function createCommandContext(player, commandHandler) {
    const playerAdapter = createPlayerAdapter(player);

    const context = {
        player: playerAdapter,
        world: createWorldAdapter(),
        commandHandler,
        addMessageToChat: (message) => sendChatMessageToPlayer(player, message),
        isSingleplayer: () => false,
        findPlayerByName: (username) => {
            const target = findPlayerByUsername(username);
            if (target) {
                return createPlayerAdapter(target);
            }
            return null;
        },
        broadcastEntitySpawn: (entity) => {
            const msg = JSON.stringify({
                type: 'spawnEntity',
                entityType: entity.type,
                x: entity.x,
                y: entity.y,
                z: entity.z,
                yaw: entity.yaw || 0,
                pitch: entity.pitch || 0
            });
            for (const [eid, p] of getPlayers()) {
                if (p.ws.readyState === 1) {
                    p.ws.send(msg);
                }
            }
        },
        musicManager: {
            switchWhenReady: () => {}
        },
        _player: player,
        _before: snapshotState(player)
    };

    return context;
}

// Broadcast a game mode change to every client, handling player visibility
// (spectators are hidden from non-spectators, and vice versa).
function applyGamemodeChange(player, oldGamemode, gamemode) {
    if (player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({ type: 'gamemode', gamemode, flying: player.isFlying }));
    }

    const players = getPlayers();
    for (const [eid, p] of players) {
        if (p.ws.readyState !== 1) continue;

        const oldVisible = oldGamemode !== 3 || isSpectator(p);
        const newVisible = gamemode !== 3 || isSpectator(p);

        if (p.eid === player.eid) {
            p.ws.send(sendPlayerListEntry([player], 1));
        } else if (newVisible && !oldVisible) {
            p.ws.send(sendPlayerListEntry([player], 0));
            p.ws.send(createSpawnPlayerPacket(player));
        } else if (!newVisible && oldVisible) {
            p.ws.send(createDestroyEntityPacket(player.eid));
            p.ws.send(sendPlayerListEntry([player], 4));
        } else if (newVisible) {
            p.ws.send(sendPlayerListEntry([player], 1));
        }
    }
}

// Diff the player's state against the pre-command snapshot and push any
// changes (position, game mode, health, inventory) out to the clients.
export function syncCommandState(player, context) {
    const before = context._before;
    if (!before) {
        return;
    }

    let changed = false;

    // Teleport: send the position update to the player and broadcast the new
    // position to every other player that can see them.
    if (player.x !== before.x || player.y !== before.y || player.z !== before.z) {
        sendPlayerPositionLook(player);
        const packet = createEntityTeleportPacket(player);
        for (const [eid, p] of getPlayers()) {
            if (eid !== player.eid && p.ws.readyState === 1 && canSee(p, player)) {
                p.ws.send(packet);
            }
        }
        changed = true;
    }

    // Game mode: update the player list and spawn/destroy entities as needed.
    if (player.gamemode !== before.gamemode) {
        applyGamemodeChange(player, before.gamemode, player.gamemode);
        changed = true;
    }

    // Health: a /heal can touch any player, so check everyone (players may
    // have been added or removed since the snapshot).
    for (const [eid, p] of getPlayers()) {
        if (p.ws.readyState === 1 && p.health !== before.healths.get(eid)) {
            p.ws.send(JSON.stringify({ type: 'health', health: p.health }));
            changed = true;
        }
    }

    // Inventory: /give mutates the raw player inventory, so push it back.
    if (context.player._inventoryChanged && player.ws.readyState === 1) {
        player.ws.send(JSON.stringify({ type: 'inventory', inventory: player.inventory }));
        changed = true;
    }

    if (changed && player.username) {
        savePlayerData(player);
    }
}
