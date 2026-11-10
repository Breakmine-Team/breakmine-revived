#!/usr/bin/env node
/*
 * QuickJSON server - a deliberately tiny JsonMultiplayer server.
 *
 * Supports only: breaking and placing blocks, chat, and seeing other players.
 * It keeps no world file, no accounts and no inventory. The flat world is
 * described with the QuickJSON "terrain" message so the client generates
 * chunks locally instead of downloading them; block edits live in memory until
 * the process stops.
 *
 *   node quickjson-server.js [port]     (default 25565)
 *
 * Then in the client: Play Multiplayer -> Direct, address "localhost",
 * Protocol: QuickJSON.
 */

const { WebSocketServer } = require("ws");

const PORT = Number(process.argv[2] || process.env.PORT || 25565);
const VIEW_DISTANCE = 4;                     // chunks the client generates around itself
const MAX_BUILD_Y = 15;                      // terrain only fills the bottom chunk section
const TERRAIN_LAYERS = [                     // applied top to bottom by baseBlockId
    { from: 0, to: 0, block: 7 },            // bedrock
    { from: 1, to: 7, block: 1 },            // stone
    { from: 8, to: 8, block: 3 },            // dirt
    { from: 9, to: 9, block: 2 }             // grass
];
const SPAWN = { x: 0.5, y: 10, z: 0.5 };     // standing on the grass at y = 9
const JOIN_TIME = 6000;
const KEEP_ALIVE_MS = 15000;

// Clicked face -> offset of the block that gets placed.
const FACES = [
    [0, -1, 0],  // 0 bottom
    [0, 1, 0],   // 1 top
    [0, 0, -1],  // 2 north
    [0, 0, 1],   // 3 south
    [-1, 0, 0],  // 4 west
    [1, 0, 0]    // 5 east
];

const players = new Map();   // ws -> player
const edits = new Map();     // "x,y,z" -> block state (id << 4 | metadata)
let nextEid = 2;
let nextKeepAlive = 1;

function baseBlockId(y) {
    for (let i = TERRAIN_LAYERS.length - 1; i >= 0; i--) {
        const layer = TERRAIN_LAYERS[i];
        if (y >= layer.from && y <= layer.to) return layer.block;
    }
    return 0;                // air
}

function blockStateAt(x, y, z) {
    if (!Number.isFinite(y) || y < 0 || y > 255) return 0;
    const edited = edits.get(x + "," + y + "," + z);
    return edited === undefined ? baseBlockId(y) << 4 : edited;
}

function send(ws, message) {
    if (ws.readyState === 1) {
        ws.send(JSON.stringify(message));
    }
}

function broadcast(message) {
    for (const player of players.values()) {
        if (player.alive) send(player.ws, message);
    }
}

function broadcastOthers(from, message) {
    for (const player of players.values()) {
        if (player.alive && player !== from) send(player.ws, message);
    }
}

function uuidFor(username) {
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
    }
    return hash.toString(16).padStart(8, "0") + "-0000-4000-8000-000000000000";
}

function spawnMessage(player) {
    return {
        type: "spawnPlayer",
        eid: player.eid,
        uuid: player.uuid,
        username: player.username,
        x: player.x,
        y: player.y,
        z: player.z,
        yaw: player.yaw,
        pitch: player.pitch
    };
}

function join(player) {
    player.alive = true;

    send(player.ws, { type: "loginSuccess", uuid: player.uuid, username: player.username });
    send(player.ws, {
        type: "joinGame",
        eid: player.eid,
        gamemode: 1,
        dimension: 0,
        difficulty: 1,
        maxPlayers: 20,
        worldType: "default"
    });
    send(player.ws, {
        type: "terrain",
        generator: "flat",
        viewDistance: VIEW_DISTANCE,
        layers: TERRAIN_LAYERS
    });
    send(player.ws, { type: "spawnPosition", x: 0, y: SPAWN.y, z: 0 });
    send(player.ws, { type: "time", time: JOIN_TIME });
    send(player.ws, {
        type: "position",
        x: SPAWN.x,
        y: SPAWN.y,
        z: SPAWN.z,
        yaw: 0,
        pitch: 0
    });

    for (const other of players.values()) {
        if (!other.alive || other === player) continue;
        send(player.ws, spawnMessage(other));
        send(other.ws, spawnMessage(player));
    }

    broadcast({ type: "chat", text: "\u00a7e" + player.username + " joined the game" });
    console.log("[QuickJSON] " + player.username + " joined (eid " + player.eid + ")");
}

function leave(player) {
    if (!player.alive) return;

    player.alive = false;
    broadcastOthers(player, { type: "destroyEntities", eids: [player.eid] });
    broadcast({ type: "chat", text: "\u00a7e" + player.username + " left the game" });
    console.log("[QuickJSON] " + player.username + " left");
}

