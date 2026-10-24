import Block from "../world/block/Block.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import * as THREE from "../../../../../../libraries/three.module.js";

/**
 * Renders a single block at an arbitrary location ("off-grid"), through the
 * real block renderer pipeline (WorldRenderer.blockRenderer + Tessellator) -
 * the same path chunk sections and the placement ghost use, so custom
 * renderers, multipart models, liquids and metadata all behave identically.
 *
 * Typical use: visualize a block that lives in an unloaded chunk (or at any
 * other position) somewhere near the player for debugging.
 *
 * Because it tessellates on demand, render() must be called on the client
 * render thread (from a command or a network handler), never from the server.
 * Ghost-block renders are shared through the off-grid packets; see
 * server/offgrid.js and client/render/OffGridClientSync.js.
 */
export default class OffGridBlockRenderer {

    constructor(world, minecraft) {
        this.world = world;
        this.minecraft = minecraft;

        // Root group for every off-grid mesh. Attached to the world renderer's
        // scene lazily; WorldRenderer.reset() drops scene children on a world
        // switch, so we re-attach (and drop stale meshes) on the next render.
        this.group = new THREE.Object3D();
        this.group.updateMatrix();
        this.group.matrixAutoUpdate = false;
    }

    /**
     * Block type id at the source position. Never forces an unloaded chunk to
     * generate (the singleplayer chunk provider generates on demand, which
     * would stall the frame), so an unloaded position reads as air (0).
     */
    getBlockAt(blockX, blockY, blockZ) {
        const world = this.getWorld();
        if (!world) return 0;
        if (typeof world.chunkExists === 'function' && !world.chunkExists(blockX >> 4, blockZ >> 4)) {
            return 0;
        }
        return world.getBlockAt(blockX, blockY, blockZ) || 0;
    }

    /** Block metadata at the source position; 0 when the chunk is unloaded. */
    getBlockDataAt(blockX, blockY, blockZ) {
        const world = this.getWorld();
        if (!world) return 0;
        if (typeof world.chunkExists === 'function' && !world.chunkExists(blockX >> 4, blockZ >> 4)) {
            return 0;
        }
        return world.getBlockDataAt(blockX, blockY, blockZ) || 0;
    }

    /**
     * Render the block stored at (blockX, blockY, blockZ) at
     * (renderX, renderY, renderZ).
     *
     * `blockOverride` (Block instance, numeric id or registry name) lets the
     * caller render a block even when the source chunk is unloaded and the
     * stored type is unknown.
     *
     * @returns {{ block: Block, mesh: THREE.Mesh }} or null when nothing was
     *          rendered (no world/renderer, or air at the source with no
     *          override).
     */
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

    /**
     * Render an explicit Block (or id / registry name) at a location. The
     * rendered appearance uses default metadata unless sourceData is given.
     */
    renderBlock(block, renderX, renderY, renderZ, sourceData = 0) {
        block = this.resolveBlock(block);
        if (!block) return null;
        const mesh = this.renderResolved(block, sourceData, renderX, renderY, renderZ);
        return mesh ? { block, mesh } : null;
    }

    /** Remove and dispose every mesh rendered so far. */
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

    /** Accept a Block instance, a numeric type id or a registry name. */
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

        // Make sure the group is attached to the current scene. On a world
        // switch WorldRenderer.reset() removed it, along with meshes that
        // belonged to the old world.
        const scene = worldRenderer.scene;
        if (scene && this.group.parent !== scene) {
            this.clear();
            scene.add(this.group);
        }

        // Proxy world: at the render position the block (and its metadata)
        // looks exactly like the source block; everywhere else the real world
        // is sampled, so lighting, neighbour face culling, multipart
        // connections and liquid flow all go through the standard renderer
        // paths. This is the same trick the placement ghost uses.
        const renderWorld = this.createRenderWorld(world, block, sourceData, renderX, renderY, renderZ);

        const blockRenderer = worldRenderer.blockRenderer;
        const tessellator = blockRenderer.tessellator;
        tessellator.startDrawing();
        tessellator.setRenderingPass(block.isTranslucent());
        blockRenderer.renderBlock(renderWorld, block, false, renderX, renderY, renderZ);

        if (tessellator.addedVertices === 0) {
            return null;
        }

        const mesh = tessellator.draw(this.group);

        // The renderer emits vertices relative to the chunk containing the
        // render position (see BlockRenderer.addBlockCorner), so offset the
        // mesh back out to world space - same expression the renderer itself
        // uses, so float positions stay consistent.
        mesh.position.set((renderX >> 4) << 4, (renderY >> 4) << 4, (renderZ >> 4) << 4);

        if (block.isTranslucent()) {
            mesh.material.transparent = true;
            mesh.material.depthWrite = false;
            mesh.renderOrder = 10000;
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
                                        // BlockRenderer reads metadata through
                                        // the chunk; mirror the target cell
                                        // there too.
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
