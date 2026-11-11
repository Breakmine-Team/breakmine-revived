
const FACE_DX = [1, -1, 0, 0, 0, 0];
const FACE_DY = [0, 0, 1, -1, 0, 0];
const FACE_DZ = [0, 0, 0, 0, 1, -1];

import EnumBlockFace from "../../util/EnumBlockFace.js";
import BlockRenderType from "../../util/BlockRenderType.js";
import Tessellator from "./Tessellator.js";
import MathHelper from "../../util/MathHelper.js";
import Block from "../world/block/Block.js";
import BoundingBox from "../../util/BoundingBox.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import * as THREE from "../../../../../../libraries/three.module.js";
import { createSpriteItemMesh } from "./SpriteItemRenderer.js";
import EnumCreativeInventoryTab from "../gui/EnumCreativeInventoryTab.js";
import getTrafficConeModel, { getTrafficConeTexture } from "./model/TrafficConeModel.js";
import getSnailModel, { getSnailTexture } from "./model/SnailModel.js";
import getTrafficBarrierModel, { getTrafficBarrierTexture } from "./model/TrafficBarrierModel.js";



const FACES = EnumBlockFace.values();


const PART_FACE_EPSILON = 1e-6;


const FACE_UV_EPSILON = 1e-6;




const AO_PROBE = 1 / 32;

export default class BlockRenderer {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;
        this.tessellator = new Tessellator();
        if (worldRenderer.textureAtlas && worldRenderer.textureAtlas.isLoaded()) {
            this.tessellator.bindTexture(worldRenderer.textureAtlas.getTexture());
        } else {
            this.tessellator.bindTexture(worldRenderer.textureTerrain);
        }

        this.modelTessellators = [];
        this.modelTessellator = this.createModelTessellator(getTrafficConeTexture());
        this.barrierModelTessellator = this.createModelTessellator(getTrafficBarrierTexture());
        this.snailModelTessellator = this.createModelTessellator(getSnailTexture());
        this.modelPassActive = false;

        this.rotatingTessellator = new Tessellator();
        this.suppressRotation = false;

