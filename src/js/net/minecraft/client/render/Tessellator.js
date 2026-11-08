import * as THREE from "../../../../../../libraries/three.module.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import { getLiquidBlockCornerHeights } from "./LiquidMeshHelper.js";

export function applyTileWrapToShader(shader) {
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

    static shadows = true;
    static dynamicLights = false;

    constructor() {
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

        this.litMaterial.onBeforeCompile = applyTileWrapToShader;
        this.unlitMaterial.onBeforeCompile = applyTileWrapToShader;

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

    get material() {
        return this.getLit() ? this.litMaterial : this.unlitMaterial;
    }

    setShadows(enabled) {
        this.shadows = enabled === null ? null : !!enabled;
    }

    static setShadowsEnabled(enabled) {
        Tessellator.shadows = !!enabled;
    }

    static setDynamicLightsEnabled(enabled) {
        Tessellator.dynamicLights = !!enabled;
    }

    getShadows() {
        return this.shadows === null ? Tessellator.shadows : this.shadows;
    }

    getLit() {
        return this.getShadows() || Tessellator.dynamicLights;
    }

    
    static applyTileWrap(material) {
        if (!material) return material;
        material.onBeforeCompile = applyTileWrapToShader;
        material.needsUpdate = true;
        return material;
    }

    bindTexture(texture) {
        this.litMaterial.map = texture;
        this.unlitMaterial.map = texture;
    }

    startDrawing() {
        this.addedVertices = 0;
        this.vertices.length = 0;
        this.uv.length = 0;
        this.colors.length = 0;
        this.tileRects.length = 0;
        this.wraps.length = 0;
        this.tileWrap = null;
        this.tileWrapFlags = 0;
        this.usesTileWrap = false;
        this.clearRotation();
    }

    setTileWrap(rect) {
        if (rect !== null && !this.usesTileWrap) {
            const missing = this.addedVertices * 4 - this.tileRects.length;
            for (let i = 0; i < missing; i += 4) {
                this.tileRects.push(0, 0, 1, 1);
                this.wraps.push(0);
            }
            this.usesTileWrap = true;
        }

        this.tileWrap = rect;
        this.tileWrapFlags = rect === null ? 0 : (rect[4] === undefined ? 1 : rect[4]);
    }

    setDepthWrite(value) {
    }

    setRenderingPass(isTransparent) {
        this.material.transparent = isTransparent;
        this.material.depthWrite = !isTransparent;
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

        if (this.partRotationPivot !== null) {
            let turned = rotatePoint(x, y, z, this.partRotationPivot, this.partRotationAngles);
            x = turned[0];
            y = turned[1];
            z = turned[2];
        }

        if (this.rotationPivot !== null) {
            let rotated = this.rotate(x, y, z);
            x = rotated[0];
            y = rotated[1];
            z = rotated[2];
        }

        this.vertices.push(x);
        this.vertices.push(y);
        this.vertices.push(z);

        this.colors.push(this.red);
        this.colors.push(this.green);
        this.colors.push(this.blue);
        this.colors.push(this.alpha);

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

    setRotation(pivotX, pivotY, pivotZ, faceIndex) {
        this.rotationPivot = [pivotX, pivotY, pivotZ];
        this.rotationFace = faceIndex;
    }

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

    setPartRotation(pivotX, pivotY, pivotZ, angleX, angleY, angleZ) {
        this.partRotationPivot = [pivotX, pivotY, pivotZ];
        this.partRotationAngles = [angleX, angleY, angleZ];
    }

    clearPartRotation() {
        this.partRotationPivot = null;
        this.partRotationAngles = null;
    }

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

        this.uv.push(u);
        this.uv.push(v);
    }

    
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
        if (this.usesTileWrap && this.tileRects.length === this.addedVertices * 4) {
            geometry.setAttribute('aTileRect', new THREE.BufferAttribute(new Float32Array(this.tileRects), 4));
            geometry.setAttribute('aWrap', new THREE.BufferAttribute(new Float32Array(this.wraps), 1));
        }

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

        geometry.computeBoundingSphere();

        let shadows = this.getShadows();

        if (this.getLit()) {
            geometry.computeVertexNormals();
        }

        let material = Tessellator.applyTileWrap(this.material.clone());
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