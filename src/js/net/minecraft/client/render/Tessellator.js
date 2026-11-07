import * as THREE from "../../../../../../libraries/three.module.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import { getLiquidBlockCornerHeights } from "./LiquidMeshHelper.js";

/**
 * Shader patch that makes a face's coordinates wrap inside its own atlas tile.
 * The atlas is a single texture, so three.js's RepeatWrapping would otherwise
 * sample the neighbouring tiles (and around the atlas) instead of tiling the
 * block's own texture. Faces longer than one block need this just as much as
 * scrolling ones: their UVs run past the tile and bleed into whatever is
 * stored next to it. Keep this at module scope so every cloned material shares
 * one program (three hashes onBeforeCompile.toString()).
 */
function applyTileWrapToShader(shader) {
    shader.vertexShader = shader.vertexShader
        .replace(
            '#include <uv_pars_vertex>',
            '#include <uv_pars_vertex>\nattribute vec4 aTileRect;\nattribute float aWrap;\nvarying vec4 vTileRect;\nvarying float vWrap;'
        )
        .replace(
            '#include <uv_vertex>',
            '#include <uv_vertex>\n\tvTileRect = aTileRect;\n\tvWrap = aWrap;'
        );

    shader.fragmentShader = shader.fragmentShader
        .replace(
            '#include <uv_pars_fragment>',
            '#include <uv_pars_fragment>\nvarying vec4 vTileRect;\nvarying float vWrap;'
        )
        .replace(
            '#include <map_fragment>',
            `#ifdef USE_MAP
	vec2 wrappedUv = vUv;
	// vWrap is a mask: 1 wraps U, 2 wraps V, 3 wraps both. Either way the
	// sample is folded back into the face's own tile.
	// A tile holds 16 texels. Stop half a texel short of the tile's far edge:
	// a sample sitting exactly on the boundary lands in the first texel of the
	// neighbouring tile, which is what made large boxes leak across tiles.
	if ( mod( vWrap, 2.0 ) > 0.5 && vTileRect.z > 0.0 ) {
		wrappedUv.x = vTileRect.x + fract( ( vUv.x - vTileRect.x ) / vTileRect.z ) * vTileRect.z;
		wrappedUv.x = min( wrappedUv.x, vTileRect.x + vTileRect.z * ( 31.0 / 32.0 ) );
	}
	if ( vWrap > 1.5 && vTileRect.w > 0.0 ) {
		wrappedUv.y = vTileRect.y + fract( ( vUv.y - vTileRect.y ) / vTileRect.w ) * vTileRect.w;
		wrappedUv.y = min( wrappedUv.y, vTileRect.y + vTileRect.w * ( 31.0 / 32.0 ) );
	}
	vec4 sampledDiffuseColor = texture2D( map, wrappedUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`
        );
}

// Rotate a point by an angle in degrees per axis (applied X, then Y, then Z)
// around a pivot. Whole-block rotation and per-part rotation share this so a
// turned part composes with a turning block instead of fighting it.
function rotatePoint(x, y, z, pivot, angles) {
    const radians = Math.PI / 180;
    let dx = x - pivot[0];
    let dy = y - pivot[1];
    let dz = z - pivot[2];

    const [angleX, angleY, angleZ] = angles;

    if (angleX !== 0) {
        const cos = Math.cos(angleX * radians);
        const sin = Math.sin(angleX * radians);
        const y2 = dy * cos - dz * sin;
        dz = dy * sin + dz * cos;
        dy = y2;
    }
    if (angleY !== 0) {
        const cos = Math.cos(angleY * radians);
        const sin = Math.sin(angleY * radians);
        const x2 = dx * cos + dz * sin;
        dz = -dx * sin + dz * cos;
        dx = x2;
    }
    if (angleZ !== 0) {
        const cos = Math.cos(angleZ * radians);
        const sin = Math.sin(angleZ * radians);
        const x2 = dx * cos - dy * sin;
        dy = dx * sin + dy * cos;
        dx = x2;
    }

    return [dx + pivot[0], dy + pivot[1], dz + pivot[2]];
}

