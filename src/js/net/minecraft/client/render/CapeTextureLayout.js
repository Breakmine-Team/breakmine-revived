
export function getCapeTextureRect(width, height) {
    if (width === 64 && height === 32) {
        return { x: 1, y: 1, width: 10, height: 16 };
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
