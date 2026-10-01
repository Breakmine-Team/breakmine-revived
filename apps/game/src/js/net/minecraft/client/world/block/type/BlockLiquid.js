import Block from "../Block.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";

export default class BlockLiquid extends Block {

    constructor(id, textureSlotId, liquidType = 'water') {
        super(id, textureSlotId);
        this.liquidType = liquidType;
        this.maxDistance = liquidType === 'lava' ? 4 : 7; // Max horizontal spread
        this.tickRate = liquidType === 'lava' ? 30 : 5;   // Tick interval in game ticks
    }

    getRenderType() {
        return BlockRenderType.FLUID;
    }

    // Kick off the flow simulation whenever a liquid is placed at runtime
    // (bucket use, spreading, and server-authoritative placement). Generated
    // and loaded blocks never hit these hooks (chunk data is written straight
    // into sections), so oceans/lakes stay static sources and don't tick.
    onBlockPlaced(world, x, y, z, face) {
        world.scheduleBlockTick(x, y, z, this.tickRate);
        this.checkContact(world, x, y, z);
    }

    onBlockAdded(world, x, y, z) {
        world.scheduleBlockTick(x, y, z, this.tickRate);
        this.checkContact(world, x, y, z);
    }

    // The id of the other liquid (water <-> lava) and of the solid formed when
    // they touch. Overridden in BlockWater / BlockLava so this base class stays
    // out of the registry import cycle.
    getOppositeLiquidId() {
        return -1;
    }

    getSolidificationId() {
        return -1;
    }

    // Water + lava => cobblestone. Converts the adjacent opposite-liquid cell
    // (below or one of the four horizontal neighbors). Only the neighbor cell
    // changes, so a later tick on that position looks up the new (solid) block
    // and never reacts again.
    checkContact(world, x, y, z) {
        const oppositeId = this.getOppositeLiquidId();
        const cobbleId = this.getSolidificationId();
        if (oppositeId < 0 || cobbleId < 0) {
            return false;
        }
        if (world.getBlockAt(x, y - 1, z) === oppositeId) {
            world.setBlockAt(x, y - 1, z, cobbleId);
            return true;
        }
        const directions = [
            { x: 1, z: 0 },
            { x: -1, z: 0 },
            { x: 0, z: 1 },
            { x: 0, z: -1 }
        ];
        for (const dir of directions) {
            if (world.getBlockAt(x + dir.x, y, z + dir.z) === oppositeId) {
                world.setBlockAt(x + dir.x, y, z + dir.z, cobbleId);
                return true;
            }
        }
        return false;
    }

    isReplaceable(world, x, y, z) {
        return true;
    }

    getOpacity() {
        return 0.01;
    }

