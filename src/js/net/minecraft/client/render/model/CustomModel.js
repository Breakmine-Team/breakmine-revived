import * as THREE from "../../../../../../../libraries/three.module.js";
import { OBJLoader } from "../../../../../../../libraries/OBJLoader.js";
import { base64Assets } from "../../../../../../resources.js";

const modelCache = new Map();
const textureCache = new Map();

function decodeDataUri(dataUri) {
    const comma = dataUri.indexOf(",");
    if (comma === -1) {
        return "";
    }
    return atob(dataUri.slice(comma + 1));
}

function buildFaces(group) {
    const faces = [];

    group.traverse(child => {
        if (!child.isMesh || !child.geometry) {
            return;
        }

        const geometry = child.geometry;
        const positions = geometry.attributes.position;
        const uvs = geometry.attributes.uv;
        const normals = geometry.attributes.normal;
        if (!positions) {
            return;
        }

        const index = geometry.index;
        const count = index ? index.count : positions.count;

        for (let i = 0; i + 2 < count; i += 3) {
            const indices = [
                index ? index.getX(i) : i,
                index ? index.getX(i + 1) : i + 1,
                index ? index.getX(i + 2) : i + 2
            ];

            const vertices = indices.map(vertexIndex => ({
                position: [
                    positions.getX(vertexIndex),
                    positions.getY(vertexIndex),
                    positions.getZ(vertexIndex)
                ],
                uv: uvs
                    ? [uvs.getX(vertexIndex), uvs.getY(vertexIndex)]
                    : [0, 0]
            }));

            const normalIndex = indices[0];
            const normal = normals
                ? [
                    normals.getX(normalIndex),
                    normals.getY(normalIndex),
                    normals.getZ(normalIndex)
                ]
                : [0, 1, 0];

            faces.push({ vertices, normal });
        }
    });

    return { faces };
}

export function loadModelAsset(asset) {
    if (modelCache.has(asset)) {
        return modelCache.get(asset);
    }

    const data = base64Assets[asset];
    if (!data) {
        console.warn(`[CustomModel] Missing bundled model asset: ${asset}`);
        modelCache.set(asset, null);
        return null;
    }

    const model = buildFaces(new OBJLoader().parse(decodeDataUri(data)));
    modelCache.set(asset, model);
    return model;
}

export function loadTextureAsset(asset) {
    if (textureCache.has(asset)) {
        return textureCache.get(asset);
    }

    const data = base64Assets[asset];
    if (!data) {
        console.warn(`[CustomModel] Missing bundled texture: ${asset}`);
        textureCache.set(asset, null);
        return null;
    }

    const image = new Image();
    const texture = new THREE.Texture(image);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    image.onload = () => {
        texture.needsUpdate = true;
    };
    image.src = data;

    textureCache.set(asset, texture);
    return texture;
}
