import Packet from "../../../Packet.js";
import {
    OFF_GRID_MAX_CELLS,
    OFF_GRID_MAX_GHOSTS,
    OFF_GRID_PROTOCOL_VERSION
} from "../../../../../util/OffGridConstants.js";

/**
 * Full server-authoritative off-grid state: summoned cells, the group pose
 * (rotation + fractional offset + pivot) and the ghost-block renders. Sent on
 * request (join / world switch) and after structural commands.
 */
export default class ServerOffGridStatePacket extends Packet {

    constructor() {
        super();
        this.state = null;
    }

    read(buffer) {
        const version = buffer.readVarInt();
        if (version !== OFF_GRID_PROTOCOL_VERSION) {
            this.state = null;
            return;
        }

        const cellCount = buffer.readVarInt();
        if (cellCount < 0 || cellCount > OFF_GRID_MAX_CELLS) {
            throw new Error("Off-grid state has an invalid cell count: " + cellCount);
        }

        const cells = [];
        for (let i = 0; i < cellCount; i++) {
            const x = buffer.readInt();
            const y = buffer.readVarInt();
            const z = buffer.readInt();
            // readVarInt returns a signed 32-bit value; registry-hash block
            // ids above 2^31 must be normalised back to unsigned.
            const typeId = buffer.readVarInt() >>> 0;
            const data = buffer.readUnsignedByte() & 0xF;

            // Keep malformed entries out of the renderer instead of letting
            // one bad cell abort the whole authoritative state.
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(z)) continue;
            if (y < 0 || y > 255 || typeId <= 0) continue;
            cells.push({ x, y, z, typeId, data });
        }

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

        const ghostCount = buffer.readVarInt();
        if (ghostCount < 0 || ghostCount > OFF_GRID_MAX_GHOSTS) {
            throw new Error("Off-grid state has an invalid ghost count: " + ghostCount);
        }

        const ghosts = [];
        for (let i = 0; i < ghostCount; i++) {
            const x = buffer.readFloat();
            const y = buffer.readFloat();
            const z = buffer.readFloat();
            const typeId = buffer.readVarInt() >>> 0;
            const data = buffer.readUnsignedByte() & 0xF;
            if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
            if (typeId <= 0) continue;
            ghosts.push({ x, y, z, typeId, data });
        }

        this.state = { version, cells, rotation, offset, pivot, ghosts };
    }

    handle(handler) {
        handler.handleServerOffGridState(this);
    }

    getState() {
        return this.state;
    }
}
