import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import ContraptionEntity from "../../../entity/ContraptionEntity.js";
import BlockPosition from "../../../../util/BlockPosition.js";

// The Assembler glues everything attached to it into a single physics driven
// contraption and goes with it, so the machine carries its own control block.
// Clicking that block again snaps the machine back onto the block grid.
export default class BlockAssembler extends Block {

    // Right clicking a block that sits in a large terrain mass must not swallow
    // the world, so the flood fill gives up after this many blocks.
    static MAX_CELLS = 256;

    // Block metadata bit for the lit front. An Assembler carries it while it is
    // part of a running contraption and loses it when it lands back on the grid.
    static RUNNING_BIT = 8;

    static TEXTURE_FRONT_OFF = 'assembler_front_off';
    static TEXTURE_FRONT_ON = 'assembler_front_on';
    static TEXTURE_SIDE = 'assembler_side';
    static TEXTURE_BACK = 'assembler_back';
    static TEXTURE_TOP = 'assembler_top';
    static TEXTURE_BOTTOM = 'assembler_bottom';

    static NEIGHBOURS = [
        [1, 0, 0], [-1, 0, 0],
        [0, 1, 0], [0, -1, 0],
        [0, 0, 1], [0, 0, -1]
    ];

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Assembler";
        this.shiftDescription = "Right click to glue the attached blocks into a physics contraption. Right click the assembled machine to snap it back onto the grid";
        this.hardness = 2.0;

        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;

        // The front faces the player who placed it, like a furnace.
        this.rotationType = Block.ROTATION_HORIZONTAL;

        this.isAssembler = true;
    }

    getTextureForFace(face, data = 0) {
        // Same metadata layout as the furnace: 2/3/4/5 is the facing and bit 8
        // is the lit front, which an Assembler wears inside a contraption.
        let facing = data & 7;
        if (facing < 2 || facing > 5) {
            facing = 2;
        }

        const front = (data & BlockAssembler.RUNNING_BIT) !== 0
            ? BlockAssembler.TEXTURE_FRONT_ON
            : BlockAssembler.TEXTURE_FRONT_OFF;

        switch (face) {
            case EnumBlockFace.TOP:
                return BlockAssembler.TEXTURE_TOP;
            case EnumBlockFace.BOTTOM:
                return BlockAssembler.TEXTURE_BOTTOM;
            case EnumBlockFace.NORTH:
                return facing === 2 ? front : facing === 3 ? BlockAssembler.TEXTURE_BACK : BlockAssembler.TEXTURE_SIDE;
            case EnumBlockFace.SOUTH:
                return facing === 3 ? front : facing === 2 ? BlockAssembler.TEXTURE_BACK : BlockAssembler.TEXTURE_SIDE;
            case EnumBlockFace.WEST:
                return facing === 4 ? front : facing === 5 ? BlockAssembler.TEXTURE_BACK : BlockAssembler.TEXTURE_SIDE;
            case EnumBlockFace.EAST:
                return facing === 5 ? front : facing === 4 ? BlockAssembler.TEXTURE_BACK : BlockAssembler.TEXTURE_SIDE;
            default:
                return BlockAssembler.TEXTURE_SIDE;
        }
    }

    onMouseButton(world, x, y, z, button) {
        if (button !== 2) {
            return false;
        }

        // An Assembler cell inside a contraption does not glue anything: it
        // snaps the machine it belongs to back onto the block grid.
        const field = world && world.isFieldLocalWorld === true ? world.cellField : null;
        if (field && field.contraption) {
            return field.contraption.disassemble() === true;
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

        // The Assembler goes into the machine it just built. Its front is lit
        // while it is part of a running contraption, and clicking that cell
        // again is what snaps the machine back onto the block grid.
        const assemblerData = ((typeof world.getBlockDataAt === "function"
            ? world.getBlockDataAt(x, y, z)
            : 0) | BlockAssembler.RUNNING_BIT) & 0xF;

        const cells = [
            { x: x, y: y, z: z, id: this.id, data: assemblerData },
            ...blocks.map((block) => ({
                x: block.x,
                y: block.y,
                z: block.z,
                id: block.id,
                data: block.data
            }))
        ];

        // Assemble around the centre of gravity, so the body rotates about the
        // point that actually balances it instead of about the clicked block.
        // Heavy blocks count for more than light ones.
        let mass = 0.0;
        let sumX = 0.0;
        let sumY = 0.0;
        let sumZ = 0.0;

        for (const cell of cells) {
            const cellMass = ContraptionEntity.getBlockMass(cell.id);

            mass += cellMass;
            sumX += (cell.x + 0.5) * cellMass;
            sumY += (cell.y + 0.5) * cellMass;
            sumZ += (cell.z + 0.5) * cellMass;
        }

        const weight = mass > 0.0 ? mass : cells.length;
        const centerX = sumX / weight;
        const centerY = sumY / weight;
        const centerZ = sumZ / weight;

        for (const cell of cells) {
            world.setBlockAt(cell.x, cell.y, cell.z, 0);

            // The server owns the saved world, so the blocks have to be removed
            // there as well or they come back next to the contraption when the
            // world is loaded again.
            if (!minecraft.isSingleplayer()
                && typeof minecraft.playerController.sendBlockDiggingPacket === "function") {
                minecraft.playerController.sendBlockDiggingPacket(
                    2, new BlockPosition(cell.x, cell.y, cell.z), 0
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
