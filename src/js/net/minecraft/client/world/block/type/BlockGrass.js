import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGrass extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Grass Block";
        this.hardness = 0.6;

        // Sound
        this.sound = Block.sounds.grass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }
    
    getPreferredToolType() {
        return 'shovel';
    }

    getColor(world, x, y, z, face) {
        // Only top face has a biome color
        if (face !== EnumBlockFace.TOP) {
            return 0xFFFFFF;
        }

        // Inventory items have a default color
        if (world === null) {
            return 0x7cbd6b;
        }

        let temperature = world.getTemperature(x, y, z);
        let humidity = world.getHumidity(x, y, z);
        let color = world.minecraft.grassColorizer.getColor(temperature, humidity);

        // Blend toward blue the closer the block is to a Snowy biome (max 5 blocks)
        const snowDist = BlockGrass.getDistanceToSnowBiome(world, x, z);
        if (snowDist < 5) {
            const t = (5 - snowDist) / 5; // 0 at 5 blocks, 1 at the edge
            color = BlockGrass.blendTowardBlue(color, t);
        }

        return color;
    }

    // Searches rings of increasing radius around (x, z) for a snowy biome.
    // Returns the radius of the closest snowy biome, or 6 when none is close.
    static getDistanceToSnowBiome(world, x, z) {
        // Result only depends on the chunk column, so memoize per chunk: meshing
        // evaluates grass color for many blocks in the same chunk and the ring
        // scan would otherwise cost tens of biome lookups per top face.
        const chunkX = x >> 4;
        const chunkZ = z >> 4;

        if (this._snowDistCache && this._snowDistCacheChunkX === chunkX && this._snowDistCacheChunkZ === chunkZ) {
            const localX = x & 15;
            const localZ = z & 15;
            return this._snowDistCache[localZ * 16 + localX];
        }

        const cache = new Uint8Array(256).fill(6);
        for (let lx = 0; lx < 16; lx++) {
            for (let lz = 0; lz < 16; lz++) {
                for (let d = 1; d <= 5; d++) {
                    let found = false;
                    for (let dx = -d; dx <= d && !found; dx++) {
                        for (let dz = -d; dz <= d; dz++) {
                            // Ring border only so each column is sampled once
                            if (Math.abs(dx) !== d && Math.abs(dz) !== d) continue;
                            if (world.getTemperature(chunkX * 16 + lx + dx, 0, chunkZ * 16 + lz + dz) <= 0.05) {
                                cache[lz * 16 + lx] = d;
                                found = true;
                                break;
                            }
                        }
                    }
                    if (found) break;
                }
            }
        }

        this._snowDistCache = cache;
        this._snowDistCacheChunkX = chunkX;
        this._snowDistCacheChunkZ = chunkZ;

        const localX = x & 15;
        const localZ = z & 15;
        return cache[localZ * 16 + localX];
    }

    static blendTowardBlue(color, t) {
        const red = (color >> 16) & 255;
        const green = (color >> 8) & 255;
        const blue = Math.min(255, (color & 255) + Math.round(t * 180));
        return red << 16 | green << 8 | blue;
    }

    getDrop(world, x, y, z) {
        return [BlockRegistry.DIRT.getId(), 1]; // Drop dirt block
    }

    getParticleTextureFace() {
        return EnumBlockFace.NORTH;
    }

    getTextureForFace(face, data, x, y, z, world) {
        switch (face) {
            case EnumBlockFace.TOP:
                return 'grass_top';
            case EnumBlockFace.BOTTOM:
                return 'dirt';
            default:
                return (world && world.getBlockAt(x, y + 1, z) === BlockRegistry.SNOW.getId()) ? 'grass_block_snow' : 'grass_side';
        }
    }

}