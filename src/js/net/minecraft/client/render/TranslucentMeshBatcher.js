import * as THREE from "../../../../../../libraries/three.module.js";

export default class TranslucentMeshBatcher {
    constructor(scene, material) {
        this.maxVertices = 500000; 
        this.maxIndices = this.maxVertices * 1.5;

        this.positions = new Float32Array(this.maxVertices * 3);
        this.colors = new Float32Array(this.maxVertices * 4);
        this.uvs = new Float32Array(this.maxVertices * 2);
        this.normals = new Float32Array(this.maxVertices * 3);
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
        this.geometry.setAttribute('normal', new THREE.BufferAttribute(this.normals, 3).setUsage(THREE.DynamicDrawUsage));

        this.indexAttribute = new THREE.BufferAttribute(this.indices, 1).setUsage(THREE.DynamicDrawUsage);
        this.geometry.setIndex(this.indexAttribute);

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 9999;
        this.mesh.userData.isTranslucent = true;
        this.mesh.castShadow = false;
        this.mesh.receiveShadow = true;
        scene.add(this.mesh);

        this.currentVertex = 0;
        this.currentIndex = 0;

        this.sources = [];
        this.sourceCount = 0;
        this.cachedSources = [];
        this.cachedSourceCount = 0;
        this.cachedCameraX = NaN;
        this.cachedCameraY = NaN;
        this.cachedCameraZ = NaN;
        this.cachedVisible = false;
        this.cacheValid = false;
    }

    
    static rawArray(attribute) {
        return attribute && !attribute.isInterleavedBufferAttribute && attribute.array
            ? attribute.array
            : null;
    }

    clear() {
        this.currentVertex = 0;
        this.currentIndex = 0;
        this.sourceCount = 0;
    }

    
    addMesh(chunkMesh) {
        this.sources[this.sourceCount] = chunkMesh;
        this.sourceCount++;
    }

    
    invalidate() {
        this.cacheValid = false;
    }

    isCached(cameraX, cameraY, cameraZ) {
        if (!this.cacheValid) return false;
        if (this.sourceCount !== this.cachedSourceCount) return false;
        if (this.cachedCameraX !== cameraX
            || this.cachedCameraY !== cameraY
            || this.cachedCameraZ !== cameraZ) return false;

        for (let i = 0; i < this.sourceCount; i++) {
            if (this.sources[i] !== this.cachedSources[i]) return false;
        }
        return true;
    }

    copyMesh(chunkMesh) {
        let geo = chunkMesh.geometry;
        let posAttr = geo.getAttribute('position');
        let idxAttr = geo.getIndex();

        if (!posAttr || !idxAttr) return;

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

        chunkMesh.updateWorldMatrix(true, false);

        const m = chunkMesh.matrixWorld.elements;

        const pureTranslation = m[0] === 1 && m[5] === 1 && m[10] === 1
            && m[1] === 0 && m[2] === 0 && m[4] === 0
            && m[6] === 0 && m[8] === 0 && m[9] === 0;

        let vOffset = this.currentVertex;
        let iOffset = this.currentIndex;

        const posArray = TranslucentMeshBatcher.rawArray(posAttr);
        const tx = m[12];
        const ty = m[13];
        const tz = m[14];

        if (pureTranslation) {
            for (let i = 0; i < vertexCount; i++) {
                const src = i * 3;
                const dst = (vOffset + i) * 3;
                if (posArray) {
                    this.positions[dst]     = posArray[src]     + tx;
                    this.positions[dst + 1] = posArray[src + 1] + ty;
                    this.positions[dst + 2] = posArray[src + 2] + tz;
                } else {
                    this.positions[dst]     = posAttr.getX(i) + tx;
                    this.positions[dst + 1] = posAttr.getY(i) + ty;
                    this.positions[dst + 2] = posAttr.getZ(i) + tz;
                }
            }
        } else {
            for (let i = 0; i < vertexCount; i++) {
                const src = i * 3;
                const dst = (vOffset + i) * 3;
                const lx = posArray ? posArray[src]     : posAttr.getX(i);
                const ly = posArray ? posArray[src + 1] : posAttr.getY(i);
                const lz = posArray ? posArray[src + 2] : posAttr.getZ(i);
                this.positions[dst]     = m[0] * lx + m[4] * ly + m[8]  * lz + tx;
                this.positions[dst + 1] = m[1] * lx + m[5] * ly + m[9]  * lz + ty;
                this.positions[dst + 2] = m[2] * lx + m[6] * ly + m[10] * lz + tz;
            }
        }

        let colAttr = geo.getAttribute('color');
        if (colAttr) {
            const colArray = TranslucentMeshBatcher.rawArray(colAttr);
            const srcSize = colAttr.itemSize;
            const hasAlpha = srcSize >= 4;

            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 4;
                if (colArray) {
                    const src = i * srcSize;
                    this.colors[dstIdx]     = colArray[src];
                    this.colors[dstIdx + 1] = colArray[src + 1];
                    this.colors[dstIdx + 2] = colArray[src + 2];
                    this.colors[dstIdx + 3] = hasAlpha ? colArray[src + 3] : 1;
                } else {
                    this.colors[dstIdx]     = colAttr.getX(i);
                    this.colors[dstIdx + 1] = colAttr.getY(i);
                    this.colors[dstIdx + 2] = colAttr.getZ(i);
                    this.colors[dstIdx + 3] = hasAlpha ? colAttr.getW(i) : 1;
                }
            }
        }

