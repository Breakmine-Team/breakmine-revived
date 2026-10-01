import EnumSkyBlock from "../../util/EnumSkyBlock.js";
import Block from "./block/Block.js";
import * as THREE from "../../../../../../libraries/three.module.js";

export default class ChunkSection {

    static SIZE = 16;

    constructor(world, chunk, x, y, z) {
        this.world = world;
        this.chunk = chunk;

        this.x = x;
        this.y = y;
        this.z = z;

        this.boundingBox = new THREE.Box3();
        this.boundingBox.min.x = x * ChunkSection.SIZE;
        this.boundingBox.min.y = y * ChunkSection.SIZE;
        this.boundingBox.min.z = z * ChunkSection.SIZE;
        this.boundingBox.max.x = x * ChunkSection.SIZE + ChunkSection.SIZE;
        this.boundingBox.max.y = y * ChunkSection.SIZE + ChunkSection.SIZE;
        this.boundingBox.max.z = z * ChunkSection.SIZE + ChunkSection.SIZE;

        this.group = new THREE.Object3D();
        this.group.position.x = this.x * ChunkSection.SIZE;
        this.group.position.y = this.y * ChunkSection.SIZE;
        this.group.position.z = this.z * ChunkSection.SIZE;
        this.group.updateMatrix();
        this.group.matrixAutoUpdate = false;
        this.isModified = true;
        this.isDirty = false;

        this.blocks = [];
        this.blocksData = [];
        this.blockLight = [];
        this.skyLight = [];
        this.empty = true;
        
        // Store reference to translucent mesh for cross-chunk sorting
        this.translucentMesh = null;
    }

    render() {

    }
    
    isFaceSolid(side) {
        for (let a = 0; a < 16; a++) {
            for (let b = 0; b < 16; b++) {
                let x = a, y = b, z = 0;

                if (side === 'north') { x = a; y = b; z = 0; }
                else if (side === 'south') { x = a; y = b; z = 15; }
                else if (side === 'west')  { x = 0; y = a; z = b; }
                else if (side === 'east')  { x = 15; y = a; z = b; }
                else if (side === 'down')  { x = a; y = 0; z = b; }
                else if (side === 'up')    { x = a; y = 15; z = b; }

                const typeId = this.getBlockAt(x, y, z);
                if (typeId === 0) return false;

                const block = Block.getById(typeId);
                if (block === null || !this.isOpaqueFullCube(block, x, y, z)) return false;
            }
        }
        return true;
    }

    isOpaqueFullCube(block, x, y, z) {
        if (!block.isSolid() || block.isTranslucent()) return false;
        if (block.multipart || block.noFaceCull || block.path) return false;
        if (block.getOpacity() < 1) return false;

        const wx = (this.x << 4) + x;
        const wy = (this.y << 4) + y;
        const wz = (this.z << 4) + z;
        const bbox = block.getBoundingBox(this.world, wx, wy, wz);
        if (bbox === null) return false;

        return bbox.minX <= 0 && bbox.minY <= 0 && bbox.minZ <= 0 &&
               bbox.maxX >= 1 && bbox.maxY >= 1 && bbox.maxZ >= 1;
    }

    rebuild(renderer) {
        this.isModified = false;
        this.group.clear();
        this.translucentMesh = null; // Reset on rebuild

        let ambientOcclusion = this.world.minecraft.settings.ambientOcclusion;
        let tessellator = renderer.blockRenderer.tessellator;

        // Convert section origin to world block coordinates
        const wx = this.x << 4;
        const wy = this.y << 4;
        const wz = this.z << 4;

        // Fetch adjacent sections using world block offsets
        const north = this.world.getChunkAtBlock(wx, wy, wz - 1);
        const south = this.world.getChunkAtBlock(wx, wy, wz + 16);
        const east  = this.world.getChunkAtBlock(wx + 16, wy, wz);
        const west  = this.world.getChunkAtBlock(wx - 1, wy, wz);
        const up    = this.world.getChunkAtBlock(wx, wy + 16, wz);
        const down  = this.world.getChunkAtBlock(wx, wy - 1, wz);

        if (north && south && east && west && up && down &&
            north.isFaceSolid('south') &&
            south.isFaceSolid('north') &&
            east.isFaceSolid('west')   &&
            west.isFaceSolid('east')   &&
            up.isFaceSolid('down')     &&
            down.isFaceSolid('up')) {
            return;
        }

        // Get camera position for translucent sorting
        let cameraPos = null;
        let player = this.world.minecraft.player;
        if (player) {
            cameraPos = {
                x: player.x,
                y: player.y + player.getEyeHeight(),
                z: player.z
            };
        }

        for (let i = 0; i < 2; i++) {
            let isTranslucentRenderPhase = i === 1;

            tessellator.startDrawing();
            tessellator.setRenderingPass(isTranslucentRenderPhase);

            // Collect blocks for this pass
            let blocksToRender = [];
            
            for (let x = 0; x < ChunkSection.SIZE; x++) {
                for (let y = 0; y < ChunkSection.SIZE; y++) {
                    for (let z = 0; z < ChunkSection.SIZE; z++) {
                        let typeId = this.getBlockAt(x, y, z);

                        if (typeId !== 0) {
                            let block = Block.getById(typeId);
                            if (block === null || block.isTranslucent() !== isTranslucentRenderPhase) {
                                continue;
                            }
                            
                            blocksToRender.push({
                                x: x,
                                y: y,
                                z: z,
                                block: block
                            });
                        }
                    }
                }
            }

            // Sort translucent blocks back-to-front from camera for proper depth ordering
            if (isTranslucentRenderPhase && cameraPos) {
                let sectionWorldX = this.x * ChunkSection.SIZE;
                let sectionWorldY = this.y * ChunkSection.SIZE;
                let sectionWorldZ = this.z * ChunkSection.SIZE;

                blocksToRender.sort((a, b) => {
                    // Calculate world positions of block centers
                    let ax = sectionWorldX + a.x + 0.5;
                    let ay = sectionWorldY + a.y + 0.5;
                    let az = sectionWorldZ + a.z + 0.5;
                    
                    let bx = sectionWorldX + b.x + 0.5;
                    let by = sectionWorldY + b.y + 0.5;
                    let bz = sectionWorldZ + b.z + 0.5;

                    // Calculate squared distances to camera
                    let distASq = (ax - cameraPos.x) * (ax - cameraPos.x) + 
                                (ay - cameraPos.y) * (ay - cameraPos.y) + 
                                (az - cameraPos.z) * (az - cameraPos.z);
                    let distBSq = (bx - cameraPos.x) * (bx - cameraPos.x) + 
                                (by - cameraPos.y) * (by - cameraPos.y) + 
                                (bz - cameraPos.z) * (bz - cameraPos.z);

                    // Sort far to near (far blocks render first)
                    return distBSq - distASq;
                });
            }

            // Render blocks in (potentially sorted) order
            for (let blockData of blocksToRender) {
                let absoluteX = this.x * ChunkSection.SIZE + blockData.x;
                let absoluteY = this.y * ChunkSection.SIZE + blockData.y;
                let absoluteZ = this.z * ChunkSection.SIZE + blockData.z;

                renderer.blockRenderer.renderBlock(this.world, blockData.block, ambientOcclusion, absoluteX, absoluteY, absoluteZ);
            }

            if (tessellator.addedVertices > 0) {
                let mesh = tessellator.draw(this.group);
                
                if (isTranslucentRenderPhase) {
                    mesh.userData.isTranslucent = true;
                    
                    // CRITICAL: Hide it! The global batcher will draw it instead.
                    mesh.visible = false; 
                }
            }
        }
    }
    
