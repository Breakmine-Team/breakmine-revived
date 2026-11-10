import ProtocolState from "./ProtocolState.js";
import HandshakePacket from "./packet/handshake/client/HandshakePacket.js";
import LoginStartPacket from "./packet/login/client/LoginStartPacket.js";
import ClientKeepAlivePacket from "./packet/play/client/ClientKeepAlivePacket.js";
import ClientChatPacket from "./packet/play/client/ClientChatPacket.js";
import ClientPlayerBlockPlacementPacket from "./packet/play/client/ClientPlayerBlockPlacementPacket.js";
import ClientPlayerDiggingPacket from "./packet/play/client/ClientPlayerDiggingPacket.js";
import ClientPlayerMovementPacket from "./packet/play/client/ClientPlayerMovementPacket.js";
import LoginSuccessPacket from "./packet/login/server/LoginSuccessPacket.js";
import ServerJoinGamePacket from "./packet/play/server/ServerJoinGamePacket.js";
import ServerChatPacket from "./packet/play/server/ServerChatPacket.js";
import ServerTimeUpdatePacket from "./packet/play/server/ServerTimeUpdatePacket.js";
import ServerSpawnPositionPacket from "./packet/play/server/ServerSpawnPositionPacket.js";
import ServerPlayerPositionRotationPacket from "./packet/play/server/ServerPlayerPositionRotationPacket.js";
import ServerChunkDataPacket from "./packet/play/server/ServerChunkDataPacket.js";
import ServerBlockChangePacket from "./packet/play/server/ServerBlockChangePacket.js";
import ServerSpawnPlayerPacket from "./packet/play/server/ServerSpawnPlayerPacket.js";
import ServerEntityTeleportPacket from "./packet/play/server/ServerEntityTeleportPacket.js";
import ServerDestroyEntitiesPacket from "./packet/play/server/ServerDestroyEntitiesPacket.js";
import ServerDisconnectPacket from "./packet/play/server/ServerDisconnectPacket.js";
import UUID from "../../util/UUID.js";
import GameProfile from "../../util/GameProfile.js";
import BlockPosition from "../../util/BlockPosition.js";
import { parseTerrainDescriptor, queueTerrain, clearQueuedTerrain } from "../world/generator/JsonTerrain.js";

/*
 * JsonMultiplayer (shown in the UI as "QuickJSON")
 *
 * A deliberately small alternative to the binary Minecraft protocol. Every frame
 * in both directions is a single JSON object with a "type" field, so a server
 * only needs a WebSocket library and a JSON parser. No length prefixes, no
 * compression and no encryption.
 *
 * Client -> server
 *   {"type":"handshake","version":47,"nextState":"login","mods":[]}
 *   {"type":"login","username":"Steve"}
 *   {"type":"keepAlive","id":1}
 *   {"type":"chat","message":"/help"}
 *   {"type":"move","x":0,"y":64,"z":0,"yaw":0,"pitch":0,"onGround":true}
 *        (the position and rotation fields are only present when they changed)
 *   {"type":"placeBlock","x":0,"y":9,"z":0,"face":1,"blockId":4,"metadata":-1}
 *        (x/y/z is the clicked block; face 0..5, or -1/255 for "use item")
 *   {"type":"dig","x":0,"y":9,"z":0,"face":1,"status":2}
 *        (status 2 = block broken; 0 = started, 1 = cancelled)
 *
 * Server -> client
 *   {"type":"loginSuccess","uuid":"00000000-0000-0000-0000-000000000002","username":"Steve"}
 *   {"type":"joinGame","eid":2,"gamemode":1,"dimension":0,"difficulty":0,"maxPlayers":20,"worldType":"default"}
 *   {"type":"spawnPosition","x":0,"y":64,"z":0}
 *   {"type":"position","x":0,"y":64,"z":0,"yaw":0,"pitch":0}
 *   {"type":"chunk","x":0,"z":0,"mask":65535,"data":"<base64 chunk data>"}
 *   {"type":"terrain","generator":"flat","viewDistance":4,"layers":[{"from":0,"to":0,"block":7}, ...]}
 *        (optional: the client generates chunks itself instead of the server sending them)
 *   {"type":"time","time":0}
 *   {"type":"chat","text":"Hello"}
 *   {"type":"blockChange","x":0,"y":64,"z":0,"blockState":16}
 *   {"type":"spawnPlayer","eid":3,"uuid":"...","x":0,"y":64,"z":0,"yaw":0,"pitch":0,"username":"Alex"}
 *   {"type":"entityTeleport","eid":3,"x":0,"y":64,"z":0,"yaw":0,"pitch":0,"onGround":true}
 *   {"type":"destroyEntities","eids":[3]}
 *   {"type":"keepAlive","id":1}
 *   {"type":"disconnect","reason":"Server closed"}
 *
 * Extra JSON messages the binary protocol already sends (serverRules,
 * serverMods, inventory, health, gamemode, playerState, cape:state, ...) are
 * handled by NetworkManager._onJsonMessage and work unchanged.
 */

