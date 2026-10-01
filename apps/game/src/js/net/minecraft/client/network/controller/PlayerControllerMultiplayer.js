import PlayerController from "./PlayerController.js";
import PlayerEntityMultiplayer from "../../entity/PlayerEntityMultiplayer.js";
import ClientChatPacket from "../packet/play/client/ClientChatPacket.js";
import ClientPlayerDiggingPacket from "../packet/play/client/ClientPlayerDiggingPacket.js";
import ClientPlayerBlockPlacementPacket from "../packet/play/client/ClientPlayerBlockPlacementPacket.js";

export default class PlayerControllerMultiplayer extends PlayerController {

    constructor(minecraft, networkHandler, entityId) {
        super(minecraft);

        this.entityId = entityId;
        this.networkHandler = networkHandler;
    }

    createPlayer(world) {
        let player = new PlayerEntityMultiplayer(this.minecraft, world, this.networkHandler, this.entityId);
        player.inventory.setItemRenderer(this.minecraft.itemRenderer);

        const networkManager = this.networkHandler?.getNetworkManager?.();
        if (networkManager && networkManager.pendingPlayerState) {
            const state = networkManager.pendingPlayerState;
            if (typeof state.x === 'number' && typeof state.y === 'number' && typeof state.z === 'number') {
                player.setPositionAndRotation(state.x, state.y, state.z, state.yaw, state.pitch);
                player.lastReportedX = state.x;
                player.lastReportedY = state.y;
                player.lastReportedZ = state.z;
                player.lastReportedYaw = state.yaw;
                player.lastReportedPitch = state.pitch;
                player.positionUpdateTicks = 0;
            }
            if (typeof state.health === 'number') {
                player.health = state.health;
            }
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
            networkManager.pendingPlayerState = null;
        }
        if (networkManager && networkManager.pendingInventory) {
            player.inventory.applyNetworkState(networkManager.pendingInventory);
            networkManager.pendingInventory = null;
        }
        if (networkManager && networkManager.pendingHealth != null) {
            player.health = networkManager.pendingHealth;
            networkManager.pendingHealth = null;
        }
        if (networkManager && networkManager.pendingGamemode) {
            const gamemode = networkManager.pendingGamemode.gamemode;
            player.creative = (gamemode === 1);
            player.spectator = (gamemode === 3);
            if (typeof networkManager.pendingGamemode.flying === 'boolean') {
                player.flying = networkManager.pendingGamemode.flying;
            } else if (gamemode === 0) {
                player.flying = false;
            } else if (gamemode === 1 || gamemode === 3) {
                player.flying = true;
            }
            networkManager.pendingGamemode = null;
        }

        return player;
    }

    sendChatMessage(message) {
        this.networkHandler.sendPacket(new ClientChatPacket(message));
    }

    getNetworkHandler() {
        return this.networkHandler;
    }

    sendBlockDiggingPacket(status, blockPosition, face) {
        this.networkHandler.sendPacket(new ClientPlayerDiggingPacket(status, blockPosition, face));
    }

    sendBlockPlacementPacket(blockPosition, direction, heldItem) {
        this.networkHandler.sendPacket(new ClientPlayerBlockPlacementPacket(blockPosition, direction, heldItem));
    }
}