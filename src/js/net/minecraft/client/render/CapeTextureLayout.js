/**
 * Where the cape artwork lives inside a cape sheet.
 *
 * Standard Minecraft cape PNGs are 64x32 with the 10x16 cape drawn in the
 * top-left corner; a bare 10x16 cape image uses the whole file. Values are in
 * texture space (v runs bottom-up, as three.js expects).
 *
 * @param {number} width  Image width in pixels
 * @param {number} height Image height in pixels
 * @returns {{u0: number, u1: number, vTop: number, vBottom: number}}
 */
export function getCapeTextureRegion(width, height) {
    if (width === 64 && height === 32) {
        return {
            u0: 0,
            u1: 10 / 64,
            vTop: 1,
            vBottom: 1 - 16 / 32
        };
    }

    return { u0: 0, u1: 1, vTop: 1, vBottom: 0 };
}
