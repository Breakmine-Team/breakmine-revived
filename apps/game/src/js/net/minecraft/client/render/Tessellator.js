import * as THREE from "../../../../../../libraries/three.module.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";
import { getLiquidBlockCornerHeights } from "./LiquidMeshHelper.js";

export default class Tessellator {

    constructor() {
        this.material = new THREE.MeshBasicMaterial({
            side: THREE.FrontSide,
            transparent: true,
            depthTest: true,
            depthWrite: true,
            vertexColors: true
        });

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
    }

    bindTexture(texture) {
        this.material.map = texture;
    }

    startDrawing() {
        this.addedVertices = 0;
        this.vertices = [];
        this.uv = [];
        this.colors = [];
        this.clearRotation();
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
    }

    // Rotate a model so it mounts on one of the six block faces. The model is
    // authored in "floor" orientation (base against the -Y face, handle
    // pointing +Y); with a pivot at the block center, rotating around it keeps
    // the base flush against the selected face.
    setRotation(pivotX, pivotY, pivotZ, faceIndex) {
        this.rotationPivot = [pivotX, pivotY, pivotZ];
        this.rotationFace = faceIndex;
    }

    clearRotation() {
        this.rotationPivot = null;
        this.rotationFace = null;
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
        let geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.vertices), 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.colors), 4));
        if (this.uv.length > 0) {
            geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
        }

        // Create index array
        let index = [];
        let verticesPerFace = 4;
        for (let i = 0; i < this.addedVertices / verticesPerFace; i++) {
            index.push(i * verticesPerFace + 0);
            index.push(i * verticesPerFace + 2);
            index.push(i * verticesPerFace + 1);
            index.push(i * verticesPerFace + 0);
            index.push(i * verticesPerFace + 3);
            index.push(i * verticesPerFace + 2);
        }
        geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(index), 1));

        // Compute bounding sphere so Three.js knows the exact geometric center for depth sorting
        geometry.computeBoundingSphere();

        // Clone the material so opaque and translucent passes maintain separate states
        let mesh = new THREE.Mesh(geometry, this.material.clone());
        if (!inThing) group.matrixAutoUpdate = false;
        group.add(mesh);
        return mesh;
    }

    finishDrawing() {
        return this.draw();
    }

}