import Block from "../client/world/block/Block.js";
import ChunkSection from "../client/world/ChunkSection.js";
import EnumSkyBlock from "./EnumSkyBlock.js";
import World from "../client/world/World.js";

export default class MetadataChunkBlock {

    constructor(type, x1, y1, z1, x2, y2, z2) {
        this.type = type;
        this.x1 = x1;
        this.y1 = y1;
        this.z1 = z1;
        this.x2 = x2;
        this.y2 = y2;
        this.z2 = z2;
    }

    updateBlockLightning(world) {
        let centerX = (this.x2 - this.x1) + 1;
        let centerY = (this.y2 - this.y1) + 1;
        let centerZ = (this.z2 - this.z1) + 1;
        let index = centerX * centerY * centerZ;
        if (index > 70000) {
            return;
        }

        // Seed the flood with every block in the region, then let light spread
        // through the whole connected area (across section/chunk borders) in
        // one pass. Each block is recomputed from its current neighbors, so
        // light reaches its full range instantly instead of crawling one level
        // per queue step.
        const stack = [];
        const isFullChunk =
            centerX === ChunkSection.SIZE &&
            centerY === World.TOTAL_HEIGHT &&
            centerZ === ChunkSection.SIZE;

        if (isFullChunk && this.type === EnumSkyBlock.SKY) {
            // Full-chunk recompute on load. The column pass in
            // updateChunkSkyLight already produced correct vertical light, so
            // the only blocks the flood can change are those that open onto a
            // lower neighbor column (cave mouths, cliff faces, shorelines).
            // Seeding just those instead of all 65k blocks keeps the flood
            // proportional to the surface it actually lights.
            const stride = centerX + 2;
            const heights = new Int32Array(stride * stride);
            for (let lx = 0; lx < stride; lx++) {
                for (let lz = 0; lz < stride; lz++) {
                    heights[lz * stride + lx] = world.getHeightAt(this.x1 - 1 + lx, this.z1 - 1 + lz);
                }
            }
            for (let lx = 1; lx <= centerX; lx++) {
                for (let lz = 1; lz <= centerZ; lz++) {
                    const own = heights[lz * stride + lx];
                    if (own <= 0) {
                        continue;
                    }
                    const hn = Math.min(
                        heights[lz * stride + (lx - 1)] || 1e9,
                        heights[lz * stride + (lx + 1)] || 1e9,
                        heights[(lz - 1) * stride + lx] || 1e9,
                        heights[(lz + 1) * stride + lx] || 1e9
                    );
                    if (hn >= own) {
                        continue;
                    }
                    const x = this.x1 + lx - 1;
                    const z = this.z1 + lz - 1;
                    for (let y = own - 1; y >= hn; y--) {
                        stack.push(x, y, z);
                    }
                }
            }
        } else if (isFullChunk && this.type === EnumSkyBlock.BLOCK) {
            // Block light sources are rare (torches, glowstone) and a freshly
            // filled chunk has block light zeroed by resetChunkBlockLight, so
            // only emissive blocks can change; the flood spreads from there on
            // its own once the first source is recomputed.
            for (let x = this.x1; x <= this.x2; x++) {
                for (let z = this.z1; z <= this.z2; z++) {
                    if (!world.blockExists(x, 0, z)) {
                        continue;
                    }
                    for (let y = this.y1; y <= this.y2; y++) {
                        if (y < 0 || y >= World.TOTAL_HEIGHT) {
                            continue;
                        }
                        const typeId = world.getBlockAt(x, y, z);
                        const block = Block.getById(typeId);
                        if (block !== null && block.getLightValue(world, x, y, z) > 0) {
                            stack.push(x, y, z);
                        }
                    }
                }
            }
        } else {
            // Small update regions (block place/remove): seed every block so
            // light decreases propagate correctly.
            for (let x = this.x1; x <= this.x2; x++) {
                for (let z = this.z1; z <= this.z2; z++) {
                    if (!world.blockExists(x, 0, z)) {
                        continue;
                    }
                    for (let y = this.y1; y <= this.y2; y++) {
                        if (y < 0 || y >= World.TOTAL_HEIGHT) {
                            continue;
                        }
                        stack.push(x, y, z);
                    }
                }
            }
        }

        // Hard cap so a pathological region can never stall the game loop;
        // light simply stops spreading once the budget runs out.
        let visited = 0;
        const MAX_VISITS = 500000;
        while (stack.length > 0 && visited < MAX_VISITS) {
            visited++;
            const z = stack.pop();
            const y = stack.pop();
            const x = stack.pop();

            if (y < 0 || y >= World.TOTAL_HEIGHT) {
                continue;
            }
            if (!world.blockExists(x, y, z)) {
                continue;
            }

            let savedLightValue = world.getSavedLightValue(this.type, x, y, z);
            let newLevel = 0;
            let typeId = world.getBlockAt(x, y, z);
            let block = Block.getById(typeId);
            let opacity = block === null || typeId === 0 ? 0 : Math.round(block.getOpacity() * 255);

            if (opacity === 0) {
                opacity = 1;
            }

            let level = 0;

            if (this.type === EnumSkyBlock.SKY) {
                if (world.isAboveGround(x, y, z)) {
                    level = 15;
                }
            } else if (this.type === EnumSkyBlock.BLOCK) {
                level = typeId === 0 || block === null ? 0 : block.getLightValue(world, x, y, z);
            }

            if (opacity >= 15 && level === 0) {
                newLevel = 0;
            } else {
                // Only loaded chunks contribute light. An unloaded neighbor is
                // treated as 0; otherwise getSavedLightValue() would return 15
                // for it and flood a bright border deep into loaded territory.
                let neighborLevel = 0;
                if (world.blockExists(x - 1, y, z)) neighborLevel = world.getSavedLightValue(this.type, x - 1, y, z);
                let other = world.blockExists(x + 1, y, z) ? world.getSavedLightValue(this.type, x + 1, y, z) : 0;
                if (other > neighborLevel) neighborLevel = other;
                other = world.blockExists(x, y - 1, z) ? world.getSavedLightValue(this.type, x, y - 1, z) : 0;
                if (other > neighborLevel) neighborLevel = other;
                other = world.blockExists(x, y + 1, z) ? world.getSavedLightValue(this.type, x, y + 1, z) : 0;
                if (other > neighborLevel) neighborLevel = other;
                other = world.blockExists(x, y, z - 1) ? world.getSavedLightValue(this.type, x, y, z - 1) : 0;
                if (other > neighborLevel) neighborLevel = other;
                other = world.blockExists(x, y, z + 1) ? world.getSavedLightValue(this.type, x, y, z + 1) : 0;
                if (other > neighborLevel) neighborLevel = other;

                newLevel = neighborLevel - opacity;
                if (newLevel < 0) {
                    newLevel = 0;
                }
                if (level > newLevel) {
                    newLevel = level;
                }
            }

            if (savedLightValue === newLevel) {
                continue;
            }
            world.setLightAt(this.type, x, y, z, newLevel);

            // Spread the change to every neighbor; blockExists() skips
            // unloaded chunks, so the flood crosses chunk borders freely.
            stack.push(x - 1, y, z);
            stack.push(x + 1, y, z);
            stack.push(x, y - 1, z);
            stack.push(x, y + 1, z);
            stack.push(x, y, z - 1);
            stack.push(x, y, z + 1);
        }
    }