    /**
     * Updates the renderOrder of this section's translucent mesh based on camera position.
     * This must be called every frame before rendering for proper cross-chunk sorting.
     * @param {Object} cameraPos - Camera position {x, y, z}
     */
    updateTranslucentRenderOrder(cameraPos) {
        if (!this.translucentMesh || !cameraPos) {
            return;
        }
        
        // Calculate center of this section in world coordinates
        let centerX = this.x * ChunkSection.SIZE + ChunkSection.SIZE * 0.5;
        let centerY = this.y * ChunkSection.SIZE + ChunkSection.SIZE * 0.5;
        let centerZ = this.z * ChunkSection.SIZE + ChunkSection.SIZE * 0.5;
        
        // Calculate squared distance to camera
        let dx = centerX - cameraPos.x;
        let dy = centerY - cameraPos.y;
        let dz = centerZ - cameraPos.z;
        let distSq = dx * dx + dy * dy + dz * dz;
        
        // Negative distance ensures farther chunks have LOWER renderOrder (render first)
        // This achieves back-to-front rendering across chunks
        this.translucentMesh.renderOrder = -distSq;
    }

    getBlockAt(x, y, z) {
        let index = y << 8 | z << 4 | x;
        return !this.empty && index in this.blocks ? this.blocks[index] : 0;
    }

    getBlockDataAt(x, y, z) {
        let index = y << 8 | z << 4 | x;
        return !this.empty && index in this.blocksData ? this.blocksData[index] : 0;
    }

    setBlockAt(x, y, z, typeId, data) {
        let index = y << 8 | z << 4 | x;
        this.blocks[index] = typeId;
        if (data !== undefined) {
            this.blocksData[index] = data;
        }
        this.isModified = true;
        this.isDirty = true;

        if (this.empty && typeId !== 0) {
            this.empty = false;
        }
    }

    setBlockDataAt(x, y, z, data) {
        let index = y << 8 | z << 4 | x;
        this.blocksData[index] = data;
        this.isModified = true;
        this.isDirty = true;
    }

    setLightAt(sourceType, x, y, z, lightLevel) {
        let index = y << 8 | z << 4 | x;

        if (sourceType === EnumSkyBlock.SKY) {
            this.skyLight[index] = lightLevel;
        }
        if (sourceType === EnumSkyBlock.BLOCK) {
            this.blockLight[index] = lightLevel;
        }

        this.isModified = true;
        this.isDirty = true;
    }

    getTotalLightAt(x, y, z) {
        let index = y << 8 | z << 4 | x;
        let skyLight = (index in this.skyLight ? this.skyLight[index] : (this.empty ? 15 : 14)) - this.world.skylightSubtracted;
        let blockLight = index in this.blockLight ? this.blockLight[index] : 0;
        if (blockLight > skyLight) {
            skyLight = blockLight;
        }
        return skyLight;
    }

    getLightAt(sourceType, x, y, z) {
        let index = y << 8 | z << 4 | x;
        if (sourceType === EnumSkyBlock.SKY) {
            return index in this.skyLight ? this.skyLight[index] : (this.empty ? 15 : 14);
        }
        if (sourceType === EnumSkyBlock.BLOCK) {
            return index in this.blockLight ? this.blockLight[index] : 0;
        }
        return 0;
    }

    isEmpty() {
        return this.empty;
    }
}