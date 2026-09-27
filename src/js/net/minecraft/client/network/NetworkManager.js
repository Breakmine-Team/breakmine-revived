import ByteBuf from "./util/ByteBuf.js";
import PacketRegistry from "./PacketRegistry.js";
import ProtocolState from "./ProtocolState.js";
import {require} from "../../../../Start.js";
import MissingPackets from "../../util/MissingPackets.js";
import InventoryBasic from "../inventory/inventory/InventoryBasic.js";
import IsomorphicWebSocket from "../../util/IsomorphicWebSocket.js";
import CreeperEntity from "../entity/CreeperEntity.js";

export default class NetworkManager {

    static DEBUG = false;
    static MAX_COMPRESSION = 2097152;

    constructor(minecraft) {
        this.minecraft = minecraft;
        this.socket = null;
        this.connected = false;
        this.networkHandler = null;

        this.registry = new PacketRegistry();
        this.protocolState = ProtocolState.HANDSHAKE;

        this.queue = [];

        this.pako = require("pako");
        this.compressionThreshold = 0;

        this.carryBuffer = [];

        this.pendingInventory = null;
        this.pendingHealth = null;
        this.pendingGamemode = null;

        // Throttle tracking for movement packets
        this.lastMovementPacketTime = 0;
        this.movementThrottleCooldown = 50; // Minimum ms between movement updates
    }

    setNetworkHandler(networkHandler) {
        this.networkHandler = networkHandler;
    }

    connect(address, port, proxy) {
        let wsUrl;
        if (typeof address === 'string' && address.startsWith('tunnel://')) {
            wsUrl = address;
            proxy = null;
        } else {
            wsUrl = proxy ? proxy.url : `ws://${address}:${port}`;
        }

        this.address = address;
        this.port = port;
        this.useProxy = !!proxy;
        this._protocolFallbacks = [];

        if (wsUrl.startsWith('ws://')) {
            this._protocolFallbacks.push(wsUrl.replace('ws://', 'wss://'));
            this._protocolFallbacks.push(wsUrl);
        } else {
            this._protocolFallbacks.push(wsUrl);
        }

        this._connectNext();
    }

    _connectNext() {
        const url = this._protocolFallbacks.shift();
        if (!url) {
            if (!this.connected) {
                this._onClose({ wasClean: false, code: 1006, reason: 'All connection attempts failed' });
            }
            return;
        }

        const socket = new IsomorphicWebSocket(url);
        socket.binaryType = "arraybuffer";
        this.socket = socket;

        socket.onopen = e => {
            if (socket !== this.socket) return;
            this._protocolFallbacks = [];
            this._onOpen(e);
        };

        socket.onclose = e => {
            if (socket !== this.socket) return;
            if (!this.connected && this._protocolFallbacks.length > 0) {
                this._connectNext();
            } else {
                this._onClose(e);
            }
        };

        socket.onmessage = e => {
            if (socket !== this.socket) return;
            this._onMessage(e);
        };

        socket.onerror = () => {};
    }

    _onOpen() {
        this.connected = true;

        if (this.useProxy) {
            this.sendProxyPacket(0, {
                "host": this.address,
                "port": this.port,
            });
        }

        this.networkHandler.onConnect();
        this.flushPacketQueue();
    }

    sendProxyPacket(id, payload) {
        let object = {
            "id": id,
            "payload": payload
        };
        this.socket.send(JSON.stringify(object));
    }

    sendPacket(packet) {
        if (this.connected) {
            this._sendPacketImmediately(packet);
        } else {
            this.queue.push(packet);
        }
    }

    sendJson(payload) {
        if (this.connected && this.socket && this.socket.readyState === 1) {
            this.socket.send(JSON.stringify(payload));
        }
    }

    _sendPacketImmediately(packet) {
        // Drop movement packets if they are firing too rapidly
        const packetName = packet.constructor.name;
        if (packetName === 'ClientPlayerPositionPacket' || 
            packetName === 'ClientPlayerLookPacket' || 
            packetName === 'ClientPlayerPosLookPacket' ||
            packetName === 'ClientPlayerMovementPacket') {
            
            let now = Date.now();
            if (now - this.lastMovementPacketTime < this.movementThrottleCooldown) {
                return; 
            }
            this.lastMovementPacketTime = now;
        }

        let packetState = this.registry.getPacketState(packet);
        if (packetState !== this.protocolState) {
            if (packetState === null) {
                console.error("[Network] Tried to send unknown packet: " + packet.constructor.name);
                return;
            }

            this.setState(packetState);
        }

        let buffer = new ByteBuf();
        buffer.writeByte(this.registry.getClientBoundPacketId(this.protocolState, packet));
        packet.write(buffer);
        buffer.setPosition(0);

        if (this.compressionThreshold !== 0) {
            let length = buffer.length();
            if (length > this.compressionThreshold) {
                let compressed = this.pako.deflate(buffer.getArray(), {
                    chunkSize: 8192
                });

                buffer = new ByteBuf();
                buffer.writeVarInt(length);
                buffer.write(compressed);
            } else {
                let copy = buffer.getArray();
                buffer = new ByteBuf();
                buffer.writeVarInt(0);
                buffer.write(copy);
            }
            buffer.setPosition(0);
        }

        let wrapper = new ByteBuf();
        wrapper.writeVarInt(buffer.length());
        wrapper.write(buffer.getArray());

        if (this.isEncrypted) {
            wrapper = new ByteBuf(this.encryption.encrypt(wrapper.getArray()));
        }

        this.socket.send(wrapper.getArray());

        if (NetworkManager.DEBUG) {
            console.log("[Network] [OUT] " + packet.constructor.name);
        }
    }

