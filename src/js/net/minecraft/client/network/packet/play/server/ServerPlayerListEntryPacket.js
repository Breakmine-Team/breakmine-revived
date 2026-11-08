import Packet from "../../../Packet.js";
import GameProfile from "../../../../../util/GameProfile.js";

export default class ServerPlayerListEntryPacket extends Packet {

    constructor() {
        super();

        this.players = [];
    }

    read(buffer) {
        this.action = buffer.readVarInt();
        let amount = buffer.readVarInt();

        for (let i = 0; i < amount; i++) {
            let profile = null;
            let gameType = 0;
            let ping = 0;
            let displayName = null;

            switch (this.action) {
                case 0: 
                    profile = new GameProfile(buffer.readUUID(), buffer.readString(16));

                    let propertiesCount = buffer.readVarInt();
                    for (let propIndex = 0; propIndex < propertiesCount; propIndex++) {
                        let key = buffer.readString(32767);
                        let value = buffer.readString(32767);

                        if (buffer.readBoolean()) {
                            let signature = buffer.readString(32767);
                        } else {
                        }
                    }

                    gameType = buffer.readVarInt();
                    ping = buffer.readVarInt();

                    if (buffer.readBoolean()) {
                        displayName = buffer.readTextComponent();
                    }
                    break;
                case 1: 
                    profile = new GameProfile(buffer.readUUID(), null);
                    gameType = buffer.readVarInt();
                    break;
                case 2: 
                    profile = new GameProfile(buffer.readUUID(), null);
                    ping = buffer.readVarInt();
                    break;
                case 3: 
                    profile = new GameProfile(buffer.readUUID(), null);

                    if (buffer.readBoolean()) {
                        displayName = buffer.readTextComponent();
                    }
                    break;
                case 4: 
                    profile = new GameProfile(buffer.readUUID(), null);
                    break;
            }

            this.players.push({
                profile: profile,
                ping: ping,
                gameType: gameType,
                displayName: displayName
            })
        }
    }

    handle(handler) {
        handler.handleServerPlayerListEntry(this);
    }

    getAction() {
        return this.action;
    }

    getPlayers() {
        return this.players;
    }
}