function handleMessage(player, raw) {
    let message;
    try {
        message = JSON.parse(raw);
    } catch (error) {
        return;
    }

    if (!message || typeof message !== "object") return;

    switch (message.type) {
        case "handshake":
            return;

        case "login": {
            if (player.alive) return;

            const requested = String(message.username || "").trim();
            player.username = /^[A-Za-z0-9_]{1,16}$/.test(requested) ? requested : "Player" + player.eid;
            player.uuid = uuidFor(player.username);
            join(player);
            return;
        }

        case "move": {
            if (!player.alive) return;

            for (const axis of ["x", "y", "z", "yaw", "pitch"]) {
                const value = Number(message[axis]);
                if (Number.isFinite(value) && Math.abs(value) <= 30000000) {
                    player[axis] = value;
                }
            }

            broadcastOthers(player, {
                type: "entityTeleport",
                eid: player.eid,
                x: player.x,
                y: player.y,
                z: player.z,
                yaw: player.yaw,
                pitch: player.pitch,
                onGround: message.onGround === true
            });
            return;
        }

        case "chat": {
            if (!player.alive) return;

            const text = String(message.message || "").replace(/[\r\n]/g, " ").trim().slice(0, 200);
            if (text.length === 0) return;

            broadcast({ type: "chat", text: "<" + player.username + "> " + text });
            return;
        }

        case "dig": {
            if (!player.alive) return;
            if (Number(message.status) !== 2) return; // only a finished break changes blocks

            const x = Math.floor(Number(message.x));
            const y = Math.floor(Number(message.y));
            const z = Math.floor(Number(message.z));

            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
            if (y < 0 || y > MAX_BUILD_Y) return;
            if (blockStateAt(x, y, z) === 0) return;

            edits.set(x + "," + y + "," + z, 0);
            broadcast({ type: "blockChange", x: x, y: y, z: z, blockState: 0 });
            return;
        }

        case "placeBlock": {
            if (!player.alive) return;

            const face = Number(message.face);
            const clickedX = Math.floor(Number(message.x));
            const clickedY = Math.floor(Number(message.y));
            const clickedZ = Math.floor(Number(message.z));
            const blockId = Math.floor(Number(message.blockId));
            const rawMetadata = Math.floor(Number(message.metadata));

            if (!FACES[face]) return;
            if (!Number.isFinite(clickedX) || !Number.isFinite(clickedY) || !Number.isFinite(clickedZ)) return;
            if (!Number.isFinite(blockId) || blockId < 1 || blockId > 255) return;

            const metadata = Number.isFinite(rawMetadata) && rawMetadata >= 0
                ? Math.min(rawMetadata, 15)
                : 0;

            const [dx, dy, dz] = FACES[face];
            const x = clickedX + dx;
            const y = clickedY + dy;
            const z = clickedZ + dz;

            if (y < 0 || y > MAX_BUILD_Y) {
                // Out of the sent chunk section: undo the client's prediction.
                send(player.ws, { type: "blockChange", x: x, y: y, z: z, blockState: 0 });
                return;
            }

            const existing = blockStateAt(x, y, z);
            if (existing !== 0) {
                // Occupied: tell the client what is really there.
                send(player.ws, { type: "blockChange", x: x, y: y, z: z, blockState: existing });
                return;
            }

            const state = (blockId << 4) | metadata;
            edits.set(x + "," + y + "," + z, state);
            broadcast({ type: "blockChange", x: x, y: y, z: z, blockState: state });
            return;
        }

        default:
            return;
    }
}

const server = new WebSocketServer({ port: PORT });

server.on("connection", (ws) => {
    const player = {
        ws: ws,
        eid: nextEid++,
        username: null,
        uuid: null,
        alive: false,
        x: SPAWN.x,
        y: SPAWN.y,
        z: SPAWN.z,
        yaw: 0,
        pitch: 0
    };

    players.set(ws, player);

    ws.on("message", (data, isBinary) => {
        if (isBinary) return;
        handleMessage(player, data.toString("utf8"));
    });

    ws.on("close", () => {
        leave(player);
        players.delete(ws);
    });

    ws.on("error", () => ws.close());
});

setInterval(() => {
    const id = nextKeepAlive++;
    for (const player of players.values()) {
        if (player.alive) send(player.ws, { type: "keepAlive", id: id });
    }
}, KEEP_ALIVE_MS);

server.on("listening", () => {
    console.log("[QuickJSON] listening on port " + PORT);
    console.log("[QuickJSON] connect with the QuickJSON protocol to localhost:" + PORT);
});

process.on("SIGINT", () => {
    for (const player of players.values()) {
        send(player.ws, { type: "disconnect", reason: "Server closed" });
    }
    server.close(() => process.exit(0));
});
