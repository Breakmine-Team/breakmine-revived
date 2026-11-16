import Block from "../client/world/block/Block.js";
import ChunkSection from "../client/world/ChunkSection.js";
import EnumSkyBlock from "./EnumSkyBlock.js";
import World from "../client/world/World.js";

function isOpenBlock(world, x, y, z) {
    const typeId = world.getBlockAt(x, y, z);
    if (typeId === 0) {
        return true;
    }

    const block = Block.getById(typeId);
    if (block === null) {
        return false;
    }

    return Math.round(block.getOpacity(world, x, y, z, block) * 255) < 15;
}

function seedColumn(stack, world, x, z) {
    if (!world.chunkExists(x >> 4, z >> 4)) {
        return;
    }

    for (let y = 0; y < World.TOTAL_HEIGHT; y++) {
        if (isOpenBlock(world, x, y, z)) {
            stack.push(x, y, z);
        }
    }
}

export default class MetadataChunkBlock {

    constructor(type, x1, y1, z1, x2, y2, z2) {
        this.type = type;
        this.x1 = x1;
        this.y1 = y1;
        this.z1 = z1;
        this.x2 = x2;
        this.y2 = y2;
        this.z2 = z2;

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

        const isFullChunk =
            centerX === ChunkSection.SIZE &&
            centerY === World.TOTAL_HEIGHT &&
            centerZ === ChunkSection.SIZE;

        if (this.stack === null) {
            this.stack = [];
            this.visited = 0;
            const stack = this.stack;

        if (isFullChunk && this.type === EnumSkyBlock.SKY) {
            // Seed every block that is open but sits below its column's surface.
            // The straight-down pass cannot light air under overhangs or the empty
            // space below floating terrain, so that light has to flood in from the
            // lit columns beside it.
            for (let lx = 0; lx < centerX; lx++) {
                for (let lz = 0; lz < centerZ; lz++) {
                    const x = this.x1 + lx;
                    const z = this.z1 + lz;
                    const height = world.getHeightAt(x, z);
                    for (let y = 0; y < height; y++) {
                        if (isOpenBlock(world, x, y, z)) {
                            stack.push(x, y, z);
                        }
                    }
                }
            }

            // Seed one block past each chunk border too. A chunk that was lit
            // while its neighbour was still missing could not see that
            // neighbour's light, so the neighbour pushes it in again once it
            // arrives and the seam stops being black.
            for (let i = 0; i < centerX; i++) {
                seedColumn(stack, world, this.x1 - 1, this.z1 + i);
                seedColumn(stack, world, this.x2 + 1, this.z1 + i);
                seedColumn(stack, world, this.x1 + i, this.z1 - 1);
                seedColumn(stack, world, this.x1 + i, this.z2 + 1);
            }
        } else if (isFullChunk && this.type === EnumSkyBlock.BLOCK) {
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

            stack.push(x - 1, y, z);
            stack.push(x + 1, y, z);
            stack.push(x, y - 1, z);
            stack.push(x, y + 1, z);
            stack.push(x, y, z - 1);
            stack.push(x, y, z + 1);
        }

        this.visited += processed;

        if (stack.length > 0 && this.visited < MAX_VISITS) {
            return false;
        }

        this.stack = null;
        return true;
    }

    isOutsideOf(x1, y1, z1, x2, y2, z2) {
        if (this.stack !== null) {
            return false;
        }

        // Only swallow a region that this pending update already covers. A
        // region that merely overlaps it still needs its own pass, otherwise its
        // blocks are never lit and stay black until something else touches them.
        return x1 >= this.x1 && y1 >= this.y1 && z1 >= this.z1
            && x2 <= this.x2 && y2 <= this.y2 && z2 <= this.z2;
    }

}