const DEFAULT_UUID = "00000000-0000-0000-0000-000000000002";

function toFixedPoint(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.floor(number * 32) : 0;
}

function toAngle(value) {
    const number = Number(value) || 0;
    return Math.floor((((number % 360) + 360) % 360) * 256 / 360) & 0xFF;
}

function fromBase64(value) {
    if (typeof value !== "string" || value.length === 0) {
        return new Uint8Array(0);
    }

    let binary;
    if (typeof atob === "function") {
        binary = atob(value);
    } else if (typeof Buffer !== "undefined") {
        binary = Buffer.from(value, "base64").toString("binary");
    } else {
        return new Uint8Array(0);
    }

    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i) & 0xFF;
    }
    return bytes;
}

function nextStateName(state) {
    if (state === ProtocolState.LOGIN) return "login";
    if (state === ProtocolState.STATUS) return "status";
    return "handshake";
}

function parseUUID(value) {
    try {
        return UUID.fromString(typeof value === "string" && value.length > 0 ? value : DEFAULT_UUID);
    } catch (error) {
        return UUID.fromString(DEFAULT_UUID);
    }
}

function isPlaying(networkManager) {
    return networkManager.getState() === ProtocolState.PLAY;
}

const JsonMultiplayer = {

    ID: "jsonmultiplayer",
    NAME: "QuickJSON",

    // Packet -> JSON object, or null when the packet has no JSON form.
    encode(packet) {
        if (packet instanceof HandshakePacket) {
            return {
                type: "handshake",
                version: packet.version,
                nextState: nextStateName(packet.nextState),
                mods: Array.isArray(packet.mods)
                    ? packet.mods.map(mod => ({ id: mod.id || "", name: mod.name || "", version: mod.version || "" }))
                    : []
            };
        }

        if (packet instanceof LoginStartPacket) {
            return { type: "login", username: packet.username };
        }

        if (packet instanceof ClientKeepAlivePacket) {
            return { type: "keepAlive", id: packet.id };
        }

        if (packet instanceof ClientChatPacket) {
            return { type: "chat", message: packet.message };
        }

        if (packet instanceof ClientPlayerBlockPlacementPacket) {
            const position = packet.blockPosition;
            return {
                type: "placeBlock",
                x: position.getX(),
                y: position.getY(),
                z: position.getZ(),
                face: packet.direction,
                blockId: packet.heldItem ? packet.heldItem.id : -1,
                metadata: packet.metadata
            };
        }

        if (packet instanceof ClientPlayerDiggingPacket) {
            const position = packet.blockPosition;
            return {
                type: "dig",
                x: position.getX(),
                y: position.getY(),
                z: position.getZ(),
                face: packet.face,
                status: packet.status
            };
        }

        if (packet instanceof ClientPlayerMovementPacket) {
            const message = { type: "move", onGround: packet.onGround === true };
            if (packet.position === true) {
                message.x = packet.x;
                message.y = packet.y;
                message.z = packet.z;
            }
            if (packet.rotation === true) {
                message.yaw = packet.yaw;
                message.pitch = packet.pitch;
            }
            return message;
        }

        return null;
    },

    // JSON message -> existing client packet handlers. Returns false when the
    // message is not part of the JsonMultiplayer protocol.
    handleMessage(rawMessage, networkManager) {
        let message;
        try {
            message = typeof rawMessage === "string" ? JSON.parse(rawMessage) : rawMessage;
        } catch (error) {
            return false;
        }

        if (!message || typeof message !== "object" || typeof message.type !== "string") {
            return false;
        }

        const handler = networkManager.networkHandler;
        if (!handler) {
            return false;
        }

        try {
            switch (message.type) {
                case "loginSuccess": {
                    const packet = new LoginSuccessPacket();
                    packet.profile = new GameProfile(parseUUID(message.uuid), String(message.username || "Player"));
                    packet.handle(handler);
                    return true;
                }

                case "disconnect": {
                    const reason = String(message.reason || "Disconnected from server");
                    if (isPlaying(networkManager)) {
                        const packet = new ServerDisconnectPacket();
                        packet.reason = reason;
                        packet.handle(handler);
                    } else if (typeof handler.handleLoginDisconnect === "function") {
                        handler.handleLoginDisconnect({ message: reason });
                    }
                    return true;
                }

                case "keepAlive": {
                    networkManager.sendJson({ type: "keepAlive", id: message.id ?? 0 });
                    return true;
                }
            }

            if (!isPlaying(networkManager)) {
                return false;
            }

            switch (message.type) {
                case "joinGame": {
                    clearQueuedTerrain();

                    const packet = new ServerJoinGamePacket();
                    packet.entityId = message.eid ?? message.entityId ?? 0;
                    packet.gameType = message.gamemode ?? 0;
                    packet.dimension = message.dimension ?? 0;
                    packet.difficulty = message.difficulty ?? 0;
                    packet.maxPlayers = message.maxPlayers ?? 0;
                    packet.worldType = message.worldType ?? "default";
                    packet.handle(handler);
                    return true;
                }

                case "terrain": {
                    const descriptor = parseTerrainDescriptor(message);
                    if (descriptor !== null) {
                        const world = networkManager.minecraft ? networkManager.minecraft.world : null;
                        queueTerrain(world, descriptor);
                    }
                    return true;
                }

                case "spawnPosition": {
                    const packet = new ServerSpawnPositionPacket();
                    packet.spawnX = Math.floor(Number(message.x) || 0);
                    packet.spawnY = Math.floor(Number(message.y) || 0);
                    packet.spawnZ = Math.floor(Number(message.z) || 0);
                    packet.handle(handler);
                    return true;
                }

                case "position": {
                    const packet = new ServerPlayerPositionRotationPacket();
                    packet.x = Number(message.x) || 0;
                    packet.y = Number(message.y) || 0;
                    packet.z = Number(message.z) || 0;
                    packet.yaw = Number(message.yaw) || 0;
                    packet.pitch = Number(message.pitch) || 0;
                    packet.flags = 0;
                    packet.handle(handler);
                    return true;
                }

                case "chunk": {
                    const packet = new ServerChunkDataPacket(
                        Math.floor(Number(message.x) || 0),
                        Math.floor(Number(message.z) || 0),
                        message.mask ?? 0xFFFF,
                        fromBase64(message.data)
                    );
                    packet.fullChunk = message.fullChunk !== false;
                    packet.handle(handler);
                    return true;
                }

                case "blockChange": {
                    const packet = new ServerBlockChangePacket();
                    packet.blockPosition = new BlockPosition(message.x, message.y, message.z);
                    packet.blockState = message.blockState ?? 0;
                    packet.handle(handler);
                    return true;
                }

                case "spawnPlayer": {
                    const packet = new ServerSpawnPlayerPacket();
                    packet.entityId = message.eid ?? 0;
                    packet.uuid = parseUUID(message.uuid);
                    packet.x = toFixedPoint(message.x);
                    packet.y = toFixedPoint(message.y);
                    packet.z = toFixedPoint(message.z);
                    packet.yaw = toAngle(message.yaw);
                    packet.pitch = toAngle(message.pitch);
                    packet.currentItem = message.currentItem ?? 0;
                    packet.metaData = {
                        2: { id: 2, type: 4, value: String(message.username || "") }
                    };
                    packet.handle(handler);
                    return true;
                }

                case "entityTeleport": {
                    const packet = new ServerEntityTeleportPacket();
                    packet.entityId = message.eid ?? 0;
                    packet.x = toFixedPoint(message.x);
                    packet.y = toFixedPoint(message.y);
                    packet.z = toFixedPoint(message.z);
                    packet.yaw = toAngle(message.yaw);
                    packet.pitch = toAngle(message.pitch);
                    packet.onGround = message.onGround === true;
                    packet.handle(handler);
                    return true;
                }

                case "destroyEntities": {
                    const packet = new ServerDestroyEntitiesPacket();
                    packet.entityIds = Array.isArray(message.eids) ? message.eids : [];
                    packet.handle(handler);
                    return true;
                }

                case "chat": {
                    const packet = new ServerChatPacket();
                    packet.message = String(message.text ?? message.message ?? "");
                    packet.type = 0;
                    packet.handle(handler);
                    return true;
                }

                case "time": {
                    new ServerTimeUpdatePacket(message.time ?? message.worldTime ?? 0).handle(handler);
                    return true;
                }
            }
        } catch (error) {
            console.error("[JsonMultiplayer] Failed to handle '" + message.type + "' message:", error);
            return true;
        }

        return false;
    }
};

export default JsonMultiplayer;
