import Packet from "../../../Packet.js";

/**
 * Ask the server for the current off-grid state. Sent after JoinGame and
 * after ResetWorld, so the client applies the snapshot once its world (and
 * world renderer) for that server/world actually exists.
 */
export default class ClientOffGridRequestPacket extends Packet {

    write(buffer) {
        // No payload.
    }
}