const NO_PIVOT = [0, 0, 0];

export default class Tessellator {

    // Client-wide defaults for tessellators that don't override them. Both are
    // global graphics options and tessellators are created ad-hoc (particles,
    // entity models, GUI previews), so shared flags are the only way to reach
    // all of them.
    static shadows = true;
    static dynamicLights = false;

    constructor() {
        // Two materials for the same geometry. The lit one is used whenever a
        // real light source can affect the mesh; otherwise the baked vertex
        // colors carry all the lighting and the cheaper unlit one is used.
        this.litMaterial = new THREE.MeshLambertMaterial({
            side: THREE.FrontSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            vertexColors: true
        });

        this.unlitMaterial = new THREE.MeshBasicMaterial({
            side: THREE.FrontSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            vertexColors: true
        });

        // null = follow Tessellator.shadows
        this.shadows = null;

        this.red = 0;
        this.green = 0;
        this.blue = 0;
        this.alpha = 0;

        this.baseRed = 0;
        this.baseGreen = 0;
        this.baseBlue = 0;
        this.baseAlpha = 1;

        this.rotationPivot = null;
        this.rotationFace = null;
        this.rotationAngles = null;

        this.partRotationPivot = null;
        this.partRotationAngles = null;

        this.vertices = [];
        this.uv = [];
        this.colors = [];
        this.tileRects = [];
        this.wraps = [];
        this.tileWrap = null;
        this.tileWrapFlags = 0;
        this.usesTileWrap = false;
    }

    // Material meshes are built from. A getter so callers can keep using
    // tessellator.material; the underlying material swaps with the settings.
    get material() {
        return this.getLit() ? this.litMaterial : this.unlitMaterial;
    }

    // Override shadow casting for meshes produced by this tessellator, or pass
    // null to follow the shared setting again.
    setShadows(enabled) {
        this.shadows = enabled === null ? null : !!enabled;
    }

    // Toggle the shared setting. Meshes already in a scene keep their current
    // flag until the owner re-applies it (see WorldRenderer.applyShadowsToObject).
    static setShadowsEnabled(enabled) {
        Tessellator.shadows = !!enabled;
    }

    static setDynamicLightsEnabled(enabled) {
        Tessellator.dynamicLights = !!enabled;
    }

    getShadows() {
        return this.shadows === null ? Tessellator.shadows : this.shadows;
    }

    // MeshBasicMaterial ignores scene lights entirely, so anything that can
    // still light a mesh - the sun or dynamic point lights - forces the lit
    // material even when no shadow map is being rendered.
    getLit() {
        return this.getShadows() || Tessellator.dynamicLights;
    }

    bindTexture(texture) {
        this.litMaterial.map = texture;
        this.unlitMaterial.map = texture;
    }

    startDrawing() {
        this.addedVertices = 0;
        // Reuse the buffers between meshes. draw() copies them into typed
        // arrays, so nothing retains the JS arrays after a flush.
        this.vertices.length = 0;
        this.uv.length = 0;
        this.colors.length = 0;
        // Per-vertex atlas tile rect (minU, minV, uSpan, vSpan) and a flag that
        // tells the shader to wrap the U coordinate inside that rect. Used by
        // animated faces (e.g. conveyor belts) so the texture scrolls within
        // its own tile instead of sliding across the whole atlas. Most meshes
        // never use this, so the data is only materialized on demand.
        this.tileRects.length = 0;
        this.wraps.length = 0;
        this.tileWrap = null;
        this.tileWrapFlags = 0;
        this.usesTileWrap = false;
        this.clearRotation();
    }

    // Set the atlas sub-rect that the next vertices' U coordinate wraps within,
    // or null to disable wrapping. Kept as state so the block renderer doesn't
    // have to thread it through every addVertexWithUV call.
    setTileWrap(rect) {
        // A wrapping face can appear after non-wrapping geometry in the same
        // mesh. Give the earlier vertices the neutral rect before enabling the
        // attributes, otherwise the buffer lengths would stop matching.
        if (rect !== null && !this.usesTileWrap) {
            const missing = this.addedVertices * 4 - this.tileRects.length;
            for (let i = 0; i < missing; i += 4) {
                this.tileRects.push(0, 0, 1, 1);
                this.wraps.push(0);
            }
            this.usesTileWrap = true;
        }

        this.tileWrap = rect;
        // rect[4] is a wrap mask (1 = U, 2 = V); a plain rect keeps the
        // original U-only wrap used by animated faces.
        this.tileWrapFlags = rect === null ? 0 : (rect[4] === undefined ? 1 : rect[4]);
    }