    getTransparency() {
        return 0.2;
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    isLiquid() {
        return true;
    }

    canInteract() {
        return false;
    }

    isLava() {
        return false;
    }

    shouldRenderFace(world, x, y, z, face) {
        const typeId = world.getBlockAtFace(x, y, z, face);
        return typeId === 0 || typeId !== this.id;
    }

    getBoundingBox(world, x, y, z) {
        let box = this.boundingBox.clone();
        if (world !== null && world.getBlockAt(x, y + 1, z) !== this.id) {
            box.maxY = 1.0 - 0.12;
        }
        return box;
    }

    /**
     * Called when a block tick executes for this liquid position.
     */
    onBlockTick(world, x, y, z) {
        this.updateFlow(world, x, y, z);
    }

    updateFlow(world, x, y, z) {
        // Contact with the opposite liquid turns it to cobblestone immediately.
        if (this.checkContact(world, x, y, z)) {
            return;
        }

        const currentData = world.getBlockDataAt(x, y, z);
        const currentLevel = currentData & 7; // Level 0 (source) to 7
        const isFalling = (currentData & 8) !== 0;

        // 1. Try flowing straight down
        const targetY = y - 1;
        if (this.canFlowInto(world, x, targetY, z)) {
            // Data flag 8 marks falling liquid
            this.flowInto(world, x, targetY, z, 8);
            
            // Flowing straight down prevents spreading horizontally at this level
            return;
        }

        // 2. Horizontal spread if on top of a solid block or full liquid
        if (currentLevel < this.maxDistance) {
            const nextLevel = isFalling ? 1 : currentLevel + 1;
            const flowDirections = this.getOptimalFlowDirections(world, x, y, z);

            for (const dir of flowDirections) {
                const nx = x + dir.x;
                const nz = z + dir.z;

                if (this.canFlowInto(world, nx, y, nz)) {
                    const existingTypeId = world.getBlockAt(nx, y, nz);
                    const existingData = world.getBlockDataAt(nx, y, nz);
                    const existingLevel = existingData & 7;

                    // Spread if target is empty or has a weaker liquid level
                    if (existingTypeId !== this.id || existingLevel > nextLevel) {
                        this.flowInto(world, nx, y, nz, nextLevel);
                    }
                }
            }
        }

        // 3. Check if current liquid block should dry up / decay
        this.checkDecay(world, x, y, z, currentLevel, isFalling);
    }

    canFlowInto(world, x, y, z) {
        if (y < 0 || y >= 256) return false;

        const typeId = world.getBlockAt(x, y, z);
        if (typeId === 0) return true; // Air
        if (typeId === this.getOppositeLiquidId()) return false; // Never flow into the opposite liquid (reacts instead)

        const block = Block.getById(typeId);
        if (block === null) return true;

        // Can flow into replaceable blocks (grass, flowers) or existing liquid with higher level
        return block.isReplaceable(world, x, y, z) || 
              (typeId === this.id && (world.getBlockDataAt(x, y, z) & 7) > 0);
    }

    flowInto(world, x, y, z, levelData) {
        world.setBlockAt(x, y, z, this.id, levelData);
        world.scheduleBlockTick(x, y, z, this.tickRate);
    }

    /**
     * Determines optimal horizontal directions towards nearest drop-offs (holes).
     */
    getOptimalFlowDirections(world, x, y, z) {
        const directions = [
            { x: 1, z: 0 },
            { x: -1, z: 0 },
            { x: 0, z: 1 },
            { x: 0, z: -1 }
        ];

        let minDistance = 99;
        const distances = [];

        for (const dir of directions) {
            const dist = this.getDistanceToDrop(world, x + dir.x, y, z + dir.z, 1, dir);
            distances.push({ dir, dist });
            if (dist < minDistance) {
                minDistance = dist;
            }
        }

        return distances
            .filter(d => d.dist === minDistance)
            .map(d => d.dir);
    }

    getDistanceToDrop(world, x, y, z, distance, dir) {
        if (!this.canFlowInto(world, x, y, z)) return 99;
        if (this.canFlowInto(world, x, y - 1, z)) return distance; // Found drop-off
        if (distance >= this.maxDistance) return 99;

        return this.getDistanceToDrop(world, x + dir.x, y, z + dir.z, distance + 1, dir);
    }

    /**
     * Reduces level or removes the block if no longer supplied by a source/higher block.
     */
    checkDecay(world, x, y, z, currentLevel, isFalling) {
        if (currentLevel === 0 && !isFalling) return; // Source blocks don't decay

        const neighbors = [
            { x: x + 1, y: y, z: z },
            { x: x - 1, y: y, z: z },
            { x: x, y: y, z: z + 1 },
            { x: x, y: y, z: z - 1 },
            { x: x, y: y + 1, z: z } // Check block directly above
        ];

        let hasSupplier = false;
        for (const n of neighbors) {
            if (world.getBlockAt(n.x, n.y, n.z) === this.id) {
                const nData = world.getBlockDataAt(n.x, n.y, n.z);
                const nLevel = nData & 7;
                const nFalling = (nData & 8) !== 0;

                if (n.y > y) {
                    hasSupplier = true;
                    break;
                } else if (nLevel < currentLevel || nFalling) {
                    hasSupplier = true;
                    break;
                }
            }
        }

        if (!hasSupplier) {
            if (currentLevel < 7) {
                world.setBlockAt(x, y, z, this.id, currentLevel + 1);
                world.scheduleBlockTick(x, y, z, this.tickRate);
            } else {
                world.setBlockAt(x, y, z, 0, 0); // Completely dried up
            }
        }
    }
}