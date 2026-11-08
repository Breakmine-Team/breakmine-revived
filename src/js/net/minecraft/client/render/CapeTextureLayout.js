/**
 * Where the cape artwork lives inside a cape sheet.
 *
 * Standard Minecraft cape PNGs are 64x32. The 10x16 cape face starts at
 * (1, 1), not (0, 0): the first row and column are the cape's top/left edge
 * strips. A bare 10x16 cape image uses the whole file.
 *
 * Values are in texture space (v runs bottom-up, as three.js expects).
 *
 * @param {number} width  Image width in pixels
 * @param {number} height Image height in pixels
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function getCapeTextureRect(width, height) {
    if (width === 64 && height === 32) {
        return { x: 1, y: 1, width: 10, height: 16 };
    }

    return { x: 0, y: 0, width, height };
}

/**
 * UV region for the cape face.
 *
 * @param {number} width  Image width in pixels
 * @param {number} height Image height in pixels
 * @returns {{u0: number, u1: number, vTop: number, vBottom: number}}
 */
export function getCapeTextureRegion(width, height) {
    const rect = getCapeTextureRect(width, height);

    return {
        u0: rect.x / width,
        u1: (rect.x + rect.width) / width,
        // Texture rows run top-down in the image but bottom-up in UV space.
        vTop: 1 - rect.y / height,
        vBottom: 1 - (rect.y + rect.height) / height
    };
}
