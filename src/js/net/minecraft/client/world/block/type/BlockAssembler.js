import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ContraptionEntity from "../../../entity/ContraptionEntity.js";
import BlockPosition from "../../../../util/BlockPosition.js";

// The Assembler glues everything attached to it into a single physics driven
// contraption. The block itself stays behind as the anchor of the machine.
export default class BlockAssembler extends Block {

    // Right clicking a block that sits in a large terrain mass must not swallow
    // the world, so the flood fill gives up after this many blocks.
    static MAX_CELLS = 256;

    // Placeholder until the Assembler gets real art.
    static TEXTURE = 'missing';

    static NEIGHBOURS = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
    ];

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Assembler";
        this.shiftDescription = "Right click to glue the attached blocks into a physics contraption";
        this.hardness = 2.0;

        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    getTextureForFace(face) {
        return BlockAssembler.TEXTURE;
    }

    onMouseButton(world, x, y, z, button) {
        if (button !== 2) {
            return false;
        }

        return this.assemble(world, x, y, z);
    }

    // Flood fills every block connected to the assembler, removes them and spawns
    // them again as one rigid body. Returns false when there is nothing to take.
    assemble(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== "function" || typeof world.setBlockAt !== "function") {
            return false;
        }

        // The placement ghost and item previews render into throwaway worlds.
        if (world.isPreview === true) {
            return false;
        }

        const minecraft = world.minecraft;
        if (!minecraft || typeof world.addEntity !== "function") {
            return false;
        }

        const blocks = this.collectAttachedBlocks(world, x, y, z);
        if (blocks.length === 0) {
            return false;
        }

        // Assemble around the centre of gravity, so the body rotates about the
        // point that actually balances it instead of about the clicked block.
        // Heavy blocks count for more than light ones.
        let mass = 0.0;
        let sumX = 0.0;
        let sumY = 0.0;
        let sumZ = 0.0;

        for (const block of blocks) {
            const blockMass = ContraptionEntity.getBlockMass(block.id);

            mass += blockMass;
            sumX += (block.x + 0.5) * blockMass;
            sumY += (block.y + 0.5) * blockMass;
            sumZ += (block.z + 0.5) * blockMass;
        }

        const weight = mass > 0.0 ? mass : blocks.length;
        const centerX = sumX / weight;
        const centerY = sumY / weight;
        const centerZ = sumZ / weight;

        const cells = blocks.map((block) => ({
            x: block.x,
            y: block.y,
            z: block.z,
            id: block.id,
            data: block.data
        }));

        for (const block of blocks) {
            world.setBlockAt(block.x, block.y, block.z, 0);

            // The server owns the saved world, so the blocks have to be removed
            // there as well or they come back next to the contraption when the
            // world is loaded again.
            if (!minecraft.isSingleplayer()
                && typeof minecraft.playerController.sendBlockDiggingPacket === "function") {
                minecraft.playerController.sendBlockDiggingPacket(
                    2, new BlockPosition(block.x, block.y, block.z), 0
                );
            }
        }

        const contraption = new ContraptionEntity(
            minecraft, world, cells, centerX, centerY, centerZ
        );

        world.addEntity(contraption);

        // Report it immediately so a world saved before the next sync tick still
        // keeps the contraption.
        contraption.sendNetworkState();

        return true;
    }

    collectAttachedBlocks(world, x, y, z) {
        const visited = new Set();
        const blocks = [];
        const queue = [[x, y, z]];

        visited.add(BlockAssembler.key(x, y, z));

        while (queue.length > 0 && blocks.length < BlockAssembler.MAX_CELLS) {
            const [currentX, currentY, currentZ] = queue.pop();

            for (const [dx, dy, dz] of BlockAssembler.NEIGHBOURS) {
                const blockX = currentX + dx;
                const blockY = currentY + dy;
                const blockZ = currentZ + dz;

                if (blockY < 0) {
                    continue;
                }

                const key = BlockAssembler.key(blockX, blockY, blockZ);
                if (visited.has(key)) {
                    continue;
                }
                visited.add(key);

                const typeId = world.getBlockAt(blockX, blockY, blockZ);
                if (!typeId) {
                    continue;
                }

                const block = Block.getById(typeId);
                if (block === null || block.isLiquid()) {
                    continue;
                }

                // Terrain is not cargo. The fill stops at the ground so a cart
                // built on the grass keeps the ground under it.
                if (block.isTerrain === true) {
                    continue;
                }

                // Assemblers are anchors, not cargo: they stop the flood fill.
                if (block.id === this.id) {
                    continue;
                }

                const data = typeof world.getBlockDataAt === "function"
                    ? world.getBlockDataAt(blockX, blockY, blockZ)
                    : 0;

                blocks.push({
                    x: blockX,
                    y: blockY,
                    z: blockZ,
                    id: typeId,
                    data: data
                });

                queue.push([blockX, blockY, blockZ]);

                if (blocks.length >= BlockAssembler.MAX_CELLS) {
                    break;
                }
            }
        }

        return blocks;
    }

    static key(x, y, z) {
        return x + "," + y + "," + z;
    }
}