    isOutsideOf(x1, y1, z1, x2, y2, z2) {
        if (x1 >= this.x1 && y1 >= this.y1 && z1 >= this.z1 && x2 <= this.x2 && y2 <= this.y2 && z2 <= this.z2) {
            return true;
        }

        let radius = 1;
        if (x1 >= this.x1 - radius
            && y1 >= this.y1 - radius
            && z1 >= this.z1 - radius
            && x2 <= this.x2 + radius
            && y2 <= this.y2 + radius
            && z2 <= this.z2 + radius) {

            let distanceX = this.x2 - this.x1;
            let distanceY = this.y2 - this.y1;
            let distanceZ = this.z2 - this.z1;

            if (x1 > this.x1) {
                x1 = this.x1;
            }
            if (y1 > this.y1) {
                y1 = this.y1;
            }
            if (z1 > this.z1) {
                z1 = this.z1;
            }
            if (x2 < this.x2) {
                x2 = this.x2;
            }
            if (y2 < this.y2) {
                y2 = this.y2;
            }
            if (z2 < this.z2) {
                z2 = this.z2;
            }

            let newDistanceX = x2 - x1;
            let newDistanceY = y2 - y1;
            let newDistanceZ = z2 - z1;

            let size = distanceX * distanceY * distanceZ;
            let newSize = newDistanceX * newDistanceY * newDistanceZ;

            if (newSize - size <= 2) {
                this.x1 = x1;
                this.y1 = y1;
                this.z1 = z1;
                this.x2 = x2;
                this.y2 = y2;
                this.z2 = z2;
                return true;
            }
        }
        return false;
    }

}