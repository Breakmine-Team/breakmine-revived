import * as THREE from "../../../../../../libraries/three.module.js";

export default class SignTextRenderer {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;
        this.textMeshes = new Map(); 
        this.textTextures = new Map(); 
    }

    getSignText(world, x, y, z) {
        if (!world || !world.blockInventories) {
            return null;
        }
        const key = `${x},${y},${z}`;
        const signData = world.blockInventories.get(key);
        return signData && signData.text ? signData.text : null;
    }

    createTextTexture(text) {
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        const fontRenderer = this.worldRenderer.minecraft.fontRenderer;

        const padX = 2;
        const padY = 2;
        const lineHeight = 8;

        const lines = text.split('\n');

        let maxLineWidth = 0;
        for (const line of lines) {
            let lineWidth = 0;
            for (let i = 0; i < line.length; i++) {
                lineWidth += fontRenderer.charWidths[line.charCodeAt(i)] || 6;
            }
            maxLineWidth = Math.max(maxLineWidth, lineWidth);
        }

        canvas.width = maxLineWidth + padX * 2;
        canvas.height = lines.length * lineHeight + padY * 2;

        ctx.imageSmoothingEnabled = false;

        for (let i = 0; i < lines.length; i++) {
            let lineWidth = 0;
            for (let j = 0; j < lines[i].length; j++) {
                lineWidth += fontRenderer.charWidths[lines[i].charCodeAt(j)] || 6;
            }
            const centeredX = (canvas.width - lineWidth) / 2;
            fontRenderer.drawStringRaw(ctx, lines[i], centeredX, padY + i * lineHeight, 0x000000, false, "8", false);
        }

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;

        return texture;
    }

    wrapText(text, maxWidth, fontRenderer) {
        const lines = [];
        const rawLines = text.split('\n');

        for (const rawLine of rawLines) {
            const words = rawLine.split(' ');
            let currentLine = '';

            for (const word of words) {
                const testLine = currentLine ? currentLine + ' ' + word : word;
                let lineWidth = 0;
                for (let i = 0; i < testLine.length; i++) {
                    lineWidth += fontRenderer.charWidths[testLine.charCodeAt(i)] || 6;
                }

                if (lineWidth <= maxWidth || currentLine === '') {
                    currentLine = testLine;
                } else {
                    if (currentLine) {
                        lines.push(currentLine);
                    }
                    currentLine = word;
                }
            }

            if (currentLine) {
                lines.push(currentLine);
            }
        }

        return lines;
    }

    updateSign(world, x, y, z) {
        const key = `${x},${y},${z}`;
        const text = this.getSignText(world, x, y, z);

        if (!text || text.trim() === '') {
            this.removeSign(key);
            return;
        }

        let texture = this.textTextures.get(text);
        if (!texture) {
            texture = this.createTextTexture(text);
            this.textTextures.set(text, texture);
        }

        let meshes = this.textMeshes.get(key);
        if (!meshes) {
            const frontMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                side: THREE.FrontSide
            });
            const frontGeometry = new THREE.PlaneGeometry(1, 1);
            const frontMesh = new THREE.Mesh(frontGeometry, frontMaterial);
            frontMesh.renderOrder = 0;
            this.worldRenderer.scene.add(frontMesh);

            const backMaterial = new THREE.MeshBasicMaterial({
                map: texture,
                transparent: true,
                depthTest: true,
                depthWrite: false,
                side: THREE.FrontSide
            });
            const backGeometry = new THREE.PlaneGeometry(1, 1);
            const backMesh = new THREE.Mesh(backGeometry, backMaterial);
            backMesh.renderOrder = 0;
            this.worldRenderer.scene.add(backMesh);

            meshes = [frontMesh, backMesh];
            this.textMeshes.set(key, meshes);
        } else {
            meshes[0].material.map = texture;
            meshes[1].material.map = texture;
        }

        const [frontMesh, backMesh] = meshes;

        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const xAxis = data & 1;

        const lines = text.split('\n');
        const lineHeight = 8;
        const totalTextHeight = lines.length * lineHeight;
        const worldScale = 0.012; 
        const textHeightWorld = totalTextHeight * worldScale;

        const boardCenterX = x + 0.5;
        const boardCenterY = y + 0.71875 + 0.2 - (textHeightWorld / 2); 
        const boardCenterZ = z + 0.5;
        const offset = 0.01; 

        if (xAxis) {
            frontMesh.position.set(boardCenterX, boardCenterY, z + 0.5625 + offset);
            frontMesh.rotation.y = 0; 

            backMesh.position.set(boardCenterX, boardCenterY, z + 0.4375 - offset);
            backMesh.rotation.y = Math.PI; 
        } else {
            frontMesh.position.set(x + 0.5625 + offset, boardCenterY, boardCenterZ);
            frontMesh.rotation.y = Math.PI / 2; 

            backMesh.position.set(x + 0.4375 - offset, boardCenterY, boardCenterZ);
            backMesh.rotation.y = -Math.PI / 2; 
        }

        frontMesh.scale.set(
            texture.image.width * worldScale,
            texture.image.height * worldScale,
            1
        );
        backMesh.scale.set(
            texture.image.width * worldScale,
            texture.image.height * worldScale,
            1
        );

        frontMesh.visible = true;
        backMesh.visible = true;
    }

    removeSign(key) {
        const meshes = this.textMeshes.get(key);
        if (meshes) {
            const [frontMesh, backMesh] = meshes;
            if (frontMesh) {
                this.worldRenderer.scene.remove(frontMesh);
                frontMesh.geometry.dispose();
                frontMesh.material.dispose();
            }
            if (backMesh) {
                this.worldRenderer.scene.remove(backMesh);
                backMesh.geometry.dispose();
                backMesh.material.dispose();
            }
            this.textMeshes.delete(key);
        }
    }

    updateAllSigns(world) {
        if (!world) return;

        for (const [key, meshes] of this.textMeshes) {
            const [frontMesh, backMesh] = meshes;
            if (frontMesh) {
                this.worldRenderer.scene.remove(frontMesh);
                frontMesh.geometry.dispose();
                frontMesh.material.dispose();
            }
            if (backMesh) {
                this.worldRenderer.scene.remove(backMesh);
                backMesh.geometry.dispose();
                backMesh.material.dispose();
            }
        }
        this.textMeshes.clear();

        const provider = world.getChunkProvider();
        const chunks = provider.getChunks();
        
        for (const [index, chunk] of chunks) {
            const chunkX = chunk.x * 16;
            const chunkZ = chunk.z * 16;

            for (let x = 0; x < 16; x++) {
                for (let y = 0; y < chunk.sections.length * 16; y++) {
                    for (let z = 0; z < 16; z++) {
                        const worldX = chunkX + x;
                        const worldZ = chunkZ + z;
                        const blockId = chunk.getBlockAt(x, y, z);
                        
                        if (blockId === 121) { 
                            this.updateSign(world, worldX, y, worldZ);
                        }
                    }
                }
            }
        }
    }

    clear() {
        for (const [key, meshes] of this.textMeshes) {
            const [frontMesh, backMesh] = meshes;
            if (frontMesh) {
                this.worldRenderer.scene.remove(frontMesh);
                frontMesh.geometry.dispose();
                frontMesh.material.dispose();
            }
            if (backMesh) {
                this.worldRenderer.scene.remove(backMesh);
                backMesh.geometry.dispose();
                backMesh.material.dispose();
            }
        }
        this.textMeshes.clear();
        this.textTextures.clear();
    }
}
