import Packet from "../../../Packet.js";
import {
    OFF_GRID_UPDATE_ADD_GHOST,
    OFF_GRID_UPDATE_CLEAR_FIELD,
    OFF_GRID_UPDATE_CLEAR_GHOSTS,
    OFF_GRID_UPDATE_POSE,
    OFF_GRID_UPDATE_SET_CELL
} from "../../../../../util/OffGridConstants.js";

/**
 * One incremental off-grid change. Cell edits use this (they can be frequent
 * while building); structural commands broadcast a full state packet instead,
 * which is simpler and guarantees every client converges on the server's
 * exact cell grid after a move/rotate.
 */
export default class ServerOffGridUpdatePacket extends Packet {

    constructor() {
        super();
        this.update = null;
    }

    read(buffer) {
        const action = buffer.readUnsignedByte();

        switch (action) {
            case OFF_GRID_UPDATE_SET_CELL: {
                this.update = {
                    action,
                    x: buffer.readInt(),
                    y: buffer.readVarInt(),
                    z: buffer.readInt(),
                    // Normalise registry-hash ids above 2^31.
                    typeId: buffer.readVarInt() >>> 0,
                    data: buffer.readUnsignedByte() & 0xF
                };
                return;
            }

            case OFF_GRID_UPDATE_POSE: {
                const rotation = {
                    x: buffer.readFloat(),
                    y: buffer.readFloat(),
                    z: buffer.readFloat()
                };
                const offset = {
                    x: buffer.readFloat(),
                    y: buffer.readFloat(),
                    z: buffer.readFloat()
                };
                let pivot = null;
                if (buffer.readBoolean()) {
                    pivot = {
                        x: buffer.readFloat(),
                        y: buffer.readFloat(),
                        z: buffer.readFloat()
                    };
                }
                this.update = { action, rotation, offset, pivot };
                return;
            }

            case OFF_GRID_UPDATE_ADD_GHOST: {
                this.update = {
                    action,
                    x: buffer.readFloat(),
                    y: buffer.readFloat(),
                    z: buffer.readFloat(),
                    typeId: buffer.readVarInt() >>> 0,
                    data: buffer.readUnsignedByte() & 0xF
                };
                return;
            }

            case OFF_GRID_UPDATE_CLEAR_FIELD:
            case OFF_GRID_UPDATE_CLEAR_GHOSTS: {
                this.update = { action };
                return;
            }

            default:
                this.update = null;
        }
    }

    handle(handler) {
        handler.handleServerOffGridUpdate(this);
    }

    getUpdate() {
        return this.update;
    }
}
