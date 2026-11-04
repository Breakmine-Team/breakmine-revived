import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockEntityBluestonePusherHead from "../entity/BlockEntityBluestonePusherHead.js";

export default class BlockBluestonePusherHead extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Pusher Head";
        this.hardness = 0.3;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.unpushable = true;
        this.multipart = true;
    }

    isSolid() { return true; }

    hasBlockEntity() { return true; }

    createBlockEntity(world, x, y, z) {
        return new BlockEntityBluestonePusherHead(world, x, y, z);
    }

    getMultipart(world, x, y, z) {
        return [
            // Head Plate: {-0.5, 0.25, -0.5, 0.5, 0.5, 0.5} -> (0, 0.75, 0, 1, 1, 1)
            ["block", BlockRegistry.WOOD.id, new BoundingBox(0, 0.75, 0, 1, 1, 1)],
            // Shaft / Arm: {-0.125, -0.5, -0.125, 0.125, 0.25, 0.125} -> (0.375, 0, 0.375, 0.625, 0.75, 0.625)
            ["block", BlockRegistry.COBBLE_STONE.id, new BoundingBox(0.375, 0, 0.375, 0.625, 0.75, 0.625)]
        ];
    }

    onBlockRemoved(world, x, y, z) {
        const baseId = world.getBlockAt(x, y - 1, z);
        if (baseId) {
            const baseBlock = Block.getById(baseId);
            if (baseBlock && baseBlock.isPusher) {
                // The base clears its own extended bit (data & 1) *before*
                // removing the head during a normal retract, so an extended
                // base below us means the head was broken by hand — destroy
                // the whole pusher. Otherwise just let the base retract.
                if ((world.getBlockDataAt(x, y - 1, z) & 1) === 1) {
                    world.setBlockAt(x, y - 1, z, 0);
                } else {
                    world.scheduleBlockTick(x, y - 1, z, 1);
                }
            }
        }
    }
}