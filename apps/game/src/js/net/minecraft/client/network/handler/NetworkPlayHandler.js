import PacketHandler from "./PacketHandler.js";
import GuiDisconnected from "../../gui/screens/GuiDisconnected.js";
import WorldClient from "../../world/WorldClient.js";
import ClientKeepAlivePacket from "../packet/play/client/ClientKeepAlivePacket.js";
import PlayerControllerMultiplayer from "../controller/PlayerControllerMultiplayer.js";
import ClientPlayerPositionRotationPacket from "../packet/play/client/ClientPlayerPositionRotationPacket.js";
import PlayerEntity from "../../entity/PlayerEntity.js";
import ServerAnimationPacket from "../packet/play/server/ServerAnimationPacket.js";
import ClientConfirmTransactionPacket from "../packet/play/client/ClientConfirmTransactionPacket.js";
import ItemEntity from "../../entity/ItemEntity.js";

export default class NetworkPlayHandler extends PacketHandler {

    constructor(networkManager, profile) {
        super();

        this.minecraft = networkManager.minecraft;
        this.networkManager = networkManager;
        this.profile = profile;

        this.playerInfoMap = new Map();
    }

    handleKeepAlive(packet) {
        this.networkManager.sendPacket(new ClientKeepAlivePacket(packet.getId()));
    }

    handleJoinGame(packet) {
        this.minecraft.playerController = new PlayerControllerMultiplayer(this.minecraft, this, packet.entityId);
        let world = new WorldClient(this.minecraft);
        this.minecraft.loadWorld(world);
        this.minecraft.ingameOverlay.chatOverlay.clearChat();
    }

    handleServerChat(packet) {
        if (packet.getType() !== 2) {
            this.minecraft.ingameOverlay.chatOverlay.addMessage(packet.getMessage());
        }
    }

    handleServerSpawnPosition(packet) {
        this.minecraft.world.spawnX = packet.getSpawnX();
        this.minecraft.world.spawnY = packet.getSpawnY();
        this.minecraft.world.spawnZ = packet.getSpawnZ();

        // Set player position to spawn position
        if (this.minecraft.player) {
            this.minecraft.player.setPosition(packet.getSpawnX(), packet.getSpawnY(), packet.getSpawnZ());
        }
    }

    handleServerPlayerListEntry(packet) {
        for (let entry of packet.getPlayers()) {
            if (!entry || !entry.profile) continue;
            
            let uuid = entry.profile.getId().toString();

            if (packet.getAction() === 4) { // REMOVE_PLAYER
                this.playerInfoMap.delete(uuid);
            } else {
                if (packet.getAction() === 0) { // ADD_PLAYER
                    this.playerInfoMap.set(uuid, entry);
                }

                let playerInfo = this.playerInfoMap.get(uuid);
                if (playerInfo !== null && typeof playerInfo !== "undefined") {
                    switch (packet.getAction()) {
                        case 0: // ADD_PLAYER
                            playerInfo.gameType = entry.gameType;
                            playerInfo.ping = entry.ping;
                            break;
                        case 1: // UPDATE_GAMEMODE
                            playerInfo.gameType = entry.gameType;
                            break;
                        case 2: // UPDATE_LATENCY
                            playerInfo.ping = entry.ping;
                            break;
                        case 3: // UPDATE_DISPLAY_NAME
                            playerInfo.displayName = entry.displayName;
                            break;
                    }

                    if (packet.getAction() === 0 || packet.getAction() === 1) {
                        if (this.minecraft && this.minecraft.world) {
                            for (const e of this.minecraft.world.entities) {
                                if (e.uuid === uuid) {
                                    e.creative = (entry.gameType === 1);
                                    e.spectator = (entry.gameType === 3);
                                    break;
                                }
                            }
                        }
                    }
                }
            }
        }

        this.minecraft.ingameOverlay.playerListOverlay.setDirty();
    }

    handleServerPlayerListData(packet) {
        this.minecraft.ingameOverlay.playerListOverlay.setHeader(packet.getHeader());
        this.minecraft.ingameOverlay.playerListOverlay.setFooter(packet.getFooter());
    }

    handleResetWorld(packet) {
        // Clear all chunks from the world
        this.minecraft.world.clearChunks();
    }

    handleTimeUpdate(packet) {
        // Update world time from server
        this.minecraft.world.time = packet.getWorldTime();
    }