        let uvAttr = geo.getAttribute('uv');
        if (uvAttr) {
            const uvArray = TranslucentMeshBatcher.rawArray(uvAttr);
            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 2;
                if (uvArray) {
                    const src = i * 2;
                    this.uvs[dstIdx]     = uvArray[src];
                    this.uvs[dstIdx + 1] = uvArray[src + 1];
                } else {
                    this.uvs[dstIdx]     = uvAttr.getX(i);
                    this.uvs[dstIdx + 1] = uvAttr.getY(i);
                }
            }
        } else {
            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 2;
                this.uvs[dstIdx]     = 0;
                this.uvs[dstIdx + 1] = 0;
            }
        }

        let nrmAttr = geo.getAttribute('normal');
        const nrmArray = nrmAttr ? TranslucentMeshBatcher.rawArray(nrmAttr) : null;

        if (nrmAttr && pureTranslation) {
            for (let i = 0; i < vertexCount; i++) {
                const dstIdx = (vOffset + i) * 3;
                if (nrmArray) {
                    const src = i * 3;
                    this.normals[dstIdx]     = nrmArray[src];
                    this.normals[dstIdx + 1] = nrmArray[src + 1];
                    this.normals[dstIdx + 2] = nrmArray[src + 2];
                } else {
                    this.normals[dstIdx]     = nrmAttr.getX(i);
                    this.normals[dstIdx + 1] = nrmAttr.getY(i);
                    this.normals[dstIdx + 2] = nrmAttr.getZ(i);
                }
            }
        } else if (nrmAttr) {
            for (let i = 0; i < vertexCount; i++) {
                const dstIdx = (vOffset + i) * 3;
                const lx = nrmArray ? nrmArray[i * 3]     : nrmAttr.getX(i);
                const ly = nrmArray ? nrmArray[i * 3 + 1] : nrmAttr.getY(i);
                const lz = nrmArray ? nrmArray[i * 3 + 2] : nrmAttr.getZ(i);
                let nx = m[0] * lx + m[4] * ly + m[8]  * lz;
                let ny = m[1] * lx + m[5] * ly + m[9]  * lz;
                let nz = m[2] * lx + m[6] * ly + m[10] * lz;
                const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len > 0) { nx /= len; ny /= len; nz /= len; }
                this.normals[dstIdx]     = nx;
                this.normals[dstIdx + 1] = ny;
                this.normals[dstIdx + 2] = nz;
            }
        } else {
            for (let i = 0; i < vertexCount; i++) {
                let dstIdx = (vOffset + i) * 3;
                this.normals[dstIdx]     = 0;
                this.normals[dstIdx + 1] = 1;
                this.normals[dstIdx + 2] = 0;
            }

            const idxArray = TranslucentMeshBatcher.rawArray(idxAttr);
            for (let t = 0; t + 2 < indexCount; t += 3) {
                let ia = vOffset + (idxArray ? idxArray[t]     : idxAttr.getX(t));
                let ib = vOffset + (idxArray ? idxArray[t + 1] : idxAttr.getX(t + 1));
                let ic = vOffset + (idxArray ? idxArray[t + 2] : idxAttr.getX(t + 2));

                let abx = this.positions[ib * 3] - this.positions[ia * 3];
                let aby = this.positions[ib * 3 + 1] - this.positions[ia * 3 + 1];
                let abz = this.positions[ib * 3 + 2] - this.positions[ia * 3 + 2];
                let acx = this.positions[ic * 3] - this.positions[ia * 3];
                let acy = this.positions[ic * 3 + 1] - this.positions[ia * 3 + 1];
                let acz = this.positions[ic * 3 + 2] - this.positions[ia * 3 + 2];

                let nx = aby * acz - abz * acy;
                let ny = abz * acx - abx * acz;
                let nz = abx * acy - aby * acx;
                let len = Math.sqrt(nx * nx + ny * ny + nz * nz);
                if (len === 0) continue;
                nx /= len; ny /= len; nz /= len;

                for (let v of [ia, ib, ic]) {
                    this.normals[v * 3]     = nx;
                    this.normals[v * 3 + 1] = ny;
                    this.normals[v * 3 + 2] = nz;
                }
            }
        }

        const idxArray = TranslucentMeshBatcher.rawArray(idxAttr);
        if (idxArray) {
            for (let i = 0; i < indexCount; i++) {
                this.indices[iOffset + i] = idxArray[i] + vOffset;
            }
        } else {
            for (let i = 0; i < indexCount; i++) {
                this.indices[iOffset + i] = idxAttr.getX(i) + vOffset;
            }
        }

        this.currentVertex += vertexCount;
        this.currentIndex += indexCount;
    }

    finalize(cameraPos) {
        const cameraX = cameraPos.x;
        const cameraY = cameraPos.y;
        const cameraZ = cameraPos.z;

        if (this.isCached(cameraX, cameraY, cameraZ)) {
            this.mesh.visible = this.cachedVisible;
            return;
        }

        this.currentVertex = 0;
        this.currentIndex = 0;

        for (let i = 0; i < this.sourceCount; i++) {
            this.copyMesh(this.sources[i]);
        }

        this.cachedSourceCount = this.sourceCount;
        this.cachedSources.length = this.sourceCount;
        for (let i = 0; i < this.sourceCount; i++) {
            this.cachedSources[i] = this.sources[i];
        }
        this.cachedCameraX = cameraX;
        this.cachedCameraY = cameraY;
        this.cachedCameraZ = cameraZ;

        let hasData = this.currentVertex > 0;
        this.cachedVisible = hasData;
        this.mesh.visible = hasData;
        this.cacheValid = true;

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
