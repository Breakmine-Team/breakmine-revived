// Read/write signed 64-bit big-endian values without relying on Node's
// Buffer BigInt methods (readBigInt64BE/writeBigInt64BE). Those methods are
// missing from some browser `buffer` polyfill bundles, which breaks the
// integrated server worker in singlefile builds. Works on any Uint8Array-like.

export function readLongBE(source, offset) {
    let value = 0n;
    for (let i = 0; i < 8; i++) {
        value = (value << 8n) | BigInt(source[offset + i]);
    }
    // Convert unsigned 64-bit to signed (two's complement)
    if (value >= 0x8000000000000000n) {
        value -= 0x10000000000000000n;
    }
    return value;
}

export function writeLongBE(value, target, offset) {
    let v = BigInt(value);
    for (let i = 7; i >= 0; i--) {
        target[offset + i] = Number(v & 0xffn);
        v >>= 8n;
    }
}
