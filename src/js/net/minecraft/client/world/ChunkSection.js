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

        // One mesh per block that turns itself. They are rebuilt with the
        // section and re-rotated every frame, so the turn is smooth.
        this.rotatingMeshes = [];

        // Typed arrays: every get/set becomes a direct index read/write instead
        // of a holey-array `in` operator probe (the single hottest path in both
        // worldgen and meshing).
        //
        // Type ids are not bytes: the wire/disk block state packs the id into
        // the upper 12 bits of a u16 (4 bits are metadata), so ids up to 4095
        // are valid. A Uint8Array silently truncated ids above 255 into other
        // blocks, so widen the store.
        this.blocks = new Uint16Array(4096);
        this.blocksData = new Uint8Array(4096);
        this.blockLight = [];
        this.skyLight = [];
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
        const wx = (this.x << 4) + x;
        const wy = (this.y << 4) + y;
        const wz = (this.z << 4) + z;
        if (block.getOpacity(this.world, wx, wy, wz, block) < 1) return false;

        const bbox = block.getBoundingBox(this.world, wx, wy, wz);
        if (bbox === null) return false;

        return bbox.minX <= 0 && bbox.minY <= 0 && bbox.minZ <= 0 &&
               bbox.maxX >= 1 && bbox.maxY >= 1 && bbox.maxZ >= 1;
    }

    rebuild(renderer) {
        // Neighbor availability guard: meshing samples blocks one block past
        // the section borders. If a neighboring chunk is not loaded yet, doing
        // that sample would make the provider synchronously generate an entire
        // chunk mid-mesh - the cause of the seconds-long spikes when moving.
        // Instead, leave the section flagged (isModified) so WorldRenderer
        // re-queues it once the neighbor chunk arrives.
        const wx = this.x << 4;
        const wz = this.z << 4;

        if (this.world && (
            !this.world.chunkExists(wx >> 4, wz >> 4) ||
            !this.world.chunkExists((wx >> 4) + 1, wz >> 4) ||
            !this.world.chunkExists((wx >> 4) - 1, wz >> 4) ||
            !this.world.chunkExists(wx >> 4, (wz >> 4) + 1) ||
            !this.world.chunkExists(wx >> 4, (wz >> 4) - 1)
        )) {
            return;
        }

        this.isModified = false;
        this.group.clear();
        this.rotatingMeshes.length = 0;
        this.translucentMesh = null; // Reset on rebuild

        let ambientOcclusion = this.world.minecraft.settings.ambientOcclusion;
        let tessellator = renderer.blockRenderer.tessellator;

        // Section origin world Y
        const wy = this.y << 4;

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
            renderer.blockRenderer.beginModelPass();

            // Collect blocks for this pass
            let blocksToRender = [];
            let rotatingBlocks = [];
            
            for (let x = 0; x < ChunkSection.SIZE; x++) {
                for (let y = 0; y < ChunkSection.SIZE; y++) {
                    for (let z = 0; z < ChunkSection.SIZE; z++) {
                        let typeId = this.getBlockAt(x, y, z);

                        if (typeId !== 0) {
                            // A flat summoned overlay living at this grid cell
                            // renders instead of the real block; drawing both
                            // puts two coplanar meshes at the same world
                            // coordinates (z-fighting).
                            const overlay = this.world.offGridField;
                            if (overlay && !overlay.isPosed() && overlay.covers(
                                    this.x * ChunkSection.SIZE + x,
                                    this.y * ChunkSection.SIZE + y,
                                    this.z * ChunkSection.SIZE + z)) {
                                continue;
                            }

                            let block = Block.getById(typeId);
                            if (block === null || block.isTranslucent() !== isTranslucentRenderPhase) {
                                continue;
                            }
                            
                            // Blocks that turn themselves get their own mesh,
                            // so the section mesh stays put and the object can
                            // be rotated every frame.
                            if (renderer.blockRenderer.getBlockRotation(
                                    this.world, block,
                                    this.x * ChunkSection.SIZE + x,
                                    this.y * ChunkSection.SIZE + y,
                                    this.z * ChunkSection.SIZE + z,
                                    ChunkSection.animationTick()                            ) !== null) {
                                // A block may spin only some of its parts: the
                                // still casing goes into the section mesh, and
                                // the moving parts become the block's own mesh.
                                const absoluteX = this.x * ChunkSection.SIZE + x;
                                const absoluteY = this.y * ChunkSection.SIZE + y;
                                const absoluteZ = this.z * ChunkSection.SIZE + z;
                                const staticParts = renderer.blockRenderer.getStaticParts(
                                    block, this.world, absoluteX, absoluteY, absoluteZ
                                );

                                if (staticParts !== null) {
                                    renderer.blockRenderer.renderParts(
                                        this.world, staticParts,
                                        absoluteX, absoluteY, absoluteZ, false, true, block
                                    );
                                }

                                rotatingBlocks.push({x: x, y: y, z: z, block: block});
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

            // Each rotating block becomes a mesh of its own, centered on its
            // cell so the object can spin around the block's middle.
            for (let blockData of rotatingBlocks) {
                let absoluteX = this.x * ChunkSection.SIZE + blockData.x;
                let absoluteY = this.y * ChunkSection.SIZE + blockData.y;
                let absoluteZ = this.z * ChunkSection.SIZE + blockData.z;

                // Parts that turn on different axles (a gearbox's crossed
                // pairs) each become their own mesh; anything else is one mesh.
                const groups = renderer.blockRenderer.getRotatingGroups(
                    blockData.block, this.world, absoluteX, absoluteY, absoluteZ
                );
                const partGroups = groups !== null ? groups.map((group) => group.parts) : [null];

                let meshes = [];
                for (const parts of partGroups) {
                    const mesh = renderer.blockRenderer.buildRotatingMesh(
                        this.world, blockData.block, ambientOcclusion,
                        absoluteX, absoluteY, absoluteZ, isTranslucentRenderPhase, parts
                    );
                    if (mesh === null) {
                        meshes = [];
                        break;
                    }
                    meshes.push(mesh);
                }

                // Non-finite geometry would make three.js drop the mesh (and
                // log a NaN bounding-sphere error).
                if (meshes.length === 0 || meshes.some((mesh) => !ChunkSection.hasFinitePositions(mesh))) {
                    // Safety net: a rotating block must never disappear. If it
                    // produced no usable geometry, bake it into the section
                    // mesh like any other block.
                    if (meshes.length > 0) {
                        console.warn(
                            `[ChunkSection] Non-finite geometry for '${blockData.block?.identifier ?? blockData.block?.id}' at ${absoluteX},${absoluteY},${absoluteZ}; drawing it in the section mesh instead`
                        );
                    }
                    renderer.blockRenderer.renderBlock(
                        this.world, blockData.block, ambientOcclusion,
                        absoluteX, absoluteY, absoluteZ
                    );
                    continue;
                }

                const centerX = blockData.x + 0.5;
                const centerY = blockData.y + 0.5;
                const centerZ = blockData.z + 0.5;

                for (let i = 0; i < meshes.length; i++) {
                    const mesh = meshes[i];
                    mesh.geometry.translate(-centerX, -centerY, -centerZ);
                    mesh.geometry.computeBoundingSphere();
                    mesh.position.set(centerX, centerY, centerZ);
                    mesh.userData.rotatingBlock = {
                        block: blockData.block,
                        worldX: absoluteX,
                        worldY: absoluteY,
                        worldZ: absoluteZ,
                        group: groups !== null ? i : -1,
                        previous: null,
                        current: null,
                        tick: -1
                    };

                    this.group.add(mesh);
                    this.rotatingMeshes.push(mesh);
                }
            }

            if (tessellator.addedVertices > 0) {
                let mesh = tessellator.draw(this.group);
                
                if (isTranslucentRenderPhase) {
                    mesh.userData.isTranslucent = true;
                    
                    // CRITICAL: Hide it! The global batcher will draw it instead.
                    mesh.visible = false; 
                }
            }

            // Custom-model blocks use their own textures, so each model type
            // forms its own mesh next to the atlas mesh.
            renderer.blockRenderer.flushModelPasses(this.group);
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

    /** True when a built mesh has only usable vertex positions. */
    static hasFinitePositions(mesh) {
        const array = mesh?.geometry?.attributes?.position?.array;
        if (!array) return false;

        for (let i = 0; i < array.length; i++) {
            if (!Number.isFinite(array[i])) return false;
        }

        return true;
    }

    /**
     * 20 Hz animation clock for blocks that turn themselves, in game ticks.
     * Wall-clock based so it advances whether or not the client world is
     * ticking its own counter (it does not in multiplayer).
     */
    static animationTick() {
        const now = typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        return Math.floor(now / 50);
    }

    /** Blend two angles in degrees the short way round, for frame blending. */
    static interpolateAngle(from, to, t) {
        const delta = ((to - from) % 360 + 540) % 360 - 180;
        return from + delta * t;
    }

    /**
     * Turn every rotating block mesh to the angle for this frame. Blocks move a
     * tick at a time, so blend from the previous tick's angle to this tick's
     * using the frame's partial ticks.
     */
    updateRotatingBlocks(renderer, tick, partialTicks) {
        if (this.rotatingMeshes.length === 0) {
            return;
        }

        const world = this.world;
        const blend = Math.max(0, Math.min(1, partialTicks || 0));
        const radians = Math.PI / 180;

        for (const mesh of this.rotatingMeshes) {
            const info = mesh.userData.rotatingBlock;
            const rotation = info.group >= 0
                ? renderer.blockRenderer.getGroupRotation(
                    info.block, info.group, world, info.worldX, info.worldY, info.worldZ, tick)
                : renderer.blockRenderer.getBlockRotation(
                    world, info.block, info.worldX, info.worldY, info.worldZ, tick);

            if (rotation === null) {
                mesh.rotation.set(0, 0, 0);
                continue;
            }

            if (info.current === null || info.tick !== tick) {
                info.previous = info.current === null ? rotation : info.current;
                info.current = rotation;
                info.tick = tick;
            }

            mesh.rotation.set(
                ChunkSection.interpolateAngle(info.previous.x, info.current.x, blend) * radians,
                ChunkSection.interpolateAngle(info.previous.y, info.current.y, blend) * radians,
                ChunkSection.interpolateAngle(info.previous.z, info.current.z, blend) * radians
            );
        }
    }

    getBlockAt(x, y, z) {
        let index = y << 8 | z << 4 | x;
        return this.empty ? 0 : this.blocks[index];
    }

    getBlockDataAt(x, y, z) {
        let index = y << 8 | z << 4 | x;
        return this.empty ? 0 : this.blocksData[index];
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