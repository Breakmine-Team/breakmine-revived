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

        this.rotatingMeshes = [];

        this.blocks = new Uint16Array(4096);
        this.blocksData = new Uint8Array(4096);
        this.blockLight = [];
        this.skyLight = [];
        this.skyLight = [];
        this.empty = true;
        
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
        const wx = this.x << 4;
        const wz = this.z << 4;

        if (this.world && (
            !this.world.chunkReady(wx >> 4, wz >> 4) ||
            !this.world.chunkReady((wx >> 4) + 1, wz >> 4) ||
            !this.world.chunkReady((wx >> 4) - 1, wz >> 4) ||
            !this.world.chunkReady(wx >> 4, (wz >> 4) + 1) ||
            !this.world.chunkReady(wx >> 4, (wz >> 4) - 1)
        )) {
            return;
        }

        this.isModified = false;
        this.group.clear();
        this.rotatingMeshes.length = 0;
        this.translucentMesh = null; 

        let ambientOcclusion = this.world.minecraft.settings.ambientOcclusion;
        let tessellator = renderer.blockRenderer.tessellator;

        const wy = this.y << 4;

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

        let cameraPos = null;
        let player = this.world.minecraft.player;
        if (player) {
            cameraPos = {
                x: player.x,
                y: player.y + player.getEyeHeight(),
                z: player.z
            };
        }

        const animationTick = ChunkSection.animationTick();
        const overlay = this.world.offGridField;
        const checkOverlay = overlay !== null && !overlay.isPosed();
        const sectionX = this.x * ChunkSection.SIZE;
        const sectionY = this.y * ChunkSection.SIZE;
        const sectionZ = this.z * ChunkSection.SIZE;
        const blocks = this.blocks;

        const opaqueBlocks = [];
        const translucentBlocks = [];
        const opaqueRotating = [];
        const translucentRotating = [];

        for (let x = 0; x < ChunkSection.SIZE; x++) {
            const absoluteX = sectionX + x;
            for (let y = 0; y < ChunkSection.SIZE; y++) {
                const absoluteY = sectionY + y;
                for (let z = 0; z < ChunkSection.SIZE; z++) {
                    const typeId = blocks[y << 8 | z << 4 | x];
                    if (typeId === 0) {
                        continue;
                    }

                    const absoluteZ = sectionZ + z;

                    if (checkOverlay && overlay.covers(absoluteX, absoluteY, absoluteZ)) {
                        continue;
                    }

                    const block = Block.getById(typeId);
                    if (block === null) {
                        continue;
                    }

                    const translucent = block.isTranslucent();
                    const rotation = renderer.blockRenderer.getBlockRotation(
                        this.world, block, absoluteX, absoluteY, absoluteZ, animationTick
                    );

                    if (rotation !== null) {
                        const entry = {
                            x, y, z,
                            block,
                            translucent,
                            staticParts: renderer.blockRenderer.getStaticParts(
                                block, this.world, absoluteX, absoluteY, absoluteZ
                            ),
                            groups: renderer.blockRenderer.getRotatingGroups(
                                block, this.world, absoluteX, absoluteY, absoluteZ
                            )
                        };
                        (translucent ? translucentRotating : opaqueRotating).push(entry);
                        continue;
                    }

                    (translucent ? translucentBlocks : opaqueBlocks).push({ x, y, z, block });
                }
            }
        }

        const renderPass = (blocksToRender, rotatingBlocks, isTranslucentRenderPhase) => {
            tessellator.startDrawing();
            tessellator.setRenderingPass(isTranslucentRenderPhase);
            renderer.blockRenderer.beginModelPass();

            for (const blockData of rotatingBlocks) {
                if (blockData.staticParts !== null) {
                    const absoluteX = sectionX + blockData.x;
                    const absoluteY = sectionY + blockData.y;
                    const absoluteZ = sectionZ + blockData.z;
                    renderer.blockRenderer.renderParts(
                        this.world, blockData.staticParts,
                        absoluteX, absoluteY, absoluteZ, false, true, blockData.block, ambientOcclusion
                    );
                }
            }

            if (isTranslucentRenderPhase && cameraPos) {
                blocksToRender.sort((a, b) => {
                    const ax = sectionX + a.x + 0.5;
                    const ay = sectionY + a.y + 0.5;
                    const az = sectionZ + a.z + 0.5;

                    const bx = sectionX + b.x + 0.5;
                    const by = sectionY + b.y + 0.5;
                    const bz = sectionZ + b.z + 0.5;

                    const distASq = (ax - cameraPos.x) * (ax - cameraPos.x) +
                        (ay - cameraPos.y) * (ay - cameraPos.y) +
                        (az - cameraPos.z) * (az - cameraPos.z);
                    const distBSq = (bx - cameraPos.x) * (bx - cameraPos.x) +
                        (by - cameraPos.y) * (by - cameraPos.y) +
                        (bz - cameraPos.z) * (bz - cameraPos.z);

                    return distBSq - distASq;
                });
            }

            for (const blockData of blocksToRender) {
                const absoluteX = sectionX + blockData.x;
                const absoluteY = sectionY + blockData.y;
                const absoluteZ = sectionZ + blockData.z;

                renderer.blockRenderer.renderBlock(
                    this.world, blockData.block, ambientOcclusion,
                    absoluteX, absoluteY, absoluteZ, null
                );
            }

            for (const blockData of rotatingBlocks) {
                const absoluteX = sectionX + blockData.x;
                const absoluteY = sectionY + blockData.y;
                const absoluteZ = sectionZ + blockData.z;

                const groups = blockData.groups;
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

                if (meshes.length === 0 || meshes.some((mesh) => !ChunkSection.hasFinitePositions(mesh))) {
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
                const mesh = tessellator.draw(this.group);

                if (isTranslucentRenderPhase) {
                    mesh.userData.isTranslucent = true;

                    mesh.visible = false;
                }
            }

            renderer.blockRenderer.flushModelPasses(this.group);
        };

        renderPass(opaqueBlocks, opaqueRotating, false);
        renderPass(translucentBlocks, translucentRotating, true);
    }
    
    
    updateTranslucentRenderOrder(cameraPos) {
        if (!this.translucentMesh || !cameraPos) {
            return;
        }
        
        let centerX = this.x * ChunkSection.SIZE + ChunkSection.SIZE * 0.5;
        let centerY = this.y * ChunkSection.SIZE + ChunkSection.SIZE * 0.5;
        let centerZ = this.z * ChunkSection.SIZE + ChunkSection.SIZE * 0.5;
        
        let dx = centerX - cameraPos.x;
        let dy = centerY - cameraPos.y;
        let dz = centerZ - cameraPos.z;
        let distSq = dx * dx + dy * dy + dz * dz;
        
        this.translucentMesh.renderOrder = -distSq;
    }

    
    static hasFinitePositions(mesh) {
        const array = mesh?.geometry?.attributes?.position?.array;
        if (!array) return false;

        for (let i = 0; i < array.length; i++) {
            if (!Number.isFinite(array[i])) return false;
        }

        return true;
    }

    
    static animationTick() {
        const now = typeof performance !== 'undefined' && performance.now
            ? performance.now()
            : Date.now();
        return Math.floor(now / 50);
    }

    
    static interpolateAngle(from, to, t) {
        const delta = ((to - from) % 360 + 540) % 360 - 180;
        return from + delta * t;
    }

    
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