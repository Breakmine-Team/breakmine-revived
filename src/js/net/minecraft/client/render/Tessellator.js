import * as THREE from "../../../../../../libraries/three.module.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import { getLiquidBlockCornerHeights } from "./LiquidMeshHelper.js";

// Shared by every compiled material, so one write per frame updates all of the
// water shaders (chunk batches, off-grid fields and item previews alike).
export const waterUniforms = {
    uWaterTime: { value: 0 },
    uWaterReflectivity: { value: 0 },
    uWaterWaviness: { value: 0 },
    uWaterSkyColor: { value: new THREE.Color(0x000000) },
    // Direction from the world towards the sun, written each frame while the
    // sky is drawn. The sun glint needs it to know where to sparkle.
    uWaterSunDir: { value: new THREE.Vector3(0, 1, 0) },
    // three only uploads its own cameraPosition for phong/standard/shader
    // materials, so Lambert water would otherwise read it as (0,0,0) and get a
    // meaningless view direction.
    uWaterCameraPos: { value: new THREE.Vector3() }
};

export function applyTileWrapToShader(shader) {
    shader.uniforms.uWaterTime = waterUniforms.uWaterTime;
    shader.uniforms.uWaterReflectivity = waterUniforms.uWaterReflectivity;
    shader.uniforms.uWaterWaviness = waterUniforms.uWaterWaviness;
    shader.uniforms.uWaterSkyColor = waterUniforms.uWaterSkyColor;
    shader.uniforms.uWaterSunDir = waterUniforms.uWaterSunDir;
    shader.uniforms.uWaterCameraPos = waterUniforms.uWaterCameraPos;

    shader.vertexShader = shader.vertexShader
        .replace(
            '#include <uv_pars_vertex>',
            '#include <uv_pars_vertex>\nuniform vec3 uWaterCameraPos;\nattribute vec4 aTileRect;\nattribute float aWrap;\nattribute float aBlockLight;\nattribute float aWater;\nvarying vec4 vTileRect;\nvarying float vWrap;\nvarying float vBlockLight;\nvarying float vWater;\nvarying vec3 vWaterPos;\nvarying vec3 vWaterView;\nvarying vec3 vWaterNormal;'
        )
        .replace(
            '#include <uv_vertex>',
            '#include <uv_vertex>\n\tvTileRect = aTileRect;\n\tvWrap = aWrap;\n\tvBlockLight = aBlockLight;\n\tvWater = aWater;\n\tvWaterPos = ( modelMatrix * vec4( position, 1.0 ) ).xyz;\n\tvWaterView = normalize( uWaterCameraPos - vWaterPos );\n\tvec3 waterNormalWorld = mat3( modelMatrix ) * normal;\n\tfloat waterNormalLength = length( waterNormalWorld );\n\tvWaterNormal = waterNormalLength > 0.0001 ? waterNormalWorld / waterNormalLength : vec3( 0.0, 1.0, 0.0 );'
        );

    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <uv_pars_fragment>',
        '#include <uv_pars_fragment>\nuniform float uWaterTime;\nuniform float uWaterReflectivity;\nuniform float uWaterWaviness;\nuniform vec3 uWaterSkyColor;\nuniform vec3 uWaterSunDir;\nvarying vec4 vTileRect;\nvarying float vWrap;\nvarying float vBlockLight;\nvarying float vWater;\nvarying vec3 vWaterPos;\nvarying vec3 vWaterView;\nvarying vec3 vWaterNormal;'
    );

    // Only shaded (lambert) materials have a direct light term to restore, so
    // the emitter lift is skipped for the unlit material.
    if (shader.fragmentShader.indexOf('vLightFront') !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(
            '#include <output_fragment>',
            `// Light from torches, glowstone and lava is already baked into the vertex
	// colours, but the sun's shadow map only removes the direct sunlight, so a
	// lit-up area in shade would fall back to ambient alone. vLightFront is
	// exactly the direct term that getShadowMask() takes away, so adding the
	// removed share back for emitters keeps torch-lit ground bright in shadow
	// without making it brighter than it is in the sun.
	outgoingLight += BRDF_Lambert( diffuseColor.rgb ) * vBlockLight * ( 1.0 - getShadowMask() ) * vLightFront;
#include <output_fragment>`
        );
    }

    shader.fragmentShader = shader.fragmentShader
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
	// Water drifts: slide the sampled spot around inside the block's own tile
	// with a pair of travelling waves, so the surface ripples instead of sitting
	// still. The offset is computed per fragment from the world position, which
	// keeps neighbouring blocks in phase and hides the quad seams.
	if ( vWater > 0.5 && uWaterWaviness > 0.0 && vTileRect.z > 0.0 && vTileRect.w > 0.0 ) {
		vec2 ripple = vec2(
			sin( vWaterPos.x * 0.9 + vWaterPos.z * 0.5 + uWaterTime * 1.7 ),
			cos( vWaterPos.x * 0.7 - vWaterPos.z * 1.1 + uWaterTime * 1.3 )
		);
		vec2 shift = ripple * ( uWaterWaviness * vTileRect.zw * ( 1.0 / 16.0 ) );
		wrappedUv = vTileRect.xy + fract( ( wrappedUv - vTileRect.xy + shift ) / vTileRect.zw ) * vTileRect.zw;
	}
	vec4 sampledDiffuseColor = texture2D( map, wrappedUv );
	#ifdef DECODE_VIDEO_TEXTURE
		sampledDiffuseColor = vec4( mix( pow( sampledDiffuseColor.rgb * 0.9478672986 + vec3( 0.0521327014 ), vec3( 2.4 ) ), sampledDiffuseColor.rgb * 0.0773993808, vec3( lessThanEqual( sampledDiffuseColor.rgb, vec3( 0.04045 ) ) ) ), sampledDiffuseColor.w );
	#endif
	diffuseColor *= sampledDiffuseColor;