    handleServerPlayerPositionRotation(packet) {
        let player = this.minecraft.player;
        if (!player) {
            return;
        }

        let x = packet.getX();
        let y = packet.getY();
        let z = packet.getZ();
        let yaw = packet.getYaw();
        let pitch = packet.getPitch();

        if (packet.hasFlag(0x01)) {
            x += player.x;
        } else {
            player.motionX = 0;
        }

        if (packet.hasFlag(0x02)) {
            y += player.y;
        } else {
            player.motionY = 0;
        }

        if (packet.hasFlag(0x04)) {
            z += player.z;
        } else {
            player.motionZ = 0;
        }

        if (packet.hasFlag(0x08)) {
            yaw += player.rotationYaw;
        }

        if (packet.hasFlag(0x10)) {
            pitch += player.rotationPitch;
        }

        player.setPositionAndRotation(x, y, z, yaw, pitch);
        this.networkManager.sendPacket(new ClientPlayerPositionRotationPacket(true, player.x, player.boundingBox.minY, player.z, player.rotationYaw, player.rotationPitch));
    }

    handleServerSpawnPlayer(packet) {
        let world = this.minecraft.world;
        let entity = new PlayerEntity(this.minecraft, world, packet.getEntityId());
        entity.inventory.setItemRenderer(this.minecraft.itemRenderer);

        entity.serverPositionX = packet.getX();
        entity.serverPositionY = packet.getY();
        entity.serverPositionZ = packet.getZ();

        let x = entity.serverPositionX / 32;
        let y = entity.serverPositionY / 32;
        let z = entity.serverPositionZ / 32;

        let yaw = packet.rotation ? packet.getYaw() * 360 / 256 : entity.rotationYaw;
        let pitch = packet.rotation ? packet.getPitch() * 360 / 256 : entity.rotationPitch;

        entity.setPosition(x, y, z);
        entity.setRotation(yaw, pitch);

        let uuid = packet.getUUID().toString();
        entity.uuid = uuid;

        // Set username from metadata (index 2 is custom name)
        let metaData = packet.getMetaData();
        if (metaData && metaData[2] && metaData[2].value) {
            entity.username = metaData[2].value;
        } else {
            // Fallback to player info map
            let playerInfo = this.playerInfoMap.get(uuid);
            if (playerInfo && playerInfo.profile && playerInfo.profile.getUsername()) {
                entity.username = playerInfo.profile.getUsername();
            }
        }

        // Set creative/spectator flags from player info
        let playerInfo = this.playerInfoMap.get(uuid);
        if (playerInfo) {
            entity.creative = (playerInfo.gameType === 1);
            entity.spectator = (playerInfo.gameType === 3);
            if (entity.spectator) entity.flying = true;
        }

        world.addEntity(entity);
    }

    handleEntityMovement(packet) {
        let entity = this.minecraft.world.getEntityById(packet.getEntityId());
        if (entity !== null) {
            entity.serverPositionX += packet.getX();
            entity.serverPositionY += packet.getY();
            entity.serverPositionZ += packet.getZ();

            let x = entity.serverPositionX / 32;
            let y = entity.serverPositionY / 32;
            let z = entity.serverPositionZ / 32;

            let yaw = packet.rotation ? packet.getYaw() * 360 / 256 : entity.rotationYaw;
            let pitch = packet.rotation ? packet.getPitch() * 360 / 256 : entity.rotationPitch;

            entity.setTargetPositionAndRotation(x, y, z, yaw, pitch, 3);

            entity.onGround = packet.isOnGround();
        }
    }

    handleEntityTeleport(packet) {
        let entity = this.minecraft.world.getEntityById(packet.getEntityId());
        if (entity !== null) {
            entity.serverPositionX = packet.getX();
            entity.serverPositionY = packet.getY();
            entity.serverPositionZ = packet.getZ();

            let x = entity.serverPositionX / 32;
            let y = entity.serverPositionY / 32;
            let z = entity.serverPositionZ / 32;

            let yaw = packet.getYaw() * 360 / 256;
            let pitch = packet.getPitch() * 360 / 256;

            if (Math.abs(entity.x - x) < 0.03125 && Math.abs(entity.y - y) < 0.015625 && Math.abs(entity.z - z) < 0.03125) {
                entity.setTargetPositionAndRotation(entity.x, entity.y, entity.z, yaw, pitch, 3);
            } else {
                entity.setTargetPositionAndRotation(x, y, z, yaw, pitch, 3);
            }

            entity.onGround = packet.isOnGround();
        }
    }

    handleEntityMetadata(packet) {
        let entity = this.minecraft.world.getEntityById(packet.getEntityId());
        if (entity !== null) {
            entity.updateMetaData(packet.getMetaData());

            // Update username from metadata if present (index 2 is custom name)
            let metaData = packet.getMetaData();
            if (metaData && metaData[2] && metaData[2].value) {
                entity.username = metaData[2].value;
            }
        }
    }

