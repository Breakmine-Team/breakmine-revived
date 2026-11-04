import * as THREE from "../../../../../../libraries/three.module.js";

export default class TranslucentMeshBatcher {
    constructor(scene, material) {
        this.maxVertices = 500000; 
        this.maxIndices = this.maxVertices * 1.5;

        this.positions = new Float32Array(this.maxVertices * 3);
        this.colors = new Float32Array(this.maxVertices * 4);
        this.uvs = new Float32Array(this.maxVertices * 2);
        this.indices = new Uint32Array(this.maxIndices);
        this.sortedIndices = new Uint32Array(this.maxIndices);

        this.faces = new Array(this.maxIndices / 6);
        for (let i = 0; i < this.faces.length; i++) {
            this.faces[i] = { start: 0, dist: 0 };
        }

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 4).setUsage(THREE.DynamicDrawUsage));
        this.geometry.setAttribute('uv', new THREE.BufferAttribute(this.uvs, 2).setUsage(THREE.DynamicDrawUsage));

        this.indexAttribute = new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setIndex(this.indexAttribute);

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 9999;
        scene.add(this.mesh);

        this.currentVertex = 0;
        this.currentIndex = 0;
    }

    clear() {
        this.currentVertex = 0;
        this.currentIndex = 0;
    }

    addMesh(chunkMesh) {
        let geo = chunkMesh.geometry;
        let posAttr = geo.getAttribute('position');
        let colAttr = geo.getAttribute('color');
        let uvAttr = geo.getAttribute('uv');
        let idxAttr = geo.getIndex();

        if (!posAttr || !idxAttr) return;

        // Copy texture map from source mesh material if not set yet
        if (!this.mesh.material.map && chunkMesh.material && chunkMesh.material.map) {
            this.mesh.material.map = chunkMesh.material.map;
            this.mesh.material.needsUpdate = true;
        }

        let vertexCount = posAttr.count;
        let indexCount = idxAttr.count;

        if (this.currentVertex + vertexCount > this.maxVertices || 
            this.currentIndex + indexCount > this.maxIndices) {
            console.warn("TranslucentMeshBatcher overflow!");
            return;
        }

        // Ensure world matrix is up-to-date (newly rebuilt meshes have identity matrixWorld)
        chunkMesh.updateWorldMatrix(true, false);
        let mx = chunkMesh.matrixWorld.elements[12];
        let my = chunkMesh.matrixWorld.elements[13];
        let mz = chunkMesh.matrixWorld.elements[14];

        let vOffset = this.currentVertex;
        let iOffset = this.currentIndex;

        // 1. Copy positions into WORLD space
        for (let i = 0; i < vertexCount; i++) {
            let dstIdx = (vOffset + i) * 3;
            this.positions[dstIdx]     = posAttr.getX(i) + mx;
            this.positions[dstIdx + 1] = posAttr.getY(i) + my;
            this.positions[dstIdx + 2] = posAttr.getZ(i) + mz;
        }

        // 2. Copy colors (RGBA)
        if (colAttr) {
            let srcSize = colAttr.itemSize;
            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 4;
                this.colors[dstIdx]     = colAttr.getX(i);
                this.colors[dstIdx + 1] = colAttr.getY(i);
                this.colors[dstIdx + 2] = colAttr.getZ(i);
                this.colors[dstIdx + 3] = srcSize >= 4 ? colAttr.getW(i) : 1;
            }
        }

        // 3. Copy UVs
        if (uvAttr) {
            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 2;
                this.uvs[dstIdx]     = uvAttr.getX(i);
                this.uvs[dstIdx + 1] = uvAttr.getY(i);
            }
        } else {
            // Default UVs for untextured geometry
            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 2;
                this.uvs[dstIdx]     = 0;
                this.uvs[dstIdx + 1] = 0;
            }
        }

        // 4. Copy indices, offsetting them
        for (let i = 0; i < indexCount; i++) {
            this.indices[iOffset + i] = idxAttr.getX(i) + vOffset;
        }

        this.currentVertex += vertexCount;
        this.currentIndex += indexCount;
    }

    finalize(cameraPos) {
        let hasData = this.currentVertex > 0;
        this.mesh.visible = hasData;

        if (!hasData) return;

        let faceCount = this.currentIndex / 6;
        if (faceCount === 0) return;

        for (let i = 0; i < faceCount; i++) {
            let idx = i * 6;

            let v0 = this.indices[idx];
            let v1 = this.indices[idx + 2];
            let v2 = this.indices[idx + 1];
            let v3 = this.indices[idx + 4];

            let cx = (this.positions[v0 * 3]     + this.positions[v1 * 3]     + this.positions[v2 * 3]     + this.positions[v3 * 3])     * 0.25;
            let cy = (this.positions[v0 * 3 + 1] + this.positions[v1 * 3 + 1] + this.positions[v2 * 3 + 1] + this.positions[v3 * 3 + 1]) * 0.25;
            let cz = (this.positions[v0 * 3 + 2] + this.positions[v1 * 3 + 2] + this.positions[v2 * 3 + 2] + this.positions[v3 * 3 + 2]) * 0.25;

            let dx = cx - cameraPos.x;
            let dy = cy - cameraPos.y;
            let dz = cz - cameraPos.z;

            this.faces[i].start = idx;
            this.faces[i].dist = dx * dx + dy * dy + dz * dz;
        }

        let sortedFaces = this.faces.slice(0, faceCount);
        sortedFaces.sort((a, b) => b.dist - a.dist);

        for (let i = 0; i < faceCount; i++) {
            let src = sortedFaces[i].start;
            let dst = i * 6;

            this.sortedIndices[dst]     = this.indices[src];
            this.sortedIndices[dst + 1] = this.indices[src + 1];
            this.sortedIndices[dst + 2] = this.indices[src + 2];
            this.sortedIndices[dst + 3] = this.indices[src + 3];
            this.sortedIndices[dst + 4] = this.indices[src + 4];
            this.sortedIndices[dst + 5] = this.indices[src + 5];
        }

        this.indexAttribute.array.set(this.sortedIndices.subarray(0, this.currentIndex));
        this.indexAttribute.needsUpdate = true;

        let posAttr = this.geometry.getAttribute('position');
        posAttr.updateRange.offset = 0;
        posAttr.updateRange.count = this.currentVertex * 3;
        posAttr.needsUpdate = true;

        let colAttr = this.geometry.getAttribute('color');
        colAttr.updateRange.offset = 0;
        colAttr.updateRange.count = this.currentVertex * 4;
        colAttr.needsUpdate = true;

        let uvAttr = this.geometry.getAttribute('uv');
        uvAttr.updateRange.offset = 0;
        uvAttr.updateRange.count = this.currentVertex * 2;
        uvAttr.needsUpdate = true;

        this.geometry.setDrawRange(0, this.currentIndex);
    }
}
