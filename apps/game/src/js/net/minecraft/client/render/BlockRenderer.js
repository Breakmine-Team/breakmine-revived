// Direction offsets for 6 faces (used to fake light passing through non-AO blocks)
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
import EnumCreativeInventoryTab from "../gui/EnumCreativeInventoryTab.js";

export default class BlockRenderer {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;
        this.tessellator = new Tessellator();
        // Bind to texture atlas if available, otherwise fallback to terrain texture
        if (worldRenderer.textureAtlas && worldRenderer.textureAtlas.isLoaded()) {
            this.tessellator.bindTexture(worldRenderer.textureAtlas.getTexture());
        } else {
            this.tessellator.bindTexture(worldRenderer.textureTerrain);
        }
    }

    renderBlock(world, block, ambientOcclusion, x, y, z) {
        if (block.path) {
            this.renderPath(world, block, ambientOcclusion, x, y, z);
        } else if (block.multipart === true) {
            this.renderMultipart(world, block, x, y, z);
        } else if (block?.lever === true) {
            this.renderLever(world, block, x, y, z);
        } else if (block) {
            // Pass 'this' (the BlockRenderer / WorldRenderer instance) to onRender
            const customRenderHandled = block.onRender(world, x, y, z, this);

            // If onRender returns true, skip standard block rendering
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

        // Render blocks declared inside this block (e.g. dust inside a lever).
        // The lever renders its inner parts itself so they rotate with it.
        if (block && Array.isArray(block.renderInside) && block.lever !== true) {
            this.renderParts(world, block.renderInside, x, y, z);
        }
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
        constructor(id, texId, texName) {
            super(id, texId);
            this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
            this.texName = texName;
        }
        
        getTextureForFace(face) {
            return this.texName;
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

    renderMultipart(world, block, x, y, z) {
        this.renderParts(world, block.getMultipart(world, x, y, z), x, y, z);
    }

    renderParts(world, parts, x, y, z, respectFaces = false) {
        if (!Array.isArray(parts)) return;

        for (let i = 0; i < parts.length; i++) {
            let partBlock = null;
            let bbox = null;
            
            if (parts[i][0] === 'block') {
                partBlock = Block.getById(parts[i][1]);
                bbox = parts[i][2];
            } else if (parts[i][0] === 'blockClass') {
                partBlock = parts[i][2]['block'];
                bbox = parts[i][2]['bbox'];
            } else if (parts[i][0] === 'texture') {
                partBlock = new this.constructor.DummyBlock(999, 0, parts[i][2]['texture']);
                bbox = parts[i][2]['bbox'];
            }
            
            if (partBlock && bbox) {
                let values = EnumBlockFace.values();
                for (let j = 0; j < values.length; j++) {
                    if (respectFaces && partBlock.shouldRenderFace(world, x, y, z, values[j]) === false) {
                        continue;
                    }
                    this.renderFace(world, partBlock, bbox, values[j], false, x, y, z);
                }
            }
        }
    }

    renderSolidBlock(world, block, ambientOcclusion, x, y, z) {
        let boundingBox = block.getBoundingBox(world, x, y, z);

        let values = EnumBlockFace.values();
        for (let i = 0; i < values.length; i++) {
            let face = values[i];
            let neighborBlock = world ? Block.getById(world.getBlockAtFace(x, y, z, face)) : null;

            if (world === null || block.shouldRenderFace(world, x, y, z, face) || (neighborBlock !== null && (neighborBlock.path === true || neighborBlock.noFaceCull === true || neighborBlock.multipart === true))) {
                this.renderFace(world, block, boundingBox, face, block.getAmbientOcclusion() && ambientOcclusion, x, y, z);
            }
        }
    }

    renderLiquid(world, block, x, y, z) {
        const chunkX = x >> 4;
        const chunkY = y >> 4;
        const chunkZ = z >> 4;
        const liquidId = block.id;

        // Texture UVs (V-flipped to match the other renderers)
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

        // Color multiplier (water/lava textures carry their own tint)
        let color = block.getColor(world, x, y, z, EnumBlockFace.TOP);
        let red = (color >> 16 & 255) / 255.0;
        let green = (color >> 8 & 255) / 255.0;
        let blue = (color & 255) / 255.0;

        // Lighting sampled just above the liquid so open water stays bright
        const lightLevel = world === null ? 15 : this.getEffectiveLightLevel(world, x, y + 0.9, z);
        const brightness = 0.9 / 15.0 * lightLevel + 0.1;

        const isLiquidAt = (nx, ny, nz) => world !== null && world.getBlockAt(nx, ny, nz) === liquidId;

        // A full 1x1x1 solid opaque block hides whatever is directly behind it,
        // so faces pressed against one are never visible and can be culled.
        const isOpaqueFullCubeAt = (nx, ny, nz) => {
            if (world === null) return false;
            const neighborId = world.getBlockAt(nx, ny, nz);
            if (neighborId === 0) return false;
            const neighbor = Block.getById(neighborId);
            if (neighbor === null || !neighbor.isSolid() || neighbor.isTranslucent()) return false;
            const box = neighbor.getBoundingBox(world, nx, ny, nz);
            return box !== null && box.minX === 0 && box.minY === 0 && box.minZ === 0 &&
                   box.maxX === 1 && box.maxY === 1 && box.maxZ === 1;
        };

        // TOP: culled when liquid sits directly above (the upper block owns the surface)
        // or when a full opaque block covers the liquid.
        if (world === null || (!isLiquidAt(x, y + 1, z) && !isOpaqueFullCubeAt(x, y + 1, z))) {
            const shade = brightness * EnumBlockFace.TOP.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
            this.tessellator.addLiquidFace(world, liquidId, EnumBlockFace.TOP, chunkX, chunkY, chunkZ, x, y, z, minU, minV, maxU, maxV);
        }

        // BOTTOM: only when exposed to an air/non-solid cave below (never
        // under a liquid of the same type, so stacked columns stay seamless)
        const belowId = world === null ? 1 : world.getBlockAt(x, y - 1, z);
        const belowBlock = belowId === 0 ? null : Block.getById(belowId);
        if (world === null || ((belowBlock === null || !belowBlock.isSolid()) && !isLiquidAt(x, y - 1, z))) {
            const shade = brightness * EnumBlockFace.BOTTOM.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
            this.tessellator.addLiquidFace(world, liquidId, EnumBlockFace.BOTTOM, chunkX, chunkY, chunkZ, x, y, z, minU, minV, maxU, maxV);
        }

        // SIDES: culled when the neighbor column is the same liquid or when a
        // full 1x1x1 solid opaque block sits on that side
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

        let values = EnumBlockFace.values();
        for (let i = 0; i < values.length; i++) {
            let face = values[i];
            let neighborBlock = world ? Block.getById(world.getBlockAtFace(x, y, z, face)) : null;

            if (world === null || block.shouldRenderFace(world, x, y, z, face) || (neighborBlock !== null && (neighborBlock.path === true || neighborBlock.noFaceCull === true || neighborBlock.multipart === true))) {
                this.renderFace(world, block, boundingBox, face, block.getAmbientOcclusion() && ambientOcclusion, x, y, z);
            }
        }
    }

    renderFace(world, block, boundingBox, face, ambientOcclusion, x, y, z) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        let blockData = 0;
        if (world) {
            let chunk = world.getChunkAt(chunkX, chunkZ);
            if (chunk) {
                blockData = chunk.getBlockDataAt(x & 15, y, z & 15);
            }
        }

        let minX = x + boundingBox.minX;
        let minY = y + boundingBox.minY;
        let minZ = z + boundingBox.minZ;
        let maxX = x + boundingBox.maxX;
        let maxY = y + boundingBox.maxY;
        let maxZ = z + boundingBox.maxZ;

        let minU, minV;
        let maxU, maxV;
        
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            let textureName = block.getTextureForFace(face, blockData, x, y, z, world);
            let uvs = this.worldRenderer.textureAtlas.getUVs(textureName);
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
        
        let width = boundingBox.maxX - boundingBox.minX;
        let height = boundingBox.maxY - boundingBox.minY;
        let depth = boundingBox.maxZ - boundingBox.minZ;

        // UV span of a single full texture tile, derived from the bound texture's own size
        let uSpan = maxU - minU;
        let vSpan = maxV - minV;

        switch (face) {
            case EnumBlockFace.BOTTOM:
            case EnumBlockFace.TOP:
                maxU = minU + (uSpan * width);
                maxV = minV + (vSpan * depth);
                break;
            case EnumBlockFace.NORTH:
            case EnumBlockFace.SOUTH:
                maxU = minU + (uSpan * width);
                maxV = minV + (vSpan * height);
                
                if (height < 1.0 && block?.topAlign !== true) {
                    let vOffset = vSpan * (1.0 - height);
                    minV += vOffset;
                    maxV += vOffset;
                }
                break;
            case EnumBlockFace.WEST:
            case EnumBlockFace.EAST:
                maxU = minU + (uSpan * depth);
                maxV = minV + (vSpan * height);

                if (height < 1.0 && block?.topAlign !== true) {
                    let vOffset = vSpan * (1.0 - height);
                    minV += vOffset;
                    maxV += vOffset;
                }
                break;
        }

        minV = 1 - minV;
        maxV = 1 - maxV;

        let rotation = block.getRotationForFace(face, blockData, x, y, z, world);

        let color = block.getColor(world, x, y, z, face);
        let red = (color >> 16 & 255) / 255.0;
        let green = (color >> 8 & 255) / 255.0;
        let blue = (color & 255) / 255.0;

        // Classic lightning
        if (!ambientOcclusion) {
            // Use effective light level to prevent black faces next to non-AO blocks like fences
            let level = world === null ? 15 : this.getEffectiveLightLevel(world, minX + face.x, minY + face.y, minZ + face.z);
            let brightness = 0.9 / 15.0 * level + 0.1;
            let shade = brightness * face.getShading();
            this.tessellator.setColor(red * shade, green * shade, blue * shade);
        }

        this.addFace(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, red, green, blue, rotation);
    }

    renderDecoration(world, block, x, y, z) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        // UV mapping from the texture atlas
        let textureName = block.getTextureForFace(EnumBlockFace.NORTH, 0, x, y, z, world);
        let minU, maxU, minV, maxV;
        if (this.worldRenderer.textureAtlas && this.worldRenderer.textureAtlas.isLoaded()) {
            let uvs = this.worldRenderer.textureAtlas.getUVs(textureName);
            minU = uvs.minU;
            maxU = uvs.maxU;
            minV = uvs.minV;
            maxV = uvs.maxV;
        } else {
            let textureIndex = block.getTextureForFace(EnumBlockFace.NORTH, 0, x, y, z, world);
            minU = (textureIndex % 16) / 16.0;
            maxU = minU + (16 / 256);
            minV = Math.floor(textureIndex / 16) / 16.0;
            maxV = minV + (16 / 256);
        }

        // Flip V
        minV = 1 - minV;
        maxV = 1 - maxV;

        // Get color multiplier
        let color = block.getColor(world, x, y, z, EnumBlockFace.NORTH);
        let red = (color >> 16 & 255) / 255.0;
        let green = (color >> 8 & 255) / 255.0;
        let blue = (color & 255) / 255.0;

        // Classic lightning (full brightness, no directional shading for a cross)
        if (world === null) {
            this.tessellator.setColor(red, green, blue);
        } else {
            let level = this.getEffectiveLightLevel(world, x, y, z);
            let brightness = 0.9 / 15.0 * level + 0.1;
            this.tessellator.setColor(red * brightness, green * brightness, blue * brightness);
        }

        // Two crossed squares in the block's X shape
        this.addDecorationQuad(chunkX, chunkY, chunkZ, x, y, z, x + 1, y + 1, z + 1, minU, minV, maxU, maxV);
        this.addDecorationQuad(chunkX, chunkY, chunkZ, x + 1, y, z, x, y + 1, z + 1, minU, minV, maxU, maxV);
    }

    addDecorationQuad(chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV) {
        let cx = chunkX << 4;
        let cy = chunkY << 4;
        let cz = chunkZ << 4;

        // Forward winding (front side of the quad)
        this.tessellator.addVertexWithUV(minX - cx, minY - cy, minZ - cz, minU, maxV);
        this.tessellator.addVertexWithUV(maxX - cx, minY - cy, maxZ - cz, maxU, maxV);
        this.tessellator.addVertexWithUV(maxX - cx, maxY - cy, maxZ - cz, maxU, minV);
        this.tessellator.addVertexWithUV(minX - cx, maxY - cy, minZ - cz, minU, minV);

        // Reversed winding so the quad is visible from both sides
        this.tessellator.addVertexWithUV(minX - cx, minY - cy, minZ - cz, minU, maxV);
        this.tessellator.addVertexWithUV(minX - cx, maxY - cy, minZ - cz, minU, minV);
        this.tessellator.addVertexWithUV(maxX - cx, maxY - cy, maxZ - cz, maxU, minV);
        this.tessellator.addVertexWithUV(maxX - cx, minY - cy, maxZ - cz, maxU, maxV);
    }

    addFace(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, red = 1, green = 1, blue = 1, rotation = 0) {
        const addCorner = (x, y, z, u, v) => {
            let r = ((rotation % 4) + 4) % 4;
            if (r !== 0) {
                let uRange = maxU - minU;
                let vRange = maxV - minV;
                let localU = (u - minU) / uRange;
                let localV = (v - minV) / vRange;
                if (r === 1) {
                    u = minU + localV * uRange;
                    v = minV + (1 - localU) * vRange;
                } else if (r === 2) {
                    u = minU + (1 - localU) * uRange;
                    v = minV + (1 - localV) * vRange;
                } else {
                    u = minU + (1 - localV) * uRange;
                    v = minV + localU * vRange;
                }
            }
            this.addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, x, y, z, u, v, red, green, blue);
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
    }

    addBlockCorner(world, face, ambientOcclusion, chunkX, chunkY, chunkZ, x, y, z, u, v, red, green, blue) {
        if (ambientOcclusion) {
            this.setAverageBrightness(world, face, x, y, z, red, green, blue);
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

        // Air or translucent blocks let light pass normally
        if (!block || block.isTranslucent()) {
            return world.getTotalLightAt(x, y, z);
        } 
        
        // Blocks that don't cast AO (like fences) block the light engine, 
        // so their internal light is 0. We fake it by checking neighbors.
        if (!block.canCastAmbientOcclusion()) {
            let maxSurroundingLight = 0;
            for (let i = 0; i < 6; i++) {
                let light = world.getTotalLightAt(x + FACE_DX[i], y + FACE_DY[i], z + FACE_DZ[i]);
                if (light > maxSurroundingLight) {
                    maxSurroundingLight = light;
                }
            }
            return maxSurroundingLight;
        }

        // Solid blocks that cast AO
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
                    else if (!block.canCastAmbientOcclusion()) {
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
            let textureName = block.getTextureForFace(EnumBlockFace.NORTH);
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
            let textureIndex = block.getTextureForFace(EnumBlockFace.NORTH);
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

    renderLever(world, block, x, y, z) {
        let chunkX = x >> 4;
        let chunkY = y >> 4;
        let chunkZ = z >> 4;

        // Rotate the floor-authored lever model so its base sits flush against
        // the face it was mounted on (block data bits 1-3).
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
            // Tilt the handle based on the powered state (block data bit 0).
            // Off = leaning one way, on = leaning the other way.
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

        // Outmost two corners dropped by 2/16 based on tilt direction
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
        
        // Add lever handle faces to tessellator second
        this.addLeverFace(world, EnumBlockFace.NORTH, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        this.addLeverFace(world, EnumBlockFace.EAST, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        this.addLeverFace(world, EnumBlockFace.SOUTH, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        this.addLeverFace(world, EnumBlockFace.WEST, true, chunkX, chunkY, chunkZ, minX, minY, minZ, maxX, maxY, maxZ, minU, minV, maxU, maxV, distortX2, distortZ2, topYMinX, topYMaxX);
        
        // Top Face with custom corner Y values
        let leverPixelV = 8 / this.worldRenderer.textureAtlas.atlasSize;
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, minX + distortX2, topYMinX, maxZ + distortZ2, minU, maxV + leverPixelV);
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, minX + distortX2, topYMinX, minZ + distortZ2, minU, minV);
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, maxX + distortX2, topYMaxX, minZ + distortZ2, maxU, minV);
        this.addBlockCorner(world, EnumBlockFace.TOP, true, chunkX, chunkY, chunkZ, maxX + distortX2, topYMaxX, maxZ + distortZ2, maxU, maxV + leverPixelV);

        // Render embedded blocks (e.g. bluestone dust) so they rotate with the
        // lever. Enable cutout so the dust's transparent texture pixels don't
        // render black in the solid pass (alphaTest persists until the mesh is
        // drawn at the end of the pass).
        if (Array.isArray(block.renderInside)) {
            this.tessellator.material.alphaTest = 0.5;
            this.renderParts(world, block.renderInside, x, y, z, true);
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

        // Render post with log texture (always centered)
        this.renderFakeBlockWithBlockClassWithBoundingBox(world, BlockRegistry.LOG, false, x, y, z, 
            new BoundingBox(0.4375, 0, 0.4375, 0.5625, 0.4375, 0.5625));

        // Render board with planks texture (rotated based on data)
        if (xAxis) {
            // X-axis rotation: board extends along X axis (0 to 1), thin on Z axis
            this.renderFakeBlockWithBlockClassWithBoundingBox(world, BlockRegistry.WOOD, false, x, y, z,
                new BoundingBox(0, 0.4375, 0.4375, 1, 1, 0.5625));
        } else {
            // Z-axis rotation: board extends along Z axis (0 to 1), thin on X axis
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

    renderBlockInHandThirdPerson(group, block, brightness) {
        this.tessellator.startDrawing();
        this.renderBlock(null, block, false, 0, 0, 0);
        this.tessellator.transformBrightness(brightness);
        let mesh = this.tessellator.draw(group);
        mesh.geometry.center();
        mesh.position.x = 0;
        mesh.position.y = 9;
        mesh.position.z = -5;
        mesh.rotation.y = Math.PI / 4;
        mesh.scale.x = 6;
        mesh.scale.y = -6;
        mesh.scale.z = 6;
    }

    renderBlockInFirstPerson(group, block, brightness) {
        this.tessellator.startDrawing();
        this.renderBlock(null, block, false, 0, 0, 0);
        this.tessellator.transformBrightness(brightness);
        let mesh = this.tessellator.draw(group);
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
                //mesh.rotation.y -= Math.PI / 6;
                mesh.rotation.z -= Math.PI / 6;
            }
        }
    }

    renderGuiBlock(group, block, x, y, size, brightness) {
        this.tessellator.startDrawing();
        this.tessellator.setColor(1, 1, 1);

        // Render block by type
        if (block) {
            // Pass 'this' (the BlockRenderer / WorldRenderer instance) to onRender
            const customRenderHandled = block.onRender(null, 0, 0, 0, this);

            // If onRender returns true, skip standard block rendering
            if (customRenderHandled) {
                return; 
            }
        }
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
            this.renderMultipart(null, block, 0, 0, 0);
        } else if (block.path) {
            this.renderPath(null, block, false, 0, 0, 0);
        }

        // Change brightness
        this.tessellator.transformBrightness(brightness);

        // Create mesh
        let mesh = this.tessellator.draw(group);
        mesh.geometry.center();

        // Rotate block
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
                    size += 5;
                    break;
            }
        }

        // Relative position
        mesh.position.x = x;
        mesh.position.y = -y;
        mesh.position.z = -10;

        // Scale
        mesh.scale.x = size;
        mesh.scale.y = size;
        mesh.scale.z = size;
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
        this.renderBlock(null, block, false, 0, 0, 0);
        this.tessellator.transformBrightness(brightness);
        let mesh = this.tessellator.draw(group);
        mesh.geometry.center();
        return mesh;
    }
}