import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockGrass extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Grass Block";
        this.hardness = 0.6;

        this.sound = Block.sounds.grass;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }
    
    getPreferredToolType() {
        return 'shovel';
    }

    getColor(world, x, y, z, face) {
        if (face !== EnumBlockFace.TOP) {
            return 0xFFFFFF;
        }

        if (world === null) {
            return 0x7cbd6b;
        }

        let temperature = world.getTemperature(x, y, z);
        let humidity = world.getHumidity(x, y, z);
        let color = world.minecraft.grassColorizer.getColor(temperature, humidity);

        const snowDist = BlockGrass.getDistanceToSnowBiome(world, x, z);
        if (snowDist < 5) {
            const t = (5 - snowDist) / 5; 
            color = BlockGrass.blendTowardBlue(color, t);
        }

        return color;
    }

    static getDistanceToSnowBiome(world, x, z) {
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
        return [BlockRegistry.DIRT.getId(), 1]; 
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