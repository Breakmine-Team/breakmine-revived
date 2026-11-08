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

        // Flood state. Kept between calls so a large region can be processed
        // in slices instead of blocking a whole frame.
        this.stack = null;
        this.visited = 0;
    }

    updateBlockLightning(world, visitBudget = 1000000) {
        let centerX = (this.x2 - this.x1) + 1;
        let centerY = (this.y2 - this.y1) + 1;
        let centerZ = (this.z2 - this.z1) + 1;
        let index = centerX * centerY * centerZ;
        if (index > 70000) {
            return true;
        }

        // Seed the flood with every block in the region, then let light spread
        // through the whole connected area (across section/chunk borders) in
        // one pass. Each block is recomputed from its current neighbors, so
        // light reaches its full range instantly instead of crawling one level
        // per queue step.
        const isFullChunk =
            centerX === ChunkSection.SIZE &&
            centerY === World.TOTAL_HEIGHT &&
            centerZ === ChunkSection.SIZE;

        if (this.stack === null) {
            this.stack = [];
            this.visited = 0;
            const stack = this.stack;

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
            // Block light sources are the only blocks a fresh chunk can light
            // up, so seed just those. Walk the chunk's own section arrays
            // instead of 65k world.getBlockAt() lookups: this scan used to be
            // one of the most expensive parts of receiving a chunk.
            const chunk = world.getChunkAt(this.x1 >> 4, this.z1 >> 4);
            if (chunk && chunk.sections) {
                for (let layer = 0; layer < chunk.sections.length; layer++) {
                    const section = chunk.sections[layer];
                    if (!section || section.isEmpty()) {
                        continue;
                    }

                    const blocks = section.blocks;
                    const baseY = layer * ChunkSection.SIZE;

                    for (let i = 0; i < blocks.length; i++) {
                        const typeId = blocks[i];
                        if (typeId === 0) {
                            continue;
                        }

                        const block = Block.getById(typeId);
                        if (block === null) {
                            continue;
                        }

                        const x = this.x1 + (i & 15);
                        const z = this.z1 + ((i >> 4) & 15);
                        const y = baseY + (i >> 8);

                        if (block.getLightValue(world, x, y, z) > 0) {
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

        }

        const stack = this.stack;

        // Total visit cap for one update, and a per-call slice so a single
        // lava-filled chunk cannot stall the main thread for seconds.
        const MAX_VISITS = 500000;
        const budget = Math.min(visitBudget, MAX_VISITS - this.visited);
        let processed = 0;
        while (stack.length > 0 && processed < budget) {
            processed++;
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
            let opacity = block === null || typeId === 0 ? 0 : Math.round(block.getOpacity(world, x, y, z, block) * 255);

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

        this.visited += processed;

        // Budget exhausted: keep the stack and resume on the next call.
        if (stack.length > 0 && this.visited < MAX_VISITS) {
            return false;
        }

        this.stack = null;
        return true;
    }

    isOutsideOf(x1, y1, z1, x2, y2, z2) {
        // A partially processed region already has its seed set; merging new
        // bounds into it would leave the new area unseeded. Let the caller
        // queue a separate update instead.
        if (this.stack !== null) {
            return false;
        }

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