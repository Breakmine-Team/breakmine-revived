import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import Block from "../Block.js";
import BlockBluestonePusher from "./BlockBluestonePusher.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const PUSHER_HEAD_ID = 171;

export default class BlockBluestoneStickyPusher extends BlockBluestonePusher {

    constructor(id, textureSlotId) {
        super(id, textureSlotId, PUSHER_HEAD_ID);
        this.description = "Sticky Bluestone Pusher";
        this.hardness = 0.3;
        this.isBluestoneConsumer = true;
        this.isPusher = true;
        this.inventoryTab = EnumCreativeInventoryTab.MACHINES;
    }

    pickedItem() { return this.id; }

    getTextureForFace(face, data, x, y, z, world) {
        if (face === EnumBlockFace.TOP) {
            if (world) return this.getState(world, x, y, z) === 1 ? 'cobblestone_frame_on' : 'oak_planks_sticky';
            return 'oak_planks_sticky';
        } else if (face === EnumBlockFace.BOTTOM) {
            return 'cobblestone_frame';
        }
        if (!world || typeof x !== 'number') {
            return 'bluestoneStickyPusherOff';
        }
        return this.getState(world, x, y, z) === 1
            ? 'bluestonePusherOn'
            : 'bluestoneStickyPusherOff';
    }

    updateState(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) return;

        const isNowPowered = this.isPowered(world, x, y, z);
        const currentState = this.getState(world, x, y, z);

        if (isNowPowered && currentState === 0) {
            // Extend: push the column of blocks up, then place the head.
            const pushed = this.pushBlockOnTop(world, x, y, z);
            if (pushed) {
                world.setBlockDataAt(x, y, z, 1);
                world.setBlockAt(x, y + 1, z, this.headBlockId);
                world.onBlockChanged(x, y, z);
                world.onBlockChanged(x, y + 1, z);
            }
        } else if (!isNowPowered && currentState === 1) {
            // Retract: pull the head (and the block stuck to it) back down.
            world.setBlockDataAt(x, y, z, 0);

            const headPresent = world.getBlockAt(x, y + 1, z) === this.headBlockId;
            if (headPresent) {
                world.setBlockAt(x, y + 1, z, 0);
                world.onBlockChanged(x, y + 1, z);
            }

            // Only pull when the head is still in place (the block stuck to it).
            if (headPresent) {
                const attachedId = world.getBlockAt(x, y + 2, z);
                if (attachedId !== undefined && attachedId !== null && attachedId !== 0 && attachedId !== -1) {
                    const attachedBlock = Block.getById(attachedId);
                    if (attachedBlock && !attachedBlock.unpushable) {
                        const attachedData = world.getBlockDataAt(x, y + 2, z) || 0;
                        world.setBlockAt(x, y + 1, z, attachedId);
                        world.setBlockDataAt(x, y + 1, z, attachedData);
                        world.setBlockAt(x, y + 2, z, 0);
                        world.onBlockChanged(x, y + 1, z);
                        world.onBlockChanged(x, y + 2, z);
                    }
                }
            }

            world.onBlockChanged(x, y, z);
        }
    }
}