    _onJsonMessage(message) {
        try {
            const payload = JSON.parse(message);
            if (!payload || typeof payload !== 'object') {
                return;
            }

            if (payload.type === 'playerState') {
                const player = this.minecraft?.player;
                if (player) {
                    this._applyPlayerState(player, payload);
                } else {
                    this.pendingPlayerState = payload;
                }
            } else if (payload.type === 'respawn') {
                const player = this.minecraft?.player;
                if (player) {
                    this._applyPlayerState(player, payload);
                } else {
                    this.pendingPlayerState = payload;
                }
                // Freeze the player and load chunks around the new spawn before
                // letting them move again, so they can't spawn in mid-air.
                if (this.minecraft) {
                    this.minecraft.showLoadingScreen("Respawning...");
                }
            } else if (payload.type === 'inventory') {
                const player = this.minecraft?.player;
                if (player) {
                    player.inventory.applyNetworkState(payload.inventory);
                } else {
                    this.pendingInventory = payload.inventory;
                }
            } else if (payload.type === 'blockInventories' && this.minecraft?.world) {
                const world = this.minecraft.world;
                if (!world.blockInventories) {
                    world.blockInventories = new Map();
                }

                for (const entry of Array.isArray(payload.inventories) ? payload.inventories : []) {
                    if (!entry || typeof entry !== 'object' || !entry.key) {
                        continue;
                    }
                    const inventory = new InventoryBasic(entry.state?.size || entry.inventory?.size || 27);
                    inventory.applyNetworkState(entry.state || entry.inventory);
                    world.blockInventories.set(entry.key, inventory);
                }
            } else if (payload.type === 'blockInventory' && this.minecraft?.world) {
                const world = this.minecraft.world;
                if (!world.blockInventories) {
                    world.blockInventories = new Map();
                }
                let inventory = world.blockInventories.get(payload.key);
                if (inventory?.applyNetworkState) {
                    inventory.applyNetworkState(payload.inventory);
                } else {
                    inventory = new InventoryBasic(payload.inventory?.size || 27);
                    inventory.applyNetworkState(payload.inventory);
                    world.blockInventories.set(payload.key, inventory);
                }
            } else if (payload.type === 'health') {
                const player = this.minecraft?.player;
                if (player) {
                    player.health = payload.health;
                } else {
                    this.pendingHealth = payload.health;
                }
            } else if (payload.type === 'gamemode') {
                const player = this.minecraft?.player;
                if (player) {
                    const gamemode = payload.gamemode;
                    player.creative = (gamemode === 1);
                    player.spectator = (gamemode === 3);
                    if (typeof payload.flying === 'boolean') {
                        player.flying = payload.flying;
                    } else if (gamemode === 0) {
                        player.flying = false;
                    } else if (gamemode === 1 || gamemode === 3) {
                        player.flying = true;
                    }
                } else {
                    this.pendingGamemode = payload;
                }
            } else if (payload.type === 'hurt' && this.minecraft?.world) {
                const entity = this.minecraft.world.getEntityById(payload.eid);
                if (entity && entity.renderer) {
                    entity.renderer.hurtTimestamp = performance.now();
                    if (payload.damage) {
                        entity.damageEntity(payload.damage, payload.attacker);
                    }
                }
            } else if (payload.type === 'spawnEntity' && this.minecraft?.world) {
                const world = this.minecraft.world;
                const entityType = payload.entityType;
                const x = payload.x;
                const y = payload.y;
                const z = payload.z;
                let entity = null;
                if (entityType === 'Creeper' || entityType === 'creeper') {
                    entity = new CreeperEntity(this.minecraft, world, -2, x, y, z);
                    if (payload.yaw) entity.rotationYaw = payload.yaw;
                    if (payload.pitch) entity.rotationPitch = payload.pitch;
                    world.addEntity(entity);
                }
            }
        } catch (error) {
            console.error("Failed to parse JSON network message", error);
        }
    }