    // TODO: Use in the game for better FPS
    setDepthWrite(value) {
        //this.material.depthWrite = value;
    }

    setRenderingPass(isTransparent) {
        this.material.transparent = isTransparent;
        this.material.depthWrite = !isTransparent;
        // Reset cutout each pass; blocks that need it (e.g. embedded dust
        // rendered inside a solid lever) opt back in while drawing.
        this.material.alphaTest = 0;
    }

    setColorRGB(red, green, blue) {
        this.red = red;
        this.green = green;
        this.blue = blue;
    }

    setColor(red, green, blue, alpha = 1) {
        this.baseRed = red;
        this.baseGreen = green;
        this.baseBlue = blue;
        this.baseAlpha = alpha;
        this.setColorRGB(red, green, blue);
        this.setAlpha(alpha);
    }

    // Apply a directional shading factor to the current base color.
    // Unlike setColor, this does NOT replace the base color, so multiple
    // polygons can shade independently without compounding.
    setColorShaded(shading) {
        this.setColorRGB(
            this.baseRed * shading,
            this.baseGreen * shading,
            this.baseBlue * shading
        );
        this.setAlpha(this.baseAlpha);
    }

    multiplyColor(red, green, blue, alpha = 1) {
        this.red *= red;
        this.green *= green;
        this.blue *= blue;
        this.alpha *= alpha;
    }

    setAlpha(alpha) {
        this.alpha = alpha;
    }

    addVertex(x, y, z) {
        this.addedVertices++;

        // Turn the part first: a rotated multipart part spins inside its cell,
        // and only then does the whole block's rotation carry it around.
        if (this.partRotationPivot !== null) {
            let turned = rotatePoint(x, y, z, this.partRotationPivot, this.partRotationAngles);
            x = turned[0];
            y = turned[1];
            z = turned[2];
        }

        // Apply the active block-model rotation before pushing the vertex
        if (this.rotationPivot !== null) {
            let rotated = this.rotate(x, y, z);
            x = rotated[0];
            y = rotated[1];
            z = rotated[2];
        }

        // Add vertex
        this.vertices.push(x);
        this.vertices.push(y);
        this.vertices.push(z);

        // Add colors
        this.colors.push(this.red);
        this.colors.push(this.green);
        this.colors.push(this.blue);
        this.colors.push(this.alpha);

        // Add tile wrap data (minU, minV, uSpan, vSpan) and the wrap flag.
        // Until the first wrapping face appears this data is not needed at all.
        if (this.usesTileWrap) {
            if (this.tileWrap !== null) {
                this.tileRects.push(this.tileWrap[0], this.tileWrap[1], this.tileWrap[2], this.tileWrap[3]);
                this.wraps.push(this.tileWrapFlags);
            } else {
                this.tileRects.push(0, 0, 1, 1);
                this.wraps.push(0);
            }
        }
    }

    // Rotate a model so it mounts on one of the six block faces. The model is
    // authored in "floor" orientation (base against the -Y face, handle
    // pointing +Y); with a pivot at the block center, rotating around it keeps
    // the base flush against the selected face.
    setRotation(pivotX, pivotY, pivotZ, faceIndex) {
        this.rotationPivot = [pivotX, pivotY, pivotZ];
        this.rotationFace = faceIndex;
    }

    // Turn everything emitted from now on around a pivot point, by an angle in
    // degrees per axis (applied X, then Y, then Z). Blocks use this to rotate
    // themselves around their own center without moving the block itself.
    setBlockRotation(pivotX, pivotY, pivotZ, angleX, angleY, angleZ) {
        this.rotationPivot = [pivotX, pivotY, pivotZ];
        this.rotationFace = 0;
        this.rotationAngles = [angleX, angleY, angleZ];
    }

