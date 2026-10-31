import * as THREE from "../../../../../../../libraries/three.module.js";
import { OBJLoader } from "../../../../../../../libraries/OBJLoader.js";
import { base64Assets } from "../../../../../../resources.js";

const MODEL_ASSET = "model/cone/model.obj";
const TEXTURE_ASSET = "model/cone/texture.png";

let parsedModel;
let coneTexture;

function decodeDataUri(dataUri) {
    const comma = dataUri.indexOf(",");
    if (comma === -1) {
        return "";
    }
    return atob(dataUri.slice(comma + 1));
}

/**
 * Build a flat triangle list from Three.js's parsed OBJ geometry. The block
 * Tessellator consumes one quad per face, so the renderer pads each triangle
 * when it emits it.
 */
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

/**
 * The traffic cone geometry lives in src/resources/model/cone/model.obj and is
 * embedded by scripts/build-assets.js, so it also works in the single-file
 * build where runtime file requests are unavailable.
 */
export default function getTrafficConeModel() {
    if (parsedModel !== undefined) {
        return parsedModel;
    }

    const asset = base64Assets[MODEL_ASSET];
    if (!asset) {
        console.warn(`[TrafficCone] Missing bundled model asset: ${MODEL_ASSET}`);
        parsedModel = null;
        return parsedModel;
    }

    parsedModel = buildFaces(new OBJLoader().parse(decodeDataUri(asset)));
    return parsedModel;
}

/**
 * The cone keeps its own 64x64 texture instead of being packed into the block
 * atlas. That preserves the model's exact UVs without any atlas offset or tile
 * bleeding.
 */
export function getTrafficConeTexture() {
    if (coneTexture !== undefined) {
        return coneTexture;
    }

    const asset = base64Assets[TEXTURE_ASSET];
    if (!asset) {
        console.warn(`[TrafficCone] Missing bundled texture: ${TEXTURE_ASSET}`);
        coneTexture = null;
        return coneTexture;
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
    image.src = asset;

    coneTexture = texture;
    return coneTexture;
}
