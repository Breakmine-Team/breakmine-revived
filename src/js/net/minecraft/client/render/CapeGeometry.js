import * as THREE from "../../../../../../libraries/three.module.js";
import { getCapeTextureRegion } from "./CapeTextureLayout.js";

/**
 * Build the cape quad in player-model space.
 *
 * The model rig is built Y-down (the renderer flips it with a negative scale),
 * so the geometry is translated to hang from y=0 at the shoulders to y=16 at
 * the knees. UVs are assigned per vertex because the default PlaneGeometry
 * mapping is upside down for this rig.
 *
 * @param {number} textureWidth  Cape sheet width in pixels
 * @param {number} textureHeight Cape sheet height in pixels
 * @returns {THREE.PlaneGeometry}
 */
export function createCapeGeometry(textureWidth = 64, textureHeight = 32) {
    const geometry = new THREE.PlaneGeometry(10, 16);
    geometry.translate(0, 8, 0);

    const { u0, u1, vTop, vBottom } = getCapeTextureRegion(textureWidth, textureHeight);

    const position = geometry.getAttribute('position');
    const uv = geometry.getAttribute('uv');

    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);

        // Cape bottom (largest Y in this Y-down rig) samples the bottom of the
        // artwork; the shoulder edge samples its top row. The rig is mirrored
        // on X by its negative scale, so U must run the other way or the
        // artwork appears backwards.
        uv.setXY(i, x < 0 ? u1 : u0, y > 0.001 ? vBottom : vTop);
    }
    uv.needsUpdate = true;

    return geometry;
}