    clearRotation() {
        this.rotationPivot = null;
        this.rotationFace = null;
        this.rotationAngles = null;
    }

    // Turn only the geometry emitted from now on, around a part-local pivot,
    // by an angle in degrees per axis (applied X, then Y, then Z). Multipart
    // blocks use this so one part can be tilted or spun without moving the
    // rest of the shape. Composes with setBlockRotation (part first, then
    // block), so parts of a self-rotating block keep their own offset.
    setPartRotation(pivotX, pivotY, pivotZ, angleX, angleY, angleZ) {
        this.partRotationPivot = [pivotX, pivotY, pivotZ];
        this.partRotationAngles = [angleX, angleY, angleZ];
    }

    clearPartRotation() {
        this.partRotationPivot = null;
        this.partRotationAngles = null;
    }

    // Rotate a vertex around the active pivot. faceIndex maps to the face the
    // model is mounted on:
    //   0 = floor   (base -Y, handle +Y)
    //   1 = ceiling (base +Y, handle -Y)
    //   2 = north   (base -Z, handle +Z)
    //   3 = south   (base +Z, handle -Z)
    //   4 = west    (base -X, handle +X)
    //   5 = east    (base +X, handle -X)
    rotate(x, y, z) {
        let dx = x - this.rotationPivot[0];
        let dy = y - this.rotationPivot[1];
        let dz = z - this.rotationPivot[2];

        let rx, ry, rz;
        switch (this.rotationFace) {
            case 1:
                rx = dx; ry = -dy; rz = -dz;
                break;
            case 2:
                rx = dx; ry = -dz; rz = dy;
                break;
            case 3:
                rx = dx; ry = dz; rz = -dy;
                break;
            case 4:
                rx = dy; ry = -dx; rz = dz;
                break;
            case 5:
                rx = -dy; ry = dx; rz = dz;
                break;
            default:
                rx = dx; ry = dy; rz = dz;
                break;
        }

        // Spin the already-mounted model around the pivot (the block center),
        // for blocks that turn in place. The deltas are already relative to
        // the pivot, so they turn around the origin here.
        if (this.rotationAngles !== null) {
            const spun = rotatePoint(rx, ry, rz, NO_PIVOT, this.rotationAngles);
            rx = spun[0];
            ry = spun[1];
            rz = spun[2];
        }

        return [rx + this.rotationPivot[0], ry + this.rotationPivot[1], rz + this.rotationPivot[2]];
    }

    addVertexWithUV(x, y, z, u, v) {
        this.addVertex(x, y, z);

        // Add UV
        this.uv.push(u);
        this.uv.push(v);
    }

    /**
     * Build a quad for a liquid surface. The top surface follows the smoothed
     * corner heights sampled by LiquidMeshHelper (sloped water), while side
     * faces drop from the two edge corners down to the block bottom.
     * UVs must already be V-flipped, matching addFace conventions.
     */
    addLiquidFace(world, liquidId, face, chunkX, chunkY, chunkZ, x, y, z, minU, minV, maxU, maxV) {
        const cx = chunkX << 4;
        const cy = chunkY << 4;
        const cz = chunkZ << 4;

        const heights = getLiquidBlockCornerHeights(world, x, y, z, liquidId);
        const h00 = heights.h00;
        const h01 = heights.h01;
        const h10 = heights.h10;
        const h11 = heights.h11;

        const v = (wx, wy, wz, u, vt) => this.addVertexWithUV(wx - cx, wy - cy, wz - cz, u, vt);

        switch (face) {
            case EnumBlockFace.TOP:
                v(x, y + h01, z + 1, minU, maxV);
                v(x, y + h00, z, minU, minV);
                v(x + 1, y + h10, z, maxU, minV);
                v(x + 1, y + h11, z + 1, maxU, maxV);
                break;
            case EnumBlockFace.BOTTOM:
                v(x + 1, y, z + 1, maxU, maxV);
                v(x + 1, y, z, maxU, minV);
                v(x, y, z, minU, minV);
                v(x, y, z + 1, minU, maxV);
                break;
            case EnumBlockFace.NORTH:
                v(x, y + h00, z, maxU, minV);
                v(x, y, z, maxU, maxV);
                v(x + 1, y, z, minU, maxV);
                v(x + 1, y + h10, z, minU, minV);
                break;
            case EnumBlockFace.SOUTH:
                v(x, y + h01, z + 1, minU, minV);
                v(x + 1, y + h11, z + 1, maxU, minV);
                v(x + 1, y, z + 1, maxU, maxV);
                v(x, y, z + 1, minU, maxV);
                break;
            case EnumBlockFace.WEST:
                v(x, y, z, minU, maxV);
                v(x, y + h00, z, minU, minV);
                v(x, y + h01, z + 1, maxU, minV);
                v(x, y, z + 1, maxU, maxV);
                break;
            case EnumBlockFace.EAST:
                v(x + 1, y + h11, z + 1, minU, minV);
                v(x + 1, y + h10, z, maxU, minV);
                v(x + 1, y, z, maxU, maxV);
                v(x + 1, y, z + 1, minU, maxV);
                break;
            }
    }