    _applyPlayerState(player, state) {
        if (typeof state.x === 'number' && typeof state.y === 'number' && typeof state.z === 'number') {
            player.setPositionAndRotation(state.x, state.y, state.z, state.yaw, state.pitch);
            player.motionX = 0;
            player.motionY = 0;
            player.motionZ = 0;
            player.fallDistance = 0;
            if (typeof player.lastReportedX === 'number') {
                player.lastReportedX = state.x;
                player.lastReportedY = state.y;
                player.lastReportedZ = state.z;
                player.lastReportedYaw = state.yaw;
                player.lastReportedPitch = state.pitch;
                player.positionUpdateTicks = 0;
            }
        }

        if (typeof state.health === 'number') {
            player.health = state.health;
        }

        // A restored or respawned player is always alive
        player.isDead = false;

        if (typeof state.gamemode === 'number') {
            const gamemode = state.gamemode;
            player.creative = (gamemode === 1);
            player.spectator = (gamemode === 3);
            if (typeof state.flying === 'boolean') {
                player.flying = state.flying;
            } else if (gamemode === 0) {
                player.flying = false;
            } else if (gamemode === 1 || gamemode === 3) {
                player.flying = true;
            }
        }
    }

    _onMessage(event) {
        if (typeof event.data === 'string') {
            this._onJsonMessage(event.data);
            return;
        }

        try {
            let data = new Uint8Array(event.data);

            if (this.isEncrypted) {
                data = this.decryption.decrypt(data);
            }

            let bufferIn = new ByteBuf(new Int8Array([]));
            bufferIn.write(this.carryBuffer);
            bufferIn.write(data);
            bufferIn.setPosition(0);
            this.carryBuffer = [];
            while (bufferIn.readableBytes() > 0) {
                let three = [0, 0, 0];
                let start = bufferIn.getPosition();
                for (let i = 0; i < three.length; i++) {
                    three[i] = bufferIn.readByte();
                    if (three[i] >= 0) {
                        let length = new ByteBuf(three).readVarInt();
                        if (length === 0) {
                            throw new Error("Empty Packet!");
                        }

                        if (bufferIn.readableBytes() < length) {
                            bufferIn.setPosition(start);
                            this.carryBuffer = bufferIn.getSlicedArray();
                            return;
                        } else {
                            this.handlePacket(new ByteBuf(bufferIn.getSlicedArray(length)));
                            bufferIn.skipBytes(length);
                        }
                        break;
                    }
                }
            }
        } catch (e) {
            console.error(e);
            console.log(e.stack);
        }
    }

    handlePacket(buffer) {
        if (this.compressionThreshold !== 0) {
            let uncompressedLength = buffer.readVarInt();

            if (uncompressedLength !== 0) {
                if (uncompressedLength < this.compressionThreshold) {
                    throw new Error("Badly compressed packet - size of " + uncompressedLength + " is below server threshold of " + this.compressionThreshold);
                }
                if (uncompressedLength > NetworkManager.MAX_COMPRESSION) {
                    throw new Error("Badly compressed packet - size of " + uncompressedLength + " is larger than protocol maximum of " + NetworkManager.MAX_COMPRESSION);
                }

                buffer = new ByteBuf(this.pako.inflate(new Uint8Array(buffer.getSlicedArray()), {
                    chunkSize: 8192
                }));

                if (buffer.length() !== uncompressedLength) {
                    throw new Error("Badly compressed packet - decompressed size of " + buffer.length() + " is not equal to original size of " + uncompressedLength);
                }
            }
        }

        let packetId = buffer.readByte();
        let clazz = this.registry.getServerBoundById(this.protocolState, packetId);
        if (clazz === null) {
            if (NetworkManager.DEBUG) {
                console.log("[Network] [IN] Unknown packet id: " + packetId + " (0x" + packetId.toString(16) + ") (" + new MissingPackets().get(packetId) + ")");
            }
            return;
        } else {
            if (NetworkManager.DEBUG) {
                console.log("[Network] [IN] " + clazz.name);
            }
        }

        let packet = new clazz;
        packet.read(buffer, buffer.length);
        packet.handle(this.networkHandler);
    }

    _onError(event) {
        console.error("[Network] Error: " + event.data);
    }

    _onClose(event) {
        if (this.connected) {
            this.networkHandler.onDisconnect();
        }

        this.connected = false;
    }

    close() {
        this.connected = false;
        if (this.socket !== null) {
            this.socket.close();
        }
        if (this.networkHandler !== null) {
            this.networkHandler.onDisconnect();
        }
    }

    isConnected() {
        return this.connected;
    }

    flushPacketQueue() {
        this.queue.forEach(packet => this.sendPacket(packet));
        this.queue = [];
    }

    enableEncryption(secretKey) {
        this.isEncrypted = true;
        this.decryption = new (require("aesjs").ModeOfOperation).cfb(secretKey, secretKey, 1);
        this.encryption = new (require("aesjs").ModeOfOperation).cfb(secretKey, secretKey, 1);
    }

    setState(packetState) {
        console.log("[Network] Switching protocol state from " + this.protocolState.getName() + " to " + packetState.getName());
        this.protocolState = packetState;
    }

    getState() {
        return this.protocolState;
    }

    setCompressionThreshold(threshold) {
        console.log("[Network] Set compression threshold to " + threshold);

        if (threshold >= 0) {
            this.compressionThreshold = threshold;
        } else {
            this.compressionThreshold = 0;
        }
    }
}