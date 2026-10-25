import Block from "../Block.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";

export default class BlockLiquid extends Block {

    static MAX_LEVEL = 7;
    static FALLING_FLAG = 8;

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

    // Water + lava => cobblestone in the base implementation. Subclasses
    // (BlockLava / BlockWater) override to also produce obsidian when source
    // blocks touch.
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
        const currentLevel = currentData & BlockLiquid.MAX_LEVEL; // Level 0 (source) to 7
        const isFalling = (currentData & BlockLiquid.FALLING_FLAG) !== 0;

        // A source block never dries up. Every other liquid block has to keep
        // finding a source upstream; once that source is removed it loses one
        // level per tick, and its neighbours are woken so the whole stream
        // recedes with it until no water is left.
        if (!this.isSourceData(currentData) && !this.hasSourceSupply(world, x, y, z)) {
            this.decay(world, x, y, z, currentLevel);
            return;
        }

        // 1. Try flowing straight down
        const targetY = y - 1;
        if (this.canFlowInto(world, x, targetY, z)) {
            // Data flag 8 marks falling liquid
            this.flowInto(world, x, targetY, z, BlockLiquid.FALLING_FLAG);
            
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
    }

    /** True for a source block: level 0 and not part of a falling stream. */
    isSourceData(data) {
        return (data & BlockLiquid.FALLING_FLAG) === 0
            && (data & BlockLiquid.MAX_LEVEL) === 0;
    }

    canFlowInto(world, x, y, z) {
        if (y < 0 || y >= 256) return false;

        const typeId = world.getBlockAt(x, y, z);
        if (typeId === 0) return true; // Air
        if (typeId === this.getOppositeLiquidId()) return false; // Never flow into the opposite liquid (reacts instead)

        // A source is never overwritten by a neighbouring stream. Flowing
        // liquid may merge into other flowing liquid, though.
        if (typeId === this.id) {
            return !this.isSourceData(world.getBlockDataAt(x, y, z));
        }

        const block = Block.getById(typeId);
        if (block === null) return true;

        // Can flow into replaceable blocks (grass, flowers)
        return block.isReplaceable(world, x, y, z);
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
     * Loses one level of water. Called once per tick while the block cannot
     * find a source upstream, so a stream dries up one level at a time and is
     * removed after level 7. Neighbours are woken so the whole stream decays
     * together, not one block at a time.
     */
    decay(world, x, y, z, currentLevel) {
        const nextLevel = currentLevel + 1;

        if (nextLevel > BlockLiquid.MAX_LEVEL) {
            world.setBlockAt(x, y, z, 0, 0); // Completely dried up
        } else {
            world.setBlockAt(x, y, z, this.id, nextLevel);
            world.scheduleBlockTick(x, y, z, this.tickRate);
        }

        if (typeof world.scheduleNeighborTicks === 'function') {
            world.scheduleNeighborTicks(x, y, z);
        }
    }

    /**
     * Walks upstream through the connected liquid looking for a source block.
     * Liquid is fed from directly above (falling streams) or from a horizontal
     * neighbour one level closer to the source. When the only source is
     * removed every flowing block fails this search and starts decaying, so
     * the stream recedes evenly until nothing is left.
     */
    hasSourceSupply(world, x, y, z) {
        const directions = [
            { x: 1, z: 0 },
            { x: -1, z: 0 },
            { x: 0, z: 1 },
            { x: 0, z: -1 }
        ];

        const seen = new Set();
        const queue = [];

        const consider = (nx, ny, nz, maxLevel) => {
            if (ny < 0 || ny >= 256) return false;
            if (world.getBlockAt(nx, ny, nz) !== this.id) return false;

            const data = world.getBlockDataAt(nx, ny, nz);
            if (this.isSourceData(data)) return true;
            if ((data & BlockLiquid.MAX_LEVEL) >= maxLevel) return false;

            const key = `${nx},${ny},${nz}`;
            if (seen.has(key)) return false;
            // Fail safe: a huge body is treated as supplied rather than
            // wiping out a legitimate body of water on a search limit.
            if (seen.size >= 1024) return true;

            seen.add(key);
            queue.push({ x: nx, y: ny, z: nz, level: data & BlockLiquid.MAX_LEVEL });
            return false;
        };

        // Directly above always feeds (it is what makes a falling stream).
        if (consider(x, y + 1, z, BlockLiquid.MAX_LEVEL + 1)) return true;

        const ownLevel = world.getBlockDataAt(x, y, z) & BlockLiquid.MAX_LEVEL;
        for (const dir of directions) {
            if (consider(x + dir.x, y, z + dir.z, ownLevel)) return true;
        }

        while (queue.length > 0) {
            const node = queue.shift();

            if (consider(node.x, node.y + 1, node.z, BlockLiquid.MAX_LEVEL + 1)) return true;

            for (const dir of directions) {
                if (consider(node.x + dir.x, node.y, node.z + dir.z, node.level)) return true;
            }
        }

        return false;
    }
}
