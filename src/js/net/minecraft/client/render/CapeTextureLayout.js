const CAPE_REGION = { x: 1, y: 1, width: 10, height: 16 };
const BASE_WIDTH = 64;
const BASE_HEIGHT = 32;

export function getCapeTextureRect(width, height) {
    const scale = width / BASE_WIDTH;

    if (Number.isInteger(scale) && scale >= 1 && height === BASE_HEIGHT * scale) {
        return {
            x: CAPE_REGION.x * scale,
            y: CAPE_REGION.y * scale,
            width: CAPE_REGION.width * scale,
            height: CAPE_REGION.height * scale
        };
    }

    return { x: 0, y: 0, width, height };
}

export function getCapeTextureRegion(width, height) {
    const rect = getCapeTextureRect(width, height);

    return {
        u0: rect.x / width,
        u1: (rect.x + rect.width) / width,
        vTop: 1 - rect.y / height,
        vBottom: 1 - (rect.y + rect.height) / height
    };
}
