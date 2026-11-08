import * as THREE from '../../../../../../libraries/three.module.js';



export function createSpriteItemGeometry(pixels, width, height) {
    const opaque = (x, y) => x >= 0 && x < width && y >= 0 && y < height && pixels[(y * width + x) * 4 + 3] > 128;
    const positions = [];
    const uv = [];
    const indices = [];
    const normals = [];
    let vertexIndex = 0;

    const addQuad = (vertices, normal) => {
        const start = vertexIndex;
        for (const [x, y, z, u, v] of vertices) {
            positions.push(x, y, z);
            uv.push(u, v);
            normals.push(normal[0], normal[1], normal[2]);
            vertexIndex++;
        }
        indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    };

    const halfDepth = 1 / 32;

    addQuad([
        [-0.5, 0.5, halfDepth, 0, 0],
        [-0.5, -0.5, halfDepth, 0, 1],
        [0.5, -0.5, halfDepth, 1, 1],
        [0.5, 0.5, halfDepth, 1, 0]
    ], [0, 0, 1]);

    addQuad([
        [-0.5, 0.5, -halfDepth, 0, 0],
        [0.5, 0.5, -halfDepth, 1, 0],
        [0.5, -0.5, -halfDepth, 1, 1],
        [-0.5, -0.5, -halfDepth, 0, 1]
    ], [0, 0, -1]);

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            if (!opaque(x, y)) continue;

            const left = x / width - 0.5;
            const right = (x + 1) / width - 0.5;
            const top = 0.5 - y / height;
            const bottom = 0.5 - (y + 1) / height;
            const pixelU = (x + 0.5) / width;
            const pixelV = (y + 0.5) / height;

            if (!opaque(x - 1, y)) {
                addQuad([
                    [left, top, halfDepth, pixelU, pixelV],
                    [left, top, -halfDepth, pixelU, pixelV],
                    [left, bottom, -halfDepth, pixelU, pixelV],
                    [left, bottom, halfDepth, pixelU, pixelV]
                ], [-1, 0, 0]);
            }

            if (!opaque(x + 1, y)) {
                addQuad([
                    [right, top, halfDepth, pixelU, pixelV],
                    [right, bottom, halfDepth, pixelU, pixelV],
                    [right, bottom, -halfDepth, pixelU, pixelV],
                    [right, top, -halfDepth, pixelU, pixelV]
                ], [1, 0, 0]);
            }

            if (!opaque(x, y - 1)) {
                addQuad([
                    [left, top, halfDepth, pixelU, pixelV],
                    [right, top, halfDepth, pixelU, pixelV],
                    [right, top, -halfDepth, pixelU, pixelV],
                    [left, top, -halfDepth, pixelU, pixelV]
                ], [0, 1, 0]);
            }

            if (!opaque(x, y + 1)) {
                addQuad([
                    [left, bottom, halfDepth, pixelU, pixelV],
                    [left, bottom, -halfDepth, pixelU, pixelV],
                    [right, bottom, -halfDepth, pixelU, pixelV],
                    [right, bottom, halfDepth, pixelU, pixelV]
                ], [0, -1, 0]);
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    geometry.setIndex(indices);
    return geometry;
}

export function createSpriteItemMesh(texture) {
    const image = texture?.image;
    if (!image) return null;
    const width = image.naturalWidth || image.width, height = image.naturalHeight || image.height;
    let pixels = image.data;
    if (!pixels) {
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        pixels = context.getImageData(0, 0, width, height).data;
    }
    return new THREE.Mesh(createSpriteItemGeometry(pixels, width, height),
        new THREE.MeshBasicMaterial({ map: texture, alphaTest: .1, transparent: false,
            depthTest: true, depthWrite: true, side: THREE.FrontSide }));
}