    handleEntityHeadLook(packet) {
        let entity = this.minecraft.world.getEntityById(packet.getEntityId());
        if (entity !== null) {
            entity.setRotationYawHead(packet.getHeadYaw() * 360 / 256);
        }
    }

    handleAnimation(packet) {
        let entity = this.minecraft.world.getEntityById(packet.getEntityId());
        if (entity !== null) {
            switch (packet.getAnimation()) {
                case ServerAnimationPacket.SWING_ARM:
                    entity.swingArm();
                    break;
            }
        }
    }

    handleDestroyEntities(packet) {
        for (let entityId of packet.getEntityIds()) {
            this.minecraft.world.removeEntityById(entityId);
        }
    }

    handleServerSpawnObject(packet) {
        let world = this.minecraft.world;

        // Type 1 = Item
        if (packet.getType() === 1) {
            let x = packet.getX() / 32;
            let y = packet.getY() / 32;
            let z = packet.getZ() / 32;
            let blockId = packet.getObjectData();

            let entity = new ItemEntity(this.minecraft, world, blockId, x, y, z);
            entity.id = packet.getEntityId();
            entity.hasPickupDelay = packet.getPickupDelay() === 1;
            world.addEntity(entity);
        }
    }

    handleConfirmTransaction(packet) {
        if (!packet.isAccepted()) {
            this.networkManager.sendPacket(new ClientConfirmTransactionPacket(packet.getWindowId(), packet.getActionId(), true));
        }
    }

    handleChunkData(packet) {
        let provider = this.minecraft.world.getChunkProvider();

        if (packet.isFullChunk()) {
            if (packet.getMask() === 0) {
                provider.unloadChunk(packet.getX(), packet.getZ());
                return;
            }

            provider.loadChunk(packet.getX(), packet.getZ());
        }

        let chunk = this.minecraft.world.getChunkAt(packet.getX(), packet.getZ());
        chunk.fillChunk(packet.getData(), packet.getMask(), packet.isFullChunk());
    }

    handleMultiChunkData(packet) {
        for (let chunkData of packet.getChunkData()) {
            this.handleChunkData(chunkData);
        }
    }

    handleBlockChange(packet) {
        let position = packet.getBlockPosition();

        let blockState = packet.getBlockState();
        let typeId = blockState >> 4;
        let blockData = blockState & 0xF;

        // Check if block change is within 4 blocks of player
        let playerX = Math.floor(this.minecraft.player.x);
        let playerY = Math.floor(this.minecraft.player.y);
        let playerZ = Math.floor(this.minecraft.player.z);

        let dx = Math.abs(position.getX() - playerX);
        let dy = Math.abs(position.getY() - playerY);
        let dz = Math.abs(position.getZ() - playerZ);

        let withinRange = dx <= 4 && dy <= 4 && dz <= 4;

        // The server is authoritative in multiplayer: apply the received state
        // without running block placement callbacks (which would recompute e.g.
        // door facing from the local player and desync from the server).
        this.minecraft.world.setBlockAtNoEvents(position.getX(), position.getY(), position.getZ(), typeId, blockData);
    }

    handleSignTextUpdate(packet) {
        let position = packet.getBlockPosition();
        let text = packet.getText();

        if (this.minecraft.world && this.minecraft.world.blockInventories) {
            const key = `${position.getX()},${position.getY()},${position.getZ()}`;
            this.minecraft.world.blockInventories.set(key, { text: text });

            // Update sign text rendering
            if (this.minecraft.worldRenderer && this.minecraft.worldRenderer.signTextRenderer) {
                this.minecraft.worldRenderer.signTextRenderer.updateSign(
                    this.minecraft.world,
                    position.getX(),
                    position.getY(),
                    position.getZ()
                );
            }
        }
    }

    handleDisconnect(packet) {
        this.disconnectReason = packet.getReason();
        this.minecraft.loadWorld(null);
        this.minecraft.displayScreen(new GuiDisconnected(this.disconnectReason));
    }

    onDisconnect() {
        this.minecraft.loadWorld(null);
        this.minecraft.displayScreen(new GuiDisconnected(this.disconnectReason || "Disconnected from server"));
    }

    getNetworkManager() {
        return this.networkManager;
    }

    getPlayerInfoMap() {
        return this.playerInfoMap;
    }

    sendPacket(packet) {
        this.networkManager.sendPacket(packet);
    }

}