    transformBrightness(brightness) {
        for (let i = 0; i < this.colors.length / 4; i++) {
            this.colors[i * 4 + 0] *= brightness;
            this.colors[i * 4 + 1] *= brightness;
            this.colors[i * 4 + 2] *= brightness;
        }
    }

    draw(group, inThing = false) {
        // A single non-finite coordinate makes three.js complain that the
        // bounding sphere radius is NaN and drops the whole mesh. Clamp them so
        // the rest of the geometry stays visible, and say how many were found.
        let badCoordinates = 0;
        for (let i = 0; i < this.vertices.length; i++) {
            if (!Number.isFinite(this.vertices[i])) {
                this.vertices[i] = 0;
                badCoordinates++;
            }
        }
        if (badCoordinates > 0) {
            console.warn(`[Tessellator] ${badCoordinates} non-finite vertex coordinate(s) in ${this.addedVertices} vertices were clamped to 0`);
        }

        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.vertices), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colors), 4));
        if (this.uv.length > 0) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
        }
        // Only carry the (fairly large) wrap attributes on meshes that use them;
        // every other mesh falls back to the shader's default generic values.
        if (this.usesTileWrap && this.tileRects.length === this.addedVertices * 4) {
            geometry.setAttribute('aTileRect', new THREE.BufferAttribute(new Float32Array(this.tileRects), 4));
            geometry.setAttribute('aWrap', new THREE.BufferAttribute(new Float32Array(this.wraps), 1));
        }

        // Create the index buffer directly at its final size. Uint16 is enough
        // for every normal section and halves the index bandwidth; only fall
        // back to 32-bit for unusually large meshes.
        const faces = this.addedVertices / 4;
        const IndexArray = this.addedVertices <= 65535 ? Uint16Array : Uint32Array;
        const index = new IndexArray(faces * 6);
        for (let i = 0, j = 0; i < faces; i++) {
            const vertex = i * 4;
            index[j++] = vertex;
            index[j++] = vertex + 2;
            index[j++] = vertex + 1;
            index[j++] = vertex;
            index[j++] = vertex + 3;
            index[j++] = vertex + 2;
        }
        geometry.setIndex(new THREE.BufferAttribute(index, 1));

        // Compute bounding sphere so Three.js knows the exact geometric center for depth sorting
        geometry.computeBoundingSphere();

        let shadows = this.getShadows();

        // Normals are only used by the lit material. Every quad contributes its
        // own vertices, so these are already flat per-face normals.
        if (this.getLit()) {
            geometry.computeVertexNormals();
        }

        // Clone the material so opaque and translucent passes maintain separate states
        let material = this.material.clone();
        material.onBeforeCompile = applyTileWrapToShader;
        material.needsUpdate = true;
        let mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        if (!inThing) group.matrixAutoUpdate = false;
        group.add(mesh);
        return mesh;
    }

    finishDrawing() {
        return this.draw();
    }

}