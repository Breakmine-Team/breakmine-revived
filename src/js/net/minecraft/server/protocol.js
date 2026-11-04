import { Buffer } from '../../../../../libraries/buffer.js';

// Thrown when a packet is malformed or shorter than the protocol requires.
// Callers catch this to reject the connection instead of letting the process
// crash with an ERR_OUT_OF_RANGE / ERR_BUFFER_OUT_OF_BOUNDS.
class MalformedPacketError extends Error {
    constructor(message) {
        super(message);
        this.name = 'MalformedPacketError';
    }
}

// Max string length allowed by the protocol (1.8 / Protocol 47).
const MAX_STRING_LENGTH = 32767;

// Number of bytes writeVarInt would use to encode `value`.
function varIntSize(value) {
    let size = 1;
    while ((value & ~0x7F) !== 0) {
        value >>>= 7;
        size++;
        if (size > 5) break;
    }
    return size;
}

// Throws MalformedPacketError unless `buffer` has at least `size` readable
// bytes starting at `offset`. Prevents out-of-bounds buffer reads.
function ensureReadable(buffer, offset, size) {
    if (!Buffer.isBuffer(buffer)) {
        throw new MalformedPacketError('Packet is not a buffer');
    }
    if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(size) || size < 0 || offset + size > buffer.length) {
        throw new MalformedPacketError('Packet ended unexpectedly');
    }
}

function readVarInt(buffer, offset) {
    let value = 0;
    let length = 0;
    let currentByte;
    do {
        if (!Number.isInteger(offset) || offset < 0 || offset + length >= buffer.length) {
            throw new MalformedPacketError('Packet ended before VarInt could be read');
        }
        currentByte = buffer.readUInt8(offset + length);
        value |= (currentByte & 0x7F) << (length * 7);
        length++;
        if (length > 5) {
            throw new MalformedPacketError('VarInt too big');
        }
    } while ((currentByte & 0x80) !== 0);
    return [value, length];
}

function writeVarInt(buffer, value, offset) {
    let byteCount = 0;
    while (true) {
        if ((value & ~0x7F) === 0) {
            buffer.writeUInt8(value, offset + byteCount);
            byteCount++;
            break;
        }
        buffer.writeUInt8((value & 0x7F) | 0x80, offset + byteCount);
        byteCount++;
        value >>>= 7;
    }
    return byteCount;
}

function readString(buffer, offset) {
    const [length, lenBytes] = readVarInt(buffer, offset);
    if (length < 0 || length > MAX_STRING_LENGTH) {
        throw new MalformedPacketError('String length out of range');
    }
    ensureReadable(buffer, offset + lenBytes, length);
    const str = buffer.toString('utf8', offset + lenBytes, offset + lenBytes + length);
    return [str, lenBytes + length];
}

function writeString(buffer, str, offset) {
    const strLen = Buffer.byteLength(str);
    const lenBytes = writeVarInt(buffer, strLen, offset);
    buffer.write(str, offset + lenBytes, 'utf8');
    return lenBytes + strLen;
}

function makePacket(packetId, dataBuffer) {
    const idBuffer = Buffer.alloc(5);
    const idLen = writeVarInt(idBuffer, packetId, 0);
    
    const packetLength = idLen + dataBuffer.length;
    const lenBuffer = Buffer.alloc(5);
    const lenLen = writeVarInt(lenBuffer, packetLength, 0);

    return Buffer.concat([
        lenBuffer.subarray(0, lenLen),
        idBuffer.subarray(0, idLen),
        dataBuffer
    ]);
}

function broadcast(packetBuffer, players) {
    for (const player of players.values()) {
        if (player.ws.readyState === 1) { // WebSocket.OPEN
            player.ws.send(packetBuffer);
        }
    }
}

export {
    readVarInt,
    writeVarInt,
    readString,
    writeString,
    makePacket,
    broadcast,
    ensureReadable,
    varIntSize,
    MalformedPacketError,
    MAX_STRING_LENGTH
};