#endif`
        );

    // Sky reflection. There is no reflection pass to sample, so water mirrors the
    // current sky colour and fades between the plain shaded surface and that
    // colour with a fresnel term: almost a mirror at grazing angles, barely
    // reflective when looked at straight down.
    shader.fragmentShader = shader.fragmentShader.replace(
        '#include <output_fragment>',
        `if ( vWater > 0.5 && uWaterReflectivity > 0.0 ) {
	float fresnel = pow( 1.0 - abs( vWaterView.y ), 5.0 );
	float reflection = clamp( uWaterReflectivity, 0.0, 1.0 ) * ( 0.15 + 0.85 * fresnel );
	outgoingLight = mix( outgoingLight, uWaterSkyColor, reflection );

	// Sun glint: the water brightens where the mirrored view direction lines up
	// with the sun, which is what puts the bright streak on the reflection.
	// uWaterSunDir points from the world to the sun, so after sunset it faces
	// down and the glint switches itself off.
	if ( uWaterSunDir.y > 0.0 && vWaterNormal.y > 0.35 ) {
		vec3 sunDir = normalize( uWaterSunDir );
		vec3 viewDir = normalize( vWaterView );
		// The ripples above are only a UV slide, so tilt the surface normal with
		// the same waves and the highlight drifts and breaks up on the water.
		vec3 waveNormal = normalize( vec3(
			cos( vWaterPos.x * 0.9 + vWaterPos.z * 0.5 + uWaterTime * 1.7 ) * 0.9 * uWaterWaviness,
			1.0,
			-sin( vWaterPos.x * 0.7 - vWaterPos.z * 1.1 + uWaterTime * 1.3 ) * 1.1 * uWaterWaviness
		) );
		float sunDot = max( dot( reflect( -viewDir, waveNormal ), sunDir ), 0.0 );
		float glint = pow( sunDot, 180.0 ) * 1.6 + pow( sunDot, 24.0 ) * 0.18;
		glint *= smoothstep( 0.0, 0.15, uWaterSunDir.y ) * clamp( uWaterReflectivity, 0.0, 1.0 );
		outgoingLight += vec3( 1.0, 0.97, 0.88 ) * glint;
	}
}
#include <output_fragment>`
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

        this.isTranslucentPass = false;

        this.blockLight = 0;
        this.blockLights = [];

        this.water = 0;
        this.waters = [];
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
        this.isTranslucentPass = false;
        this.blockLights.length = 0;
        this.blockLight = 0;
        this.waters.length = 0;
        this.water = 0;
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

    // Normalised light emitted by nearby blocks (torches, glowstone, lava),
    // stored per vertex so the shader can restore it inside sun shadows.
    setBlockLight(light) {
        let value = Number(light);
        this.blockLight = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
    }

    // Marks the following vertices as a liquid surface, which opts them into the
    // rippling and reflective water shading.
    setWaterSurface(isWater) {
        this.water = isWater ? 1 : 0;
    }

    setRenderingPass(isTransparent) {
        this.isTranslucentPass = isTransparent === true;
        this.material.transparent = isTransparent;
        this.material.depthWrite = !isTransparent;
        // Opaque leaves use a cutout texture, so the depth-writing pass still
        // needs alpha testing to discard their transparent pixels.
        this.material.alphaTest = isTransparent ? 0 : 0.5;
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
        this.blockLights.push(this.blockLight);
        this.waters.push(this.water);

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
        if (this.getShadows() && this.blockLights.length === this.addedVertices) {
            geometry.setAttribute('aBlockLight', new THREE.BufferAttribute(new Float32Array(this.blockLights), 1));
        }
        if (this.waters.length === this.addedVertices) {
            geometry.setAttribute('aWater', new THREE.BufferAttribute(new Float32Array(this.waters), 1));
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

        if (this.getLit()) {
            geometry.computeVertexNormals();
        }

        let material = Tessellator.applyTileWrap(this.material.clone());

        // Blended geometry is drawn without depth writes, so it has to stay out
        // of the shadow map entirely: cutout quads (flowers, doors, rails) would
        // cast solid square shadows over everything, and sampling the shadow map
        // on a transparent surface renders it black.
        let translucent = this.isTranslucentPass;
        let shadows = this.getShadows() && !translucent;

        let mesh = new THREE.Mesh(geometry, material);
        mesh.castShadow = shadows;
        mesh.receiveShadow = shadows;
        if (translucent) {
            mesh.userData.isTranslucent = true;
        }
        if (!inThing) group.matrixAutoUpdate = false;
        group.add(mesh);
        return mesh;
    }

    finishDrawing() {
        return this.draw();
    }

}