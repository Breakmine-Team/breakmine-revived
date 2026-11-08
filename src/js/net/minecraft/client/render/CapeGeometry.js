import * as THREE from "../../../../../../libraries/three.module.js";
import { getCapeTextureRegion } from "./CapeTextureLayout.js";

export function createCapeGeometry(textureWidth = 64, textureHeight = 32) {
    const geometry = new THREE.PlaneGeometry(10, 16);
    geometry.translate(0, 8, 0);

    const { u0, u1, vTop, vBottom } = getCapeTextureRegion(textureWidth, textureHeight);

    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');

    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);

        uv.setXY(i, x < 0 ? u1 : u0, y > 0.001 ? vBottom : vTop);
    }
    uv.needsUpdate = true;

    return geometry;
}
