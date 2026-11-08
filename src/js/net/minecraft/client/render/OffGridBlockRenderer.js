import Block from "../world/block/Block.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import * as THREE from "../../../../../../libraries/three.module.js";

export default class OffGridBlockRenderer {

    constructor(world, minecraft) {
        this.world = world;
        this.minecraft = minecraft;

        this.group = new THREE.Object3D();
        this.group.updateMatrix();
        this.group.matrixAutoUpdate = false;
    }

    
    getBlockAt(blockX, blockY, blockZ) {
        const world = this.getWorld();
        if (!world) return 0;
        if (typeof world.chunkExists === 'function' && !world.chunkExists(blockX >> 4, blockZ >> 4)) {
            return 0;
        }
        return world.getBlockAt(blockX, blockY, blockZ) || 0;
    }

    
    getBlockDataAt(blockX, blockY, blockZ) {
        const world = this.getWorld();
        if (!world) return 0;
        if (typeof world.chunkExists === 'function' && !world.chunkExists(blockX >> 4, blockZ >> 4)) {
            return 0;
        }
        return world.getBlockDataAt(blockX, blockY, blockZ) || 0;
    }

    
    render(blockX, blockY, blockZ, renderX, renderY, renderZ, blockOverride = null) {
        let block = this.resolveBlock(blockOverride);
        let sourceData = 0;

        if (!block) {
            const blockId = this.getBlockAt(blockX, blockY, blockZ);
            if (!blockId) return null;
            block = Block.getById(blockId) || BlockRegistry.get(blockId);
            if (!block) return null;
            sourceData = this.getBlockDataAt(blockX, blockY, blockZ);
        }

        const mesh = this.renderResolved(block, sourceData, renderX, renderY, renderZ);
        return mesh ? { block, mesh } : null;
    }

    
    renderBlock(block, renderX, renderY, renderZ, sourceData = 0) {
        block = this.resolveBlock(block);
        if (!block) return null;
        const mesh = this.renderResolved(block, sourceData, renderX, renderY, renderZ);
        return mesh ? { block, mesh } : null;
    }

    
    clear() {
        for (const child of [...this.group.children]) {
            this.group.remove(child);
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
                if (Array.isArray(child.material)) {
                    child.material.forEach(material => material.dispose());
                } else {
                    child.material.dispose();
                }
            }
        }
    }

    getWorld() {
        return (this.minecraft && this.minecraft.world) || this.world || null;
    }

    
    resolveBlock(blockOrId) {
        if (!blockOrId) return null;
        if (typeof blockOrId === 'object') return blockOrId;
        if (typeof blockOrId === 'number') return Block.getById(blockOrId) || BlockRegistry.get(blockOrId);
        return BlockRegistry.get(String(blockOrId).trim());
    }

    renderResolved(block, sourceData, renderX, renderY, renderZ) {
        const world = this.getWorld();
        const worldRenderer = this.minecraft ? this.minecraft.worldRenderer : null;
        if (!world || !worldRenderer || !worldRenderer.blockRenderer) return null;

        const scene = worldRenderer.scene;
        if (scene && this.group.parent !== scene) {
            this.clear();
            scene.add(this.group);
        }

        const renderWorld = this.createRenderWorld(world, block, sourceData, renderX, renderY, renderZ);

        const blockRenderer = worldRenderer.blockRenderer;
        const tessellator = blockRenderer.tessellator;
        tessellator.startDrawing();
        tessellator.setRenderingPass(block.isTranslucent());
        blockRenderer.beginModelPass();
        blockRenderer.renderBlock(renderWorld, block, false, renderX, renderY, renderZ);

        let mesh = null;
        if (tessellator.addedVertices > 0) {
            mesh = tessellator.draw(this.group);
        }

        const modelMesh = blockRenderer.flushModelPass(this.group);
        if (modelMesh !== null && mesh === null) {
            mesh = modelMesh;
        }

        if (mesh === null) {
            return null;
        }

        const chunkX = (renderX >> 4) << 4;
        const chunkY = (renderY >> 4) << 4;
        const chunkZ = (renderZ >> 4) << 4;
        for (const previewMesh of [mesh, modelMesh]) {
            if (previewMesh === null) continue;
            previewMesh.position.set(chunkX, chunkY, chunkZ);

            if (block.isTranslucent()) {
                previewMesh.material.transparent = true;
                previewMesh.material.depthWrite = false;
                previewMesh.renderOrder = 10000;
            }
        }

        return mesh;
    }

    createRenderWorld(world, block, sourceData, px, py, pz) {
        const isTarget = (x, y, z) => x === px && y === py && z === pz;
        const chunkX = px >> 4;
        const chunkZ = pz >> 4;

        return new Proxy(world, {
            get(target, prop) {
                switch (prop) {
                    case 'getBlockAt':
                        return (x, y, z) => isTarget(x, y, z) ? block.id : target.getBlockAt(x, y, z);
                    case 'getBlockDataAt':
                        return (x, y, z) => isTarget(x, y, z) ? sourceData : target.getBlockDataAt(x, y, z);
                    case 'getChunkAt':
                        return (x, z) => {
                            const chunk = target.getChunkAt(x, z);
                            if (!chunk || x !== chunkX || z !== chunkZ) return chunk;
                            return new Proxy(chunk, {
                                get(chunkTarget, chunkProp) {
                                    if (chunkProp === 'getBlockDataAt') {
                                        return (lx, ly, lz) => {
                                            const wx = (chunkX << 4) + lx;
                                            const wz = (chunkZ << 4) + lz;
                                            return isTarget(wx, ly, wz) ? sourceData : chunkTarget.getBlockDataAt(lx, ly, lz);
                                        };
                                    }
                                    return chunkTarget[chunkProp];
                                }
                            });
                        };
                    default:
                        return target[prop];
                }
            }
        });
    }
}