        this.aoCells = new Array(27).fill(undefined);
        this.aoBlockX = NaN;
        this.aoBlockY = 0;
        this.aoBlockZ = 0;
    }

    createModelTessellator(texture) {
        const tessellator = new Tessellator();
        tessellator.bindTexture(texture);
        this.modelTessellators.push(tessellator);
        return tessellator;
    }

    beginModelPass() {
        for (const tessellator of this.modelTessellators) {
            tessellator.startDrawing();
            tessellator.setRenderingPass(false);
            tessellator.material.alphaTest = 0.5;
        }
        this.modelPassActive = true;
    }

    
    flushModelPasses(group) {
        if (!this.modelPassActive) {
            return [];
        }

        this.modelPassActive = false;
        const meshes = [];
        for (const tessellator of this.modelTessellators) {
            if (tessellator.addedVertices <= 0) {
                continue;
            }
            const mesh = tessellator.draw(group);
            mesh.userData.modelTessellator = tessellator;
            meshes.push(mesh);
        }
        return meshes;
    }

    
    flushModelPass(group) {
        return this.flushModelPasses(group)[0] ?? null;
    }

    transformModelBrightness(brightness) {
        for (const tessellator of this.modelTessellators) {
            tessellator.transformBrightness(brightness);
        }
    }

    setShadows(enabled) {
        this.tessellator.setShadows(enabled);
        this.rotatingTessellator.setShadows(enabled);
        for (const tessellator of this.modelTessellators) {
            tessellator.setShadows(enabled);
        }
    }

    
    getBlockRotation(world, block, x, y, z, tick = null) {
        if (block === null || typeof block.getRenderRotation !== 'function'
            || block.getRenderRotation === Block.prototype.getRenderRotation) {
            return null;
        }

        const data = world && typeof world.getBlockDataAt === 'function'
            ? world.getBlockDataAt(x, y, z)
            : 0;
        let rotation = block.getRenderRotation(world, x, y, z, data, tick);

        if (typeof rotation === 'number') {
            rotation = {x: 0, y: rotation, z: 0};
        } else if (Array.isArray(rotation)) {
            rotation = {x: rotation[0], y: rotation[1], z: rotation[2]};
        } else if (rotation === null || typeof rotation !== 'object') {
            return null;
        }

        const angleX = Number(rotation.x) || 0;
        const angleY = Number(rotation.y) || 0;
        const angleZ = Number(rotation.z) || 0;

        return angleX === 0 && angleY === 0 && angleZ === 0 ? null : {x: angleX, y: angleY, z: angleZ};
    }

    
    getBlockTessellators() {
        return [this.tessellator, ...this.modelTessellators];
    }

    applyBlockRotation(x, y, z, rotation) {
        const pivotX = x + 0.5 - ((x >> 4) << 4);
        const pivotY = y + 0.5 - ((y >> 4) << 4);
        const pivotZ = z + 0.5 - ((z >> 4) << 4);

        for (const tessellator of this.getBlockTessellators()) {
            tessellator.setBlockRotation(pivotX, pivotY, pivotZ, rotation.x, rotation.y, rotation.z);
        }
    }

    clearBlockRotation() {
        for (const tessellator of this.getBlockTessellators()) {
            tessellator.clearRotation();
        }
    }

    
    buildRotatingMesh(world, block, ambientOcclusion, x, y, z, translucent = false, parts = null) {
        const tessellator = this.rotatingTessellator;

        tessellator.bindTexture(this.tessellator.material.map);
        tessellator.startDrawing();
        tessellator.setRenderingPass(translucent);

        const sectionTessellator = this.tessellator;
        this.tessellator = tessellator;
        this.suppressRotation = true;
        this.buildingRotatingMesh = true;
        try {
            if (parts !== null) {
                this.renderParts(world, parts, x, y, z, false, true, block, ambientOcclusion);
            } else {
                this.renderBlock(world, block, ambientOcclusion, x, y, z);
            }
        } finally {
            this.buildingRotatingMesh = false;
            this.suppressRotation = false;
            this.tessellator = sectionTessellator;
        }

        if (tessellator.addedVertices === 0) {
            return null;
        }

        const mesh = tessellator.draw(new THREE.Group());
        mesh.userData.isTranslucent = translucent;
        if (translucent) {
            mesh.castShadow = false;
            mesh.receiveShadow = false;
        }
        return mesh;
    }

    renderBlock(world, block, ambientOcclusion, x, y, z, knownRotation = undefined) {
        this.aoCells.fill(undefined);
        this.aoBlockX = x;
        this.aoBlockY = y;
        this.aoBlockZ = z;

        const blockRotation = this.suppressRotation
            ? null
            : knownRotation !== undefined
                ? knownRotation
                : this.getBlockRotation(world, block, x, y, z);
        if (blockRotation !== null) {
            this.applyBlockRotation(x, y, z, blockRotation);
        }

        if (block.path) {
            this.renderPath(world, block, ambientOcclusion, x, y, z);
        } else if (block.multipart === true) {
            this.renderMultipart(world, block, ambientOcclusion, x, y, z);
        } else if (block?.lever === true) {
            this.renderLever(world, block, x, y, z, ambientOcclusion);
        } else if (block) {
            const customRenderHandled = block.onRender(world, x, y, z, this);

            if (!customRenderHandled) {
                switch (block.getRenderType()) {
                    case BlockRenderType.ITEM:
                    case (block?.renderAsItemInInventory === true && !world):
                        this.renderSolidBlock(world, block, ambientOcclusion, x, y, z);
                        break;
                    case BlockRenderType.BLOCK:
                        this.renderSolidBlock(world, block, ambientOcclusion, x, y, z);
                        break;
                    case BlockRenderType.TORCH:
                        this.renderTorch(world, block, x, y, z);
                        break;
                    case BlockRenderType.SIGN:
                        this.renderSign(world, block, x, y, z);
                        break;
                    case BlockRenderType.DECORATION:
                        this.renderDecoration(world, block, x, y, z);
                        break;
                    case BlockRenderType.FLUID:
                        this.renderLiquid(world, block, x, y, z);
                        break;
                }
            }
        }

        if (block && Array.isArray(block.renderInside) && block.lever !== true) {
            this.renderParts(world, block.renderInside, x, y, z, false, false, null, ambientOcclusion);
        }

        if (blockRotation !== null) {
            this.clearBlockRotation();
        }

        this.aoBlockX = NaN;
    }

    renderFakeBlock(world, blockId, ambientOcclusion, x, y, z, minX, minY, minZ, maxX, maxY, maxZ) {
        let boundingBox = new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ);
        let block = Block.getById(blockId);
        let values = EnumBlockFace.values();
        for (let i = 0; i < values.length; i++) {
            let face = values[i];
            this.renderFace(world, block, boundingBox, face, block.getAmbientOcclusion() && ambientOcclusion, x, y, z);
        }
    }

    renderFakeBlockWithBlockClass(world, block, ambientOcclusion, x, y, z, minX, minY, minZ, maxX, maxY, maxZ) {
        let boundingBox = new BoundingBox(minX, minY, minZ, maxX, maxY, maxZ);
        let values = EnumBlockFace.values();
        for (let i = 0; i < values.length; i++) {
            let face = values[i];
            this.renderFace(world, block, boundingBox, face, block.getAmbientOcclusion() && ambientOcclusion, x, y, z);
        }
    }

    renderFakeBlockWithBlockClassWithBoundingBox(world, block, ambientOcclusion, x, y, z, boundingBox) {
        let values = EnumBlockFace.values();
        for (let i = 0; i < values.length; i++) {
            let face = values[i];
            this.renderFace(world, block, boundingBox, face, block.getAmbientOcclusion() && ambientOcclusion, x, y, z);
        }
    }

    renderFakeBlockWithBoundingBox(world, blockId, ambientOcclusion, x, y, z, bbox) {
        let block = Block.getById(blockId);
        let values = EnumBlockFace.values();
        for (let i = 0; i < values.length; i++) {
            let face = values[i];
            this.renderFace(world, block, bbox, face, block.getAmbientOcclusion() && ambientOcclusion, x, y, z);
        }
    }

    static DummyBlock = class extends Block {
        constructor(id, texId, texName, texFaces = null, texRotations = null) {
            super(id, texId);
            this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
            this.texName = texName;
            this.texFaces = texFaces;
            this.texRotations = texRotations;
        }
        
        getTextureForFace(face) {
            if (this.texFaces !== null && face && typeof face.getName === 'function') {
                const override = this.texFaces[face.getName()];
                if (override) {
                    return override;
                }
            }
            return this.texName;
        }

        getRotationForFace(face) {
            if (!this.texRotations || !face || typeof face.getName !== 'function') {
                return 0;
            }

            return this.texRotations[face.getName()] || 0;
        }
    };

    static DummyBlockTopFace = class extends Block {
        constructor(id, texId, texName, texNameTop) {
            super(id, texId);
            this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
            this.texName = texName;
            this.texNameTop = texNameTop;
        }
        
        getTextureForFace(face) {
            if (face === EnumBlockFace.TOP) {
                return this.texNameTop;
            }
            return this.texName;
        }
    };

    renderMultipart(world, block, ambientOcclusion, x, y, z) {
        const moving = this.buildingRotatingMesh
            ? this.getRotatingParts(block, world, x, y, z)
            : null;

        this.renderParts(world, moving || block.getMultipart(world, x, y, z), x, y, z, false, true, block, ambientOcclusion);
    }

    
    getRotatingParts(block, world, x, y, z) {
        if (typeof block.getRotatingMultipart !== "function") {
            return null;
        }

        const parts = block.getRotatingMultipart(world, x, y, z);
        return Array.isArray(parts) && parts.length > 0 ? parts : null;
    }

    
    getRotatingGroups(block, world, x, y, z) {
        if (typeof block.getRotatingGroups !== "function") {
            return null;
        }

        const groups = block.getRotatingGroups(world, x, y, z);
        if (!Array.isArray(groups) || groups.length === 0) {
            return null;
        }

        const usable = groups.every((group) => group && Array.isArray(group.parts) && group.parts.length > 0);
        return usable ? groups : null;
    }

    
    getGroupRotation(block, index, world, x, y, z, tick) {
        if (typeof block.getGroupRotation === "function") {
            return block.getGroupRotation(index, world, x, y, z, tick);
        }

        return this.getBlockRotation(world, block, x, y, z, tick);
    }

    
    getStaticParts(block, world, x, y, z) {
        if (this.getRotatingParts(block, world, x, y, z) === null
            || typeof block.getStaticMultipart !== "function") {
            return null;
        }

        const parts = block.getStaticMultipart(world, x, y, z);
        return Array.isArray(parts) && parts.length > 0 ? parts : null;
    }

    resolveParts(parts) {
        if (!Array.isArray(parts)) return [];

        let resolvedParts = [];
        for (let i = 0; i < parts.length; i++) {
            let partBlock = null;
            let bbox = null;
            let partData = parts[i][2];
            
            if (parts[i][0] === 'block') {
                partBlock = Block.getById(parts[i][1]);
                bbox = parts[i][2];
            } else if (parts[i][0] === 'blockClass') {
                partBlock = parts[i][2]['block'];
                bbox = parts[i][2]['bbox'];
            } else if (parts[i][0] === 'texture') {
                partBlock = new this.constructor.DummyBlock(999, 0, parts[i][2]['texture'], parts[i][2]['faces'] ?? null, parts[i][2]['uvRotation'] ?? null);
                bbox = parts[i][2]['bbox'];
            }
            
            if (partBlock && bbox) {
                resolvedParts.push({ partBlock, bbox, rotation: this.getPartRotation(partData, bbox) });
            }
        }
        return resolvedParts;
    }

    
    getPartRotation(partData, bbox) {
        let rotation = partData !== null && typeof partData === 'object' ? partData.rotation : undefined;
        let pivot = partData !== null && typeof partData === 'object' ? partData.pivot : undefined;
        if (rotation === undefined && bbox) {
            rotation = bbox.rotation;
        }
        if (pivot === undefined && bbox) {
            pivot = bbox.pivot;
        }

        let angles;
        if (typeof rotation === 'number') {
            angles = [0, rotation, 0];
        } else if (Array.isArray(rotation)) {
            angles = [Number(rotation[0]) || 0, Number(rotation[1]) || 0, Number(rotation[2]) || 0];
        } else if (rotation !== null && typeof rotation === 'object') {
            angles = [Number(rotation.x) || 0, Number(rotation.y) || 0, Number(rotation.z) || 0];
        } else {
            return null;
        }

        if (angles[0] === 0 && angles[1] === 0 && angles[2] === 0) {
            return null;
        }

        let pivotPoint;
        if (Array.isArray(pivot)) {
            pivotPoint = [Number(pivot[0]) || 0, Number(pivot[1]) || 0, Number(pivot[2]) || 0];
        } else if (pivot !== null && typeof pivot === 'object') {
            pivotPoint = [Number(pivot.x) || 0, Number(pivot.y) || 0, Number(pivot.z) || 0];
        } else {
            pivotPoint = [
                (bbox.minX + bbox.maxX) / 2,
                (bbox.minY + bbox.maxY) / 2,
                (bbox.minZ + bbox.maxZ) / 2
            ];
        }

        return { pivot: pivotPoint, angles };
    }

    
    applyPartRotation(x, y, z, rotation) {
        const pivotX = x + rotation.pivot[0] - ((x >> 4) << 4);
        const pivotY = y + rotation.pivot[1] - ((y >> 4) << 4);
        const pivotZ = z + rotation.pivot[2] - ((z >> 4) << 4);

        for (const tessellator of this.getBlockTessellators()) {
            tessellator.setPartRotation(pivotX, pivotY, pivotZ,
                rotation.angles[0], rotation.angles[1], rotation.angles[2]);
        }
    }

    clearPartRotation() {
        for (const tessellator of this.getBlockTessellators()) {
            tessellator.clearPartRotation();
        }
    }

    renderParts(world, parts, x, y, z, respectFaces = false, cullHidden = false, multipartBlock = null, ambientOcclusion = false) {
        let resolvedParts = this.resolveParts(parts);
        const blockData = this.getBlockDataAt(world, x, y, z);

        let neighborOccluders = null;
        let neighborOccludersResolved = null;
        if (cullHidden && world !== null) {
            neighborOccluders = new Array(FACES.length);
            neighborOccludersResolved = new Array(FACES.length).fill(false);
        }

        for (let i = 0; i < resolvedParts.length; i++) {
            let partBlock = resolvedParts[i].partBlock;
            let bbox = resolvedParts[i].bbox;
            let partRotation = resolvedParts[i].rotation;

            const partAo = ambientOcclusion
                && (multipartBlock !== null ? multipartBlock : partBlock).getAmbientOcclusion();

            const cullHiddenPart = cullHidden && world !== null && partRotation === null;

            if (partRotation !== null) {
                this.applyPartRotation(x, y, z, partRotation);
            }

            try {
                for (let j = 0; j < FACES.length; j++) {
                    let face = FACES[j];

                    if (respectFaces && partBlock.shouldRenderFace(world, x, y, z, face) === false) {
                        continue;
                    }

                    if (cullHiddenPart) {
                        if (this.isPartFaceAtBoundary(bbox, face)) {
                            if (!neighborOccludersResolved[j]) {
                                neighborOccluders[j] = this.getNeighborFaceOccluders(world, multipartBlock, x, y, z, face);
                                neighborOccludersResolved[j] = true;
                            }

                            let occluders = neighborOccluders[j];
                            if (occluders !== null && this.isPartFaceCoveredByPart(occluders, -1, bbox, face)) {
                                continue;
                            }
                        }
                        if (this.isPartFaceCoveredByPart(resolvedParts, i, bbox, face)) {
                            continue;
                        }
                    }

                    this.renderFace(world, partBlock, bbox, face, partAo, x, y, z, blockData);
                }
            } finally {
                if (partRotation !== null) {
                    this.clearPartRotation();
                }
            }
        }
    }

    
    getNeighborFaceOccluders(world, multipartBlock, x, y, z, face) {
        let nx = x + face.x;
        let ny = y + face.y;
        let nz = z + face.z;
        let neighborId = world.getBlockAt(nx, ny, nz);
        if (neighborId === 0) {
            return null;
        }

        let neighborBlock = Block.getById(neighborId);
        if (neighborBlock === null) {
            return null;
        }

        if (this.isOpaqueFullCube(neighborBlock, world, nx, ny, nz)) {
            return [{
                partBlock: neighborBlock,
                bbox: new BoundingBox(face.x, face.y, face.z, face.x + 1, face.y + 1, face.z + 1)
            }];
        }

        if (neighborBlock === multipartBlock) {
            return this.resolveParts(multipartBlock.getMultipart(world, nx, ny, nz)).map((part) => ({
                partBlock: part.partBlock,
                bbox: new BoundingBox(
                    part.bbox.minX + face.x, part.bbox.minY + face.y, part.bbox.minZ + face.z,
                    part.bbox.maxX + face.x, part.bbox.maxY + face.y, part.bbox.maxZ + face.z
                )
            }));
        }

        return null;
    }

    
    isPartFaceCoveredByPart(parts, partIndex, bbox, face) {
        let minA, maxA, minU, maxU, minV, maxV;
        if (face.x !== 0) {
            minA = 'minX'; maxA = 'maxX';
            minU = 'minY'; maxU = 'maxY';
            minV = 'minZ'; maxV = 'maxZ';
        } else if (face.y !== 0) {
            minA = 'minY'; maxA = 'maxY';
            minU = 'minX'; maxU = 'maxX';
            minV = 'minZ'; maxV = 'maxZ';
        } else {
            minA = 'minZ'; maxA = 'maxZ';
            minU = 'minX'; maxU = 'maxX';
            minV = 'minY'; maxV = 'maxY';
        }

        let positive = face.x > 0 || face.y > 0 || face.z > 0;
        let plane = positive ? bbox[maxA] : bbox[minA];

        for (let i = 0; i < parts.length; i++) {
            if (i === partIndex) {
                continue;
            }

            let otherBlock = parts[i].partBlock;
            if (otherBlock && !otherBlock.occludesNeighborFaces()) {
                continue;
            }

            let other = parts[i].bbox;

            if (positive) {
                if (other[minA] > plane + PART_FACE_EPSILON
                    || other[maxA] <= plane + PART_FACE_EPSILON) {
                    continue;
                }
            } else {
                if (other[maxA] < plane - PART_FACE_EPSILON
                    || other[minA] >= plane - PART_FACE_EPSILON) {
                    continue;
                }
            }

            if (other[minU] > bbox[minU] + PART_FACE_EPSILON
                || other[maxU] < bbox[maxU] - PART_FACE_EPSILON
                || other[minV] > bbox[minV] + PART_FACE_EPSILON
                || other[maxV] < bbox[maxV] - PART_FACE_EPSILON) {
                continue;
            }

            return true;
        }

        return false;
    }

    isPartFaceAtBoundary(bbox, face) {
        if (face.x !== 0) {
            return face.x > 0
                ? Math.abs(bbox.maxX - 1) <= PART_FACE_EPSILON
                : Math.abs(bbox.minX) <= PART_FACE_EPSILON;
        }
        if (face.y !== 0) {
            return face.y > 0
                ? Math.abs(bbox.maxY - 1) <= PART_FACE_EPSILON
                : Math.abs(bbox.minY) <= PART_FACE_EPSILON;
        }
        return face.z > 0
            ? Math.abs(bbox.maxZ - 1) <= PART_FACE_EPSILON
            : Math.abs(bbox.minZ) <= PART_FACE_EPSILON;
    }

    isOpaqueFullCube(block, world, x, y, z) {
        if (block === null || block.multipart || block.path
            || !block.occludesNeighborFaces() || !block.isSolid()) {
            return false;
        }

        let bbox = block.getBoundingBox(world, x, y, z);
        return bbox !== null
            && bbox.minX <= PART_FACE_EPSILON
            && bbox.minY <= PART_FACE_EPSILON
            && bbox.minZ <= PART_FACE_EPSILON
            && bbox.maxX >= 1 - PART_FACE_EPSILON
            && bbox.maxY >= 1 - PART_FACE_EPSILON
            && bbox.maxZ >= 1 - PART_FACE_EPSILON;
    }

    renderSolidBlock(world, block, ambientOcclusion, x, y, z) {
        let boundingBox = block.getBoundingBox(world, x, y, z);
        let blockData = this.getBlockDataAt(world, x, y, z);
        let blockAmbientOcclusion = block.getAmbientOcclusion() && ambientOcclusion;

        for (let i = 0; i < FACES.length; i++) {
            let face = FACES[i];
            let neighborId = world ? world.getBlockAtFace(x, y, z, face) : undefined;
            let neighborBlock = world ? Block.getById(neighborId) : null;

            if (world === null || block.shouldRenderFace(world, x, y, z, face, neighborId) || (neighborBlock !== null && (neighborBlock.path === true || neighborBlock.noFaceCull === true || neighborBlock.multipart === true))) {
                this.renderFace(world, block, boundingBox, face, blockAmbientOcclusion, x, y, z, blockData);
            }
        }
    }

    renderLiquid(world, block, x, y, z) {
        const chunkX = x >> 4;
        const chunkY = y >> 4;
        const chunkZ = z >> 4;
        const liquidId = block.id;

        const textureName = block.getTextureForFace(EnumBlockFace.TOP);
        let minU, maxU, minV, maxV;
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            let uvs = this.worldRenderer.textureAtlas.getUVs(textureName);
            minU = uvs.minU;
            maxU = uvs.maxU;
            minV = uvs.minV;
            maxV = uvs.maxV;
        } else {
            let textureIndex = block.getTextureForFace(EnumBlockFace.TOP);
            minU = (textureIndex % 16) / 16.0;
            maxU = minU + (16 / 256);
            minV = Math.floor(textureIndex / 16) / 16.0;
            maxV = minV + (16 / 256);
        }
        minV = 1 - minV;
        maxV = 1 - maxV;

        let color = block.getColor(world, x, y, z, EnumBlockFace.TOP);
        let red = (color >> 16 & 255) / 255.0;
        let green = (color >> 8 & 255) / 255.0;
        let blue = (color & 255) / 255.0;

        const lightLevel = world === null ? 15 : this.getEffectiveLightLevel(world, x, y + 0.9, z);
        const brightness = 0.9 / 15.0 * lightLevel + 0.1;

        const isLiquidAt = (nx, ny, nz) => world !== null && world.getBlockAt(nx, ny, nz) === liquidId;

        const isOpaqueFullCubeAt = (nx, ny, nz) => {
            if (world === null) return false;
            const neighborId = world.getBlockAt(nx, ny, nz);
            if (neighborId === 0) return false;
            const neighbor = Block.getById(neighborId);
            if (neighbor === null || !neighbor.isSolid() || !neighbor.occludesNeighborFaces()) return false;
            const box = neighbor.getBoundingBox(world, nx, ny, nz);
            return box !== null && box.minX === 0 && box.minY === 0 && box.minZ === 0 &&
                   box.maxX === 1 && box.maxY === 1 && box.maxZ === 1;
        };

        if (world === null || (!isLiquidAt(x, y + 1, z) && !isOpaqueFullCubeAt(x, y + 1, z))) {
            const shade = brightness * EnumBlockFace.TOP.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
            this.tessellator.addLiquidFace(world, liquidId, EnumBlockFace.TOP, chunkX, chunkY, chunkZ, x, y, z, minU, minV, maxU, maxV);
        }

        const belowId = world === null ? 1 : world.getBlockAt(x, y - 1, z);
        const belowBlock = belowId === 0 ? null : Block.getById(belowId);
        if (world === null || ((belowBlock === null || !belowBlock.isSolid()) && !isLiquidAt(x, y - 1, z))) {
            const shade = brightness * EnumBlockFace.BOTTOM.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
            this.tessellator.addLiquidFace(world, liquidId, EnumBlockFace.BOTTOM, chunkX, chunkY, chunkZ, x, y, z, minU, minV, maxU, maxV);
        }

        const sides = [
            { face: EnumBlockFace.NORTH, dx: 0, dz: -1 },
            { face: EnumBlockFace.SOUTH, dx: 0, dz: 1 },
            { face: EnumBlockFace.WEST, dx: -1, dz: 0 },
            { face: EnumBlockFace.EAST, dx: 1, dz: 0 }
        ];
        for (const side of sides) {
            if (world !== null && isLiquidAt(x + side.dx, y, z + side.dz)) continue;
            if (world !== null && isOpaqueFullCubeAt(x + side.dx, y, z + side.dz)) continue;
            const shade = brightness * side.face.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
            this.tessellator.addLiquidFace(world, liquidId, side.face, chunkX, chunkY, chunkZ, x, y, z, minU, minV, maxU, maxV);
        }
    }

    renderPath(world, block, ambientOcclusion, x, y, z) {
        let boundingBox = new BoundingBox(0, 0, 0, 1, 1 - (1/16), 1);
        let blockData = this.getBlockDataAt(world, x, y, z);
        let blockAmbientOcclusion = block.getAmbientOcclusion() && ambientOcclusion;

        for (let i = 0; i < FACES.length; i++) {
            let face = FACES[i];
            let neighborId = world ? world.getBlockAtFace(x, y, z, face) : undefined;
            let neighborBlock = world ? Block.getById(neighborId) : null;

            if (world === null || block.shouldRenderFace(world, x, y, z, face, neighborId) || (neighborBlock !== null && (neighborBlock.path === true || neighborBlock.noFaceCull === true || neighborBlock.multipart === true))) {
                this.renderFace(world, block, boundingBox, face, blockAmbientOcclusion, x, y, z, blockData);
            }
        }
    }

    
    getBlockDataAt(world, x, y, z) {
        if (!world) return 0;
        const chunk = world.getChunkAt(x >> 4, z >> 4);
        return chunk ? chunk.getBlockDataAt(x & 15, y, z & 15) : 0;
    }

    renderFace(world, block, boundingBox, face, ambientOcclusion, x, y, z, knownBlockData = undefined) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        let blockData = knownBlockData !== undefined
            ? knownBlockData
            : this.getBlockDataAt(world, x, y, z);

        let minX = x + boundingBox.minX;
        let minY = y + boundingBox.minY;
        let minZ = z + boundingBox.minZ;
        let maxX = x + boundingBox.maxX;
        let maxY = y + boundingBox.maxY;
        let maxZ = z + boundingBox.maxZ;

        let minU, minV;
        let maxU, maxV;
        
        const atlas = this.worldRenderer.textureAtlas;
        if (atlas && atlas.isLoaded()) {
            let textureName = block.getTextureForFace(face, blockData, x, y, z, world);
            let uvs = atlas.getUVs(textureName);
            minU = uvs.minU;
            maxU = uvs.maxU;
            minV = uvs.minV;
            maxV = uvs.maxV;
        } else {
            let textureIndex = block.getTextureForFace(face, blockData, x, y, z, world);
            minU = (textureIndex % 16) / 16.0;
            maxU = minU + (16 / 256);
            minV = Math.floor(textureIndex / 16) / 16.0;
            maxV = minV + (16 / 256);
        }
        
        let height = boundingBox.maxY - boundingBox.minY;

        let uSpan = maxU - minU;
        let vSpan = maxV - minV;

        const tileMinU = minU;
        const tileMinV = minV;

        minU = tileMinU + uSpan * (face.isXAxis() ? boundingBox.minZ : boundingBox.minX);
        maxU = tileMinU + uSpan * (face.isXAxis() ? boundingBox.maxZ : boundingBox.maxX);

        if (face.isYAxis()) {
            minV = tileMinV + vSpan * boundingBox.minZ;
            maxV = tileMinV + vSpan * boundingBox.maxZ;
        } else if (block?.topAlign === true) {
            minV = tileMinV;
            maxV = tileMinV + (vSpan * height);
        } else {
            minV = tileMinV + vSpan * (1 - boundingBox.maxY);
            maxV = tileMinV + vSpan * (1 - boundingBox.minY);
        }

        const wrapsU = minU < tileMinU - FACE_UV_EPSILON
            || maxU > tileMinU + uSpan + FACE_UV_EPSILON;
        const wrapsV = minV < tileMinV - FACE_UV_EPSILON
            || maxV > tileMinV + vSpan + FACE_UV_EPSILON;

        minV = 1 - minV;
        maxV = 1 - maxV;

        const flip = typeof block.getFlipForFace !== 'function'
            || block.getFlipForFace === Block.prototype.getFlipForFace
            ? Block.FLIP_NONE
            : block.getFlipForFace(face, blockData, x, y, z, world);

        if ((flip & Block.FLIP_U) !== 0) {
            const swapU = minU;
            minU = maxU;
            maxU = swapU;
        }
        if ((flip & Block.FLIP_V) !== 0) {
            const swapV = minV;
            minV = maxV;
            maxV = swapV;
        }

        let uSlideOffset = 0;
        let wrapFlags = wrapsU ? 1 : 0;
        if (wrapsV) {
            wrapFlags |= 2;
        }
        if (world && typeof block.doSlideFaceAnimate === 'function'
            && block.doSlideFaceAnimate !== Block.prototype.doSlideFaceAnimate) {
            let slideOffset = 0;
            let tick = world.ticks || 0;
            let result = block.doSlideFaceAnimate(face, x, y, z, world, tick);
            if (typeof result === 'object' && result !== null) {
                if (result[face]) {
                    slideOffset = result[face];
                } else if (face && face.name && result[face.name]) {
                    slideOffset = result[face.name];
                } else if (face && typeof face.ordinal === 'function' && result[face.ordinal()]) {
                    slideOffset = result[face.ordinal()];
                } else if (face && face.ordinal !== undefined && result[face.ordinal]) {
                    slideOffset = result[face.ordinal];
                }
            } else {
                slideOffset = result || 0;
            }
            slideOffset = ((slideOffset % 16) + 16) % 16;
            
            if (slideOffset !== 0) {
                let slideFraction = slideOffset / 16.0;
                let uRange = maxU - minU;
                uSlideOffset = uRange * slideFraction;
                wrapFlags |= 1;
            }
        }

        let wrapRect;
        if (wrapFlags === 0) {
            wrapRect = null;
        } else if (wrapsU || wrapsV) {
            wrapRect = [tileMinU, 1 - tileMinV - vSpan, uSpan, vSpan, wrapFlags];
        } else {
            wrapRect = [minU, minV, maxU - minU, maxV - minV, wrapFlags];
        }

        let rotation = block.getRotationForFace === Block.prototype.getRotationForFace
            ? 0
            : block.getRotationForFace(face, blockData, x, y, z, world);

        let color = block.getColor === Block.prototype.getColor
            ? 0xffffff
            : block.getColor(world, x, y, z, face);
        let red = (color >> 16 & 255) / 255.0;
        let green = (color >> 8 & 255) / 255.0;
        let blue = (color & 255) / 255.0;

        if (!ambientOcclusion) {
            let level;
            if (world === null) {
                level = 15;
            } else {
                level = this.getEffectiveLightLevel(world, x, y, z);
                for (let i = 0; i < 6; i++) {
                    let l = this.getEffectiveLightLevel(world, x + FACE_DX[i], y + FACE_DY[i], z + FACE_DZ[i]);
                    if (l > level) level = l;
                }
            }
            let brightness = 0.9 / 15.0 * level + 0.1;
            let shade = brightness * face.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
        }

        const ao = ambientOcclusion
            ? {face: face, x: x, y: y, z: z, bbox: boundingBox}
            : null;

        this.addFace(world, face, ao, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, red, green, blue, rotation, uSlideOffset, wrapRect,
            tileMinU, 1 - tileMinV - vSpan, uSpan, vSpan);
    }

    renderDecoration(world, block, x, y, z) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        let blockData = world ? world.getBlockDataAt(x, y, z) : 0;
        let textureName = block.getTextureForFace(EnumBlockFace.NORTH, blockData, x, y, z, world);
        let minU, maxU, minV, maxV;
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            let uvs = this.worldRenderer.textureAtlas.getUVs(textureName);
            minU = uvs.minU;
            maxU = uvs.maxU;
            minV = uvs.minV;
            maxV = uvs.maxV;
        } else {
            let textureIndex = block.getTextureForFace(EnumBlockFace.NORTH, blockData, x, y, z, world);
            minU = (textureIndex % 16) / 16.0;
            maxU = minU + (16 / 256);
            minV = Math.floor(textureIndex / 16) / 16.0;
            maxV = minV + (16 / 256);
        }

        minV = 1 - minV;
        maxV = 1 - maxV;

        let color = block.getColor(world, x, y, z, EnumBlockFace.NORTH);
        let red = (color >> 16 & 255) / 255.0;
        let green = (color >> 8 & 255) / 255.0;
        let blue = (color & 255) / 255.0;

        if (world === null) {
            this.tessellator.setColor(red, green, blue);
        } else {
            let level = this.getEffectiveLightLevel(world, x, y, z);
            let brightness = 0.9 / 15.0 * level + 0.1;
            this.tessellator.setColor(red * brightness, green * brightness, blue * brightness);
        }

        this.addDecorationQuad(chunkX, chunkY, chunkZ, x, y, z, x + 1, y + 1, z + 1, minU, minV, maxU, maxV);
        this.addDecorationQuad(chunkX, chunkY, chunkZ, x + 1, y, z, x, y + 1, z + 1, minU, minV, maxU, maxV);
    }

    addDecorationQuad(chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV) {
        let cx = chunkX << 4;
        let cy = chunkY << 4;
        let cz = chunkZ << 4;

        this.tessellator.addVertexWithUV(minX - cx, minY - cy, minZ - cz, minU, maxV);
        this.tessellator.addVertexWithUV(maxX - cx, minY - cy, maxZ - cz, maxU, maxV);
        this.tessellator.addVertexWithUV(maxX - cx, maxY - cy, maxZ - cz, maxU, minV);
        this.tessellator.addVertexWithUV(minX - cx, maxY - cy, minZ - cz, minU, minV);

        this.tessellator.addVertexWithUV(minX - cx, minY - cy, minZ - cz, minU, maxV);
        this.tessellator.addVertexWithUV(minX - cx, maxY - cy, minZ - cz, minU, minV);
        this.tessellator.addVertexWithUV(maxX - cx, maxY - cy, maxZ - cz, maxU, minV);
        this.tessellator.addVertexWithUV(maxX - cx, minY - cy, maxZ - cz, maxU, maxV);
    }

    addFace(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, red = 1, green = 1, blue = 1, rotation = 0, uOffset = 0, wrapRect = null, tileU = null, tileV = null, tileURange = null, tileVRange = null) {
        this.tessellator.setTileWrap(wrapRect);

        const spinU = tileU === null ? minU : tileU;
        const spinV = tileV === null ? minV : tileV;
        const spinURange = tileURange === null ? maxU - minU : tileURange;
        const spinVRange = tileVRange === null ? maxV - minV : tileVRange;

        const addCorner = (x, y, z, u, v) => {
            let r = ((rotation % 4) + 4) % 4;
            if (r !== 0) {
                let localU = (u - spinU) / spinURange;
                let localV = (v - spinV) / spinVRange;
                if (r === 1) {
                    u = spinU + localV * spinURange;
                    v = spinV + (1 - localU) * spinVRange;
                } else if (r === 2) {
                    u = spinU + (1 - localU) * spinURange;
                    v = spinV + (1 - localV) * spinVRange;
                } else {
                    u = spinU + (1 - localV) * spinURange;
                    v = spinV + localU * spinVRange;
                }
            }
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, x, y, z, u + uOffset, v, red, green, blue);
        };

        if (face === EnumBlockFace.BOTTOM) {
            addCorner(maxX, minY, maxZ, maxU, maxV);
            addCorner(maxX, minY, minZ, maxU, minV);
            addCorner(minX, minY, minZ, minU, minV);
            addCorner(minX, minY, maxZ, minU, maxV);
        }
        if (face === EnumBlockFace.TOP) {
            addCorner(minX, maxY, maxZ, minU, maxV);
            addCorner(minX, maxY, minZ, minU, minV);
            addCorner(maxX, maxY, minZ, maxU, minV);
            addCorner(maxX, maxY, maxZ, maxU, maxV);
        }
        if (face === EnumBlockFace.NORTH) {
            addCorner(minX, maxY, minZ, maxU, minV);
            addCorner(minX, minY, minZ, maxU, maxV);
            addCorner(maxX, minY, minZ, minU, maxV);
            addCorner(maxX, maxY, minZ, minU, minV);
        }
        if (face === EnumBlockFace.SOUTH) {
            addCorner(minX, maxY, maxZ, minU, minV);
            addCorner(maxX, maxY, maxZ, maxU, minV);
            addCorner(maxX, minY, maxZ, maxU, maxV);
            addCorner(minX, minY, maxZ, minU, maxV);
        }
        if (face === EnumBlockFace.WEST) {
            addCorner(minX, minY, maxZ, maxU, maxV);
            addCorner(minX, minY, minZ, minU, maxV);
            addCorner(minX, maxY, minZ, minU, minV);
            addCorner(minX, maxY, maxZ, maxU, minV);
        }
        if (face === EnumBlockFace.EAST) {
            addCorner(maxX, maxY, maxZ, minU, minV);
            addCorner(maxX, maxY, minZ, maxU, minV);
            addCorner(maxX, minY, minZ, maxU, maxV);
            addCorner(maxX, minY, maxZ, minU, maxV);
        }

        this.tessellator.setTileWrap(null);
    }

    
    setCornerBrightness(world, ao, x, y, z, red = 1, green = 1, blue = 1) {
        const face = ao.face;
        const bbox = ao.bbox;

        const cellX = ao.x + face.x;
        const cellY = ao.y + face.y;
        const cellZ = ao.z + face.z;

        const centreX = ao.x + (bbox.minX + bbox.maxX) / 2;
        const centreY = ao.y + (bbox.minY + bbox.maxY) / 2;
        const centreZ = ao.z + (bbox.minZ + bbox.maxZ) / 2;

        let offAX = 0, offAY = 0, offAZ = 0;
        let offBX = 0, offBY = 0, offBZ = 0;

        if (face.x !== 0) {
            offAY = y > centreY ? 1 : -1;
            offBZ = z > centreZ ? 1 : -1;
        } else if (face.y !== 0) {
            offAX = x > centreX ? 1 : -1;
            offBZ = z > centreZ ? 1 : -1;
        } else {
            offAX = x > centreX ? 1 : -1;
            offBY = y > centreY ? 1 : -1;
        }

        const cell = this.getAoCell(world, cellX, cellY, cellZ, ao);
        const sideA = this.getAoCell(world, cellX + offAX, cellY + offAY, cellZ + offAZ, ao);
        const sideB = this.getAoCell(world, cellX + offBX, cellY + offBY, cellZ + offBZ, ao);
        const diagonal = this.getAoCell(world, cellX + offAX + offBX, cellY + offAY + offBY, cellZ + offAZ + offBZ, ao);

        const occludedA = this.isCellOccluding(sideA, cellX + offAX, cellY + offAY, cellZ + offAZ, x, y, z);
        const occludedB = this.isCellOccluding(sideB, cellX + offBX, cellY + offBY, cellZ + offBZ, x, y, z);

        const occludedDiagonal = (occludedA && occludedB)
            || this.isCellOccluding(diagonal, cellX + offAX + offBX, cellY + offAY + offBY, cellZ + offAZ + offBZ, x, y, z);

        const level = (cell.light
            + (occludedA ? 0 : sideA.light)
            + (occludedB ? 0 : sideB.light)
            + (occludedDiagonal ? 0 : diagonal.light)) / 4;

        let brightness = 0.9 / 15.0 * level + 0.1;
        let shading = brightness * face.getShading();

        this.tessellator.setColor(red * shading, green * shading, blue * shading);
    }

    
    getAoCell(world, cellX, cellY, cellZ, ao) {
        const dx = cellX - ao.x;
        const dy = cellY - ao.y;
        const dz = cellZ - ao.z;

        if (this.aoBlockX === ao.x && this.aoBlockY === ao.y && this.aoBlockZ === ao.z
            && dx >= -1 && dx <= 1 && dy >= -1 && dy <= 1 && dz >= -1 && dz <= 1) {
            const index = (dx + 1) * 9 + (dy + 1) * 3 + (dz + 1);
            let entry = this.aoCells[index];
            if (entry === undefined) {
                entry = this.sampleAoCell(world, cellX, cellY, cellZ);
                this.aoCells[index] = entry;
            }
            return entry;
        }

        return this.sampleAoCell(world, cellX, cellY, cellZ);
    }

    sampleAoCell(world, cellX, cellY, cellZ) {
        if (world === null) {
            return {light: 15, boxes: []};
        }

        let boxes = [];
        const typeId = world.getBlockAt(cellX, cellY, cellZ);

        if (typeId !== 0) {
            const block = Block.getById(typeId);
            if (block !== null && block.isSolid() && block.occludesNeighborFaces()
                && this.castsAmbientOcclusion(block)) {
                boxes = this.getOccluderBoxes(block, world, cellX, cellY, cellZ);
            }
        }

        return {light: this.getEffectiveLightLevel(world, cellX, cellY, cellZ), boxes: boxes};
    }

    
    castsAmbientOcclusion(block) {
        const flag = block.canCastAmbientOcclusion;
        return typeof flag === 'function' ? flag.call(block) : flag !== false;
    }

    
    getOccluderBoxes(block, world, cellX, cellY, cellZ) {
        if (block.multipart === true) {
            const parts = block.getMultipart(world, cellX, cellY, cellZ);
            if (!Array.isArray(parts)) {
                return [];
            }

            const boxes = [];
            for (let i = 0; i < parts.length; i++) {
                const box = Block.getPartBoundingBox(parts[i]);
                if (box !== null) {
                    boxes.push(box);
                }
            }
            return boxes;
        }

        const box = block.getBoundingBox(world, cellX, cellY, cellZ);
        return box === null ? [] : [box];
    }

    
    isCellOccluding(cell, cellX, cellY, cellZ, vx, vy, vz) {
        const boxes = cell.boxes;
        if (boxes.length === 0) {
            return false;
        }

        const probeX = Math.min(Math.max(vx, cellX + AO_PROBE), cellX + 1 - AO_PROBE);
        const probeY = Math.min(Math.max(vy, cellY + AO_PROBE), cellY + 1 - AO_PROBE);
        const probeZ = Math.min(Math.max(vz, cellZ + AO_PROBE), cellZ + 1 - AO_PROBE);

        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (cellX + box.minX < probeX + AO_PROBE && cellX + box.maxX > probeX - AO_PROBE
                && cellY + box.minY < probeY + AO_PROBE && cellY + box.maxY > probeY - AO_PROBE
                && cellZ + box.minZ < probeZ + AO_PROBE && cellZ + box.maxZ > probeZ - AO_PROBE) {
                return true;
            }
        }

        return false;
    }

    addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, x, y, z, u, v, red, green, blue) {
        if (ambientOcclusion === true) {
            this.setAverageBrightness(world, face, x, y, z, red, green, blue);
        } else if (ambientOcclusion !== null && ambientOcclusion !== false) {
            this.setCornerBrightness(world, ambientOcclusion, x, y, z, red, green, blue);
        }

        this.tessellator.addVertexWithUV(x - (chunkX << 4), y - (chunkY << 4), z - (chunkZ << 4), u, v);
    }

    setAverageBrightness(world, face, x, y, z, red = 1, green = 1, blue = 1) {
        let lightLevelAtThisCorner = this.getAverageLightLevelAt(world, x, y, z);

        let brightness = 0.9 / 15.0 * lightLevelAtThisCorner + 0.1;
        let shading = brightness * face.getShading();

        this.tessellator.setColor(red * shading, green * shading, blue * shading);
    }

    getEffectiveLightLevel(world, x, y, z) {
        if (!world) return 15;
        
        let typeId = world.getBlockAt(x, y, z);
        let block = !typeId ? null : Block.getById(typeId);

        if (!block || block.isTranslucent()) {
            return world.getTotalLightAt(x, y, z);
        } 
        
        if (!block.canCastAmbientOcclusion() || block.multipart === true) {
            let maxSurroundingLight = 0;
            for (let i = 0; i < 6; i++) {
                let light = world.getTotalLightAt(x + FACE_DX[i], y + FACE_DY[i], z + FACE_DZ[i]);
                if (light > maxSurroundingLight) {
                    maxSurroundingLight = light;
                }
            }
            return maxSurroundingLight;
        }

        return world.getTotalLightAt(x, y, z);
    }

    getAverageLightLevelAt(world, x, y, z) {
        if (!world) {
            return 15;
        }

        let totalLightLevel = 0;
        let totalBlocks = 0;

        for (let offsetX = -1; offsetX <= 0; offsetX++) {
            for (let offsetY = -1; offsetY <= 0; offsetY++) {
                for (let offsetZ = -1; offsetZ <= 0; offsetZ++) {
                    let bx = x + offsetX;
                    let by = y + offsetY;
                    let bz = z + offsetZ;
                    
                    let typeId = world.getBlockAt(bx, by, bz);
                    let block = !typeId ? null : Block.getById(typeId);

                    if (!block || block.isTranslucent()) {
                        totalLightLevel += world.getTotalLightAt(bx, by, bz);
                        totalBlocks++;
                    } 
                    else if (!block.canCastAmbientOcclusion() || block.multipart === true) {
                        let maxSurroundingLight = 0;
                        for (let i = 0; i < 6; i++) {
                            let light = world.getTotalLightAt(bx + FACE_DX[i], by + FACE_DY[i], bz + FACE_DZ[i]);
                            if (light > maxSurroundingLight) {
                                maxSurroundingLight = light;
                            }
                        }
                        totalLightLevel += maxSurroundingLight;
                        totalBlocks++;
                    } 
                    else {
                        if (offsetY === 0) {
                            totalBlocks++;
                        }
                    }
                }
            }
        }

        return totalBlocks === 0 ? 0 : totalLightLevel / totalBlocks;
    }

    renderTrafficCone(world, x, y, z) {
        this.renderCustomModel(
            this.modelTessellator,
            getTrafficConeModel(),
            world, x, y, z, 0
        );
    }

    renderSnailStatue(world, x, y, z) {
        this.renderCustomModel(
            this.snailModelTessellator,
            getSnailModel(),
            world, x, y, z, 0
        );
    }

    renderTrafficBarrier(world, x, y, z) {
        const data = world === null ? 2 : world.getBlockDataAt(x, y, z);
        let facing = data & 7;
        if (facing === 0) {
            facing = 2;
        }

        const rotation = facing === 3 ? Math.PI
            : facing === 4 ? Math.PI / 2
            : facing === 5 ? -Math.PI / 2
            : 0;

        this.renderCustomModel(
            this.barrierModelTessellator,
            getTrafficBarrierModel(),
            world, x, y, z, rotation
        );
    }

    renderCustomModel(tessellator, model, world, x, y, z, rotation = 0) {
        if (model === null || !this.modelPassActive) {
            return;
        }

        const chunkX = x >> 4;
        const chunkY = y >> 4;
        const chunkZ = z >> 4;
        const originX = chunkX << 4;
        const originY = chunkY << 4;
        const originZ = chunkZ << 4;

        const lightLevel = world === null ? 15 : this.getEffectiveLightLevel(world, x, y, z);
        const brightness = 0.9 / 15.0 * lightLevel + 0.1;

        tessellator.material.alphaTest = 0.5;

        const order = [0, 2, 1, 1];
        const cos = Math.cos(rotation);
        const sin = Math.sin(rotation);

        for (const face of model.faces) {
            let [nx, ny, nz] = face.normal;
            const rnx = nx * cos + nz * sin;
            const rnz = -nx * sin + nz * cos;
            nx = rnx;
            nz = rnz;

            const ax = Math.abs(nx);
            const ay = Math.abs(ny);
            const az = Math.abs(nz);
            const shading = ay >= ax && ay >= az ? 1.0 : ax >= az ? 0.6 : 0.8;
            tessellator.setColor(shading * brightness, shading * brightness, shading * brightness);

            for (const index of order) {
                const vertex = face.vertices[index];
                const vx = vertex.position[0];
                const vz = vertex.position[2];

                const rx = vx * cos + vz * sin;
                const rz = -vx * sin + vz * cos;

                tessellator.addVertexWithUV(
                    x - originX + 0.5 + rx,
                    y - originY + vertex.position[1],
                    z - originZ + 0.5 + rz,
                    vertex.uv[0],
                    vertex.uv[1]
                );
            }
        }
    }

    renderTorch(world, block, x, y, z) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        let size = 1 / 16;

        let distortX = 0;
        let distortZ = 0;

        if (world != null) {
            switch (world.getBlockDataAt(x, y, z)) {
                case 1:
                    distortX = -0.2;
                    break;
                case 2:
                    distortX = 0.2;
                    break;
                case 3:
                    distortZ = -0.2;
                    break;
                case 4:
                    distortZ = 0.2;
                    break;
            }
        }

        let centerX = 0.5 + distortX * 1.5;
        let centerZ = 0.5 + distortZ * 1.5;

        if (distortX !== 0 || distortZ !== 0) {
            y += 0.2;
        }

        let minX = x + centerX - size;
        let minY = y;
        let minZ = z + centerZ - size;
        let maxX = x + centerX + size;
        let maxY = y + 10 / 16;
        let maxZ = z + centerZ + size;

        let minU, minV, maxU, maxV;
        
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            let textureName = block.getTextureForFace(EnumBlockFace.NORTH, world != null ? world.getBlockDataAt(x, y, z) : 0, x, y, z, world);
            let uvs = this.worldRenderer.textureAtlas.getUVs(textureName);
            let uOffset = 7 / 16;
            let vOffset = 6 / 16;
            let uSize = 2 / 16;
            let vSize = 10 / 16;
            
            minU = uvs.minU + uOffset * (uvs.maxU - uvs.minU);
            minV = uvs.minV + vOffset * (uvs.maxV - uvs.minV);
            maxU = minU + uSize * (uvs.maxU - uvs.minU);
            maxV = minV + vSize * (uvs.maxV - uvs.minV);
        } else {
            let textureIndex = block.getTextureForFace(EnumBlockFace.NORTH, world != null ? world.getBlockDataAt(x, y, z) : 0, x, y, z, world);
            minU = (textureIndex % 16) / 16.0;
            minV = Math.floor(textureIndex / 16) / 16.0;
            
            minU += 7 / 256;
            minV += 6 / 256;
            
            maxU = minU + 2 / 256;
            maxV = minV + 10 / 256;
        }

        minV = 1 - minV;
        maxV = 1 - maxV;

        this.tessellator.setColor(1, 1, 1);

        this.addDistortFace(world, EnumBlockFace.NORTH, false, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX, distortZ);
        this.addDistortFace(world, EnumBlockFace.EAST, false, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX, distortZ);
        this.addDistortFace(world, EnumBlockFace.SOUTH, false, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX, distortZ);
        this.addDistortFace(world, EnumBlockFace.WEST, false, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX, distortZ);
        let atlasSize = this.worldRenderer.textureAtlas ? this.worldRenderer.textureAtlas.atlasSize : 256;
        this.addFace(world, EnumBlockFace.TOP, false, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV + 8 / atlasSize);
    }

    renderLever(world, block, x, y, z, ambientOcclusion = false) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        let faceIndex = 0;
        if (world != null) {
            const data = world.getBlockDataAt(x, y, z) || 0;
            faceIndex = (data >> 1) & 7;
        }
        this.tessellator.setRotation(
            x + 0.5 - (chunkX << 4),
            y + 0.5 - (chunkY << 4),
            z + 0.5 - (chunkZ << 4),
            faceIndex
        );

        this.renderFakeBlockWithBlockClass(world, new this.constructor.DummyBlockTopFace(998, 4, 'cobblestone', 'cobblestone_lever_base'), true, x, y, z, (1/16)*4, 0.0, (1/16)*5, (1/16)*12, (1/16)*3, (1/16)*11);
        let size = 1 / 16;
        let distortX2 = 0;
        let distortZ2 = 0;
        if (world != null) {
            const data = world.getBlockDataAt(x, y, z) || 0;
            switch (data & 1) {
                case 0:
                    distortX2 = -0.2;
                    break;
                case 1:
                    distortX2 = 0.2;
                    break;
            }
        }
        let centerX = 0.5;
        let centerZ = 0.5;
        let minX = x + centerX - size;
        let minY = y;
        let minZ = z + centerZ - size;
        let maxX = x + centerX + size;
        let maxY = y + 10 / 16;
        let maxZ = z + centerZ + size;

        let topYMinX = distortX2 < 0 ? maxY - (.75 / 16) : maxY;
        let topYMaxX = distortX2 >= 0 ? maxY - (.75 / 16) : maxY;

        let uvs = this.worldRenderer.textureAtlas.getUVs("lever");
        let uOffset = 7 / 16;
        let vOffset = 6 / 16;
        let uSize = 2 / 16;
        let vSize = 10 / 16;

        let minU = uvs.minU + uOffset * (uvs.maxU - uvs.minU);
        let minV = uvs.minV + vOffset * (uvs.maxV - uvs.minV);
        let maxU = minU + uSize * (uvs.maxU - uvs.minU);
        let maxV = minV + vSize * (uvs.maxV - uvs.minV);

        minV = 1 - minV;
        maxV = 1 - maxV;
        this.tessellator.setColor(1, 1, 1);
        
        this.addLeverFace(world, EnumBlockFace.NORTH, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        this.addLeverFace(world, EnumBlockFace.EAST, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        this.addLeverFace(world, EnumBlockFace.SOUTH, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        this.addLeverFace(world, EnumBlockFace.WEST, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        
        let leverPixelV = 8 / this.worldRenderer.textureAtlas.atlasSize;
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, minX + distortX2, topYMinX, maxZ + distortZ2, minU, maxV + leverPixelV);
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, minX + distortX2, topYMinX, minZ + distortZ2, minU, minV);
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, maxX + distortX2, topYMaxX, minZ + distortZ2, maxU, minV);
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, maxX + distortX2, topYMaxX, maxZ + distortZ2, maxU, maxV + leverPixelV);

        if (Array.isArray(block.renderInside)) {
            this.tessellator.material.alphaTest = 0.5;
            this.renderParts(world, block.renderInside, x, y, z, true, false, null, ambientOcclusion);
        }

        this.tessellator.clearRotation();
    }

    addLeverFace(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX, distortZ, topYMinX = maxY, topYMaxX = maxY) {
        if (face === EnumBlockFace.NORTH) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, topYMinX, minZ + distortZ, minU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, minY, minZ, maxU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, topYMaxX, minZ + distortZ, maxU, minV);
        }
        if (face === EnumBlockFace.SOUTH) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, topYMinX, maxZ + distortZ, maxU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, topYMaxX, maxZ + distortZ, minU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, minY, maxZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, maxZ, maxU, maxV);
        }
        if (face === EnumBlockFace.WEST) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, maxZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, maxU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, topYMinX, minZ, maxU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, topYMinX, maxZ, minU, minV);
        }
        if (face === EnumBlockFace.EAST) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, topYMaxX, maxZ + distortZ, maxU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, topYMaxX, minZ + distortZ, minU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, minY, minZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, minY, maxZ, maxU, maxV);
        }
    }

    renderSign(world, block, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const xAxis = data & 1;

        this.renderFakeBlockWithBlockClassWithBoundingBox(world, BlockRegistry.LOG, false, x, y, z, 
            new BoundingBox(0.4375, 0, 0.4375, 0.5625, 0.4375, 0.5625));

        if (xAxis) {
            this.renderFakeBlockWithBlockClassWithBoundingBox(world, BlockRegistry.WOOD, false, x, y, z,
                new BoundingBox(0, 0.4375, 0.4375, 1, 1, 0.5625));
        } else {
            this.renderFakeBlockWithBlockClassWithBoundingBox(world, BlockRegistry.WOOD, false, x, y, z,
                new BoundingBox(0.4375, 0.4375, 0, 0.5625, 1, 1));
        }
    }

    addDistortFace(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX, distortZ) {
        if (face === EnumBlockFace.NORTH) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, maxY, minZ, minU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, minY, minZ + distortZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, minY, minZ + distortZ, maxU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, maxY, minZ, maxU, minV);
        }
        if (face === EnumBlockFace.SOUTH) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, maxY, maxZ, maxU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, maxY, maxZ, minU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, minY, maxZ + distortZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, minY, maxZ + distortZ, maxU, maxV);
        }
        if (face === EnumBlockFace.WEST) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, minY, maxZ + distortZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX + distortX, minY, minZ + distortZ, maxU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, maxY, minZ, maxU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, maxY, maxZ, minU, minV);
        }
        if (face === EnumBlockFace.EAST) {
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, maxY, maxZ, maxU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX, maxY, minZ, minU, minV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, minY, minZ + distortZ, minU, maxV);
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, maxX + distortX, minY, maxZ + distortZ, maxU, maxV);
        }
    }

    
    getUnlitGUIMaterial(alphaTest = 0.1, tessellator = this.tessellator) {
        let material = Tessellator.applyTileWrap(tessellator.unlitMaterial.clone());
        material.transparent = true;
        material.alphaTest = alphaTest;
        material.depthTest = true;
        material.depthWrite = true;
        return material;
    }

    
    getSpriteItemTexture(textureName) {
        const atlas = this.worldRenderer.textureAtlas;
        if (!atlas || !atlas.isLoaded() || !atlas.canvas) {
            return null;
        }

        const coords = atlas.textureMap.get(textureName);
        if (!coords) {
            return null;
        }

        const size = atlas.textureSize;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;

        const context = canvas.getContext("2d");
        context.imageSmoothingEnabled = false;
        context.drawImage(atlas.canvas, coords.x, coords.y, size, size, 0, 0, size, size);

        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;
        texture.flipY = false;
        return texture;
    }

    
    createHeldItemSprite(block) {
        const texture = this.getSpriteItemTexture(block.getTextureForFace(EnumBlockFace.NORTH));
        if (texture === null) {
            return null;
        }

        return createSpriteItemMesh(texture);
    }

    
    createGeneratedItemMesh(block, brightness, firstPerson = false) {
        return this.createHeldItemSprite(block);
    }

    
    createTridentItemModel() {
        return null;
    }

    renderBlockInHandThirdPerson(group, block, brightness) {
        if (block.getRenderType() === BlockRenderType.ITEM) {
            const spriteMesh = this.createHeldItemSprite(block);
            if (spriteMesh !== null) {
                group.add(spriteMesh);
                spriteMesh.position.set(0, 9, -5);
                spriteMesh.rotation.y = Math.PI / 4;
                spriteMesh.scale.set(6, 6, 6);
                return;
            }
        }

        this.tessellator.startDrawing();
        this.beginModelPass();
        this.renderBlock(null, block, false, 0, 0, 0);
        this.tessellator.transformBrightness(brightness);
        this.transformModelBrightness(brightness);

        const meshes = [];
        if (this.tessellator.addedVertices > 0) {
            const mesh = this.tessellator.draw(group);
            mesh.material = this.getUnlitGUIMaterial();
            meshes.push(mesh);
        }
        const modelMesh = this.flushModelPass(group);
        if (modelMesh !== null) {
            modelMesh.material = this.getUnlitGUIMaterial(0.5, modelMesh.userData.modelTessellator);
            meshes.push(modelMesh);
        }

        for (const mesh of meshes) {
            mesh.geometry.center();
            mesh.position.x = 0;
            mesh.position.y = 9;
            mesh.position.z = -5;
            mesh.rotation.y = Math.PI / 4;
            mesh.scale.x = 6;
            mesh.scale.y = -6;
            mesh.scale.z = 6;
        }
    }

    renderBlockInFirstPerson(group, block, brightness) {
        if (block.getRenderType() === BlockRenderType.ITEM) {
            const spriteMesh = this.createHeldItemSprite(block);
            if (spriteMesh !== null) {
                group.add(spriteMesh);
                spriteMesh.scale.set(19, 19, 19);
                spriteMesh.position.y += 8;

                if (block.isTool === true) {
                    spriteMesh.rotation.x -= Math.PI / 2.5;
                    spriteMesh.rotation.z -= Math.PI / 6;
                }
                return;
            }
        }

        this.tessellator.startDrawing();
        this.beginModelPass();
        this.renderBlock(null, block, false, 0, 0, 0);
        this.tessellator.transformBrightness(brightness);
        this.transformModelBrightness(brightness);

        const meshes = [];
        if (this.tessellator.addedVertices > 0) {
            const mesh = this.tessellator.draw(group);
            mesh.material = this.getUnlitGUIMaterial();
            meshes.push(mesh);
        }
        const modelMesh = this.flushModelPass(group);
        if (modelMesh !== null) {
            modelMesh.material = this.getUnlitGUIMaterial(0.5, modelMesh.userData.modelTessellator);
            meshes.push(modelMesh);
        }

        for (const mesh of meshes) {
            mesh.geometry.center();
            mesh.scale.x = 16;
            mesh.scale.y = 16;
            mesh.scale.z = 16;
            if (block.getRenderType() === BlockRenderType.ITEM) {
                mesh.scale.x = 19;
                mesh.scale.y = 19;
                mesh.scale.z = 19;
                mesh.position.y += 8;
                if (block.isTool === true) {
                    mesh.rotation.x -= Math.PI / 2.5;
                    mesh.rotation.z -= Math.PI / 6;
                }
            }
        }
    }

    renderGuiBlock(group, block, x, y, size, brightness) {
        this.tessellator.startDrawing();
        this.tessellator.setColor(1, 1, 1);
        this.beginModelPass();

        const customRenderHandled = block
            ? block.onRender(null, 0, 0, 0, this)
            : false;

        if (!customRenderHandled) {
            if (!block.path && block.multipart !== true) {
                switch (block.getRenderType()) {
                    case (block?.renderAsItemInInventory === true):
                        this.renderGuiItem(block);
                        break;
                    case BlockRenderType.BLOCK:
                        let boundingBox = block.getBoundingBox(null, 0, 0, 0);
                        this.renderFace(null, block, boundingBox, EnumBlockFace.TOP, false, 0, 0, 0);
                        this.renderFace(null, block, boundingBox, EnumBlockFace.NORTH, false, 0, 0, 0);
                        this.renderFace(null, block, boundingBox, EnumBlockFace.EAST, false, 0, 0, 0);
                        break;
                    case BlockRenderType.SIGN:
                        this.renderSign(null, block, 0, 0, 0);
                        break;
                    default:
                        this.renderGuiItem(block);
                        break;
                }
            } else if (block.multipart === true) {
                this.renderMultipart(null, block, false, 0, 0, 0);
            } else if (block.path) {
                this.renderPath(null, block, false, 0, 0, 0);
            }
        }

        this.tessellator.transformBrightness(brightness);
        this.transformModelBrightness(brightness);

        const meshes = [];

        if (this.tessellator.addedVertices > 0) {
            const mesh = this.tessellator.draw(group);
            mesh.material = this.getUnlitGUIMaterial();
            meshes.push(mesh);
        }

        const modelMesh = this.flushModelPass(group);
        if (modelMesh !== null) {
            modelMesh.material = this.getUnlitGUIMaterial(0.5, modelMesh.userData.modelTessellator);
            meshes.push(modelMesh);
        }

        for (const mesh of meshes) {
            mesh.geometry.center();

            if (block.multipart === true || block.path) {
                mesh.rotation.x = MathHelper.toRadians(45 / 1.5);
                mesh.rotation.y = -MathHelper.toRadians(45 + 90);
            } else {
                switch (block.getRenderType()) {
                    case BlockRenderType.BLOCK:
                    case BlockRenderType.SIGN:
                        mesh.rotation.x = MathHelper.toRadians(45 / 1.5);
                        mesh.rotation.y = -MathHelper.toRadians(45 + 90);
                        break;
                    default:
                        mesh.rotation.y = MathHelper.toRadians(180);
                        break;
                }
            }

            mesh.position.x = x;
            mesh.position.y = -y;
            mesh.position.z = -10;

            const meshSize = block.getRenderType() === BlockRenderType.BLOCK
                || block.getRenderType() === BlockRenderType.SIGN
                || block.multipart === true
                || block.path
                ? size
                : size + 5;
            mesh.scale.x = meshSize;
            mesh.scale.y = meshSize;
            mesh.scale.z = meshSize;
        }
    }

    renderGuiItem(block) {
        let minX = 0;
        let minY = 0;
        let minZ = 0;
        let maxX = 1;
        let maxY = 1;
        let maxZ = 1;

        let offset = (1 / 256);
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            offset = 1 / this.worldRenderer.textureAtlas.atlasSize;
        }

        let minU, maxU, minV, maxV;
        
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            let textureName = block.getTextureForFace(EnumBlockFace.NORTH);
            let uvs = this.worldRenderer.textureAtlas.getUVs(textureName);
            minU = uvs.minU;
            maxU = uvs.maxU;
            minV = uvs.minV;
            maxV = uvs.maxV;
        } else {
            let textureIndex = block.getTextureForFace(EnumBlockFace.NORTH);
            minU = (textureIndex % 16) / 16.0;
            maxU = minU + (16 / 256);
            minV = Math.floor(textureIndex / 16) / 16.0;
            maxV = minV + (16 / 256);
        }

        minV = 1 - minV;
        maxV = 1 - maxV;

        minU += offset;
        maxU -= offset;
        minV -= offset;
        maxV += offset;

        this.addFace(null, EnumBlockFace.NORTH, false, 0, 0, 0, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV);
    }

    renderBlockInNullWorld(group, block, brightness) {
        this.tessellator.startDrawing();
        this.beginModelPass();
        this.renderBlock(null, block, false, 0, 0, 0);
        this.tessellator.transformBrightness(brightness);
        this.transformModelBrightness(brightness);

        let mesh = null;
        if (this.tessellator.addedVertices > 0) {
            mesh = this.tessellator.draw(group);
            mesh.material = this.getUnlitGUIMaterial();
            mesh.geometry.center();
        }

        const modelMesh = this.flushModelPass(group);
        if (modelMesh !== null) {
            modelMesh.material = this.getUnlitGUIMaterial(0.5, modelMesh.userData.modelTessellator);
            modelMesh.geometry.center();
            if (mesh === null) {
                mesh = modelMesh;
            }
        }

        return mesh;
    }
}