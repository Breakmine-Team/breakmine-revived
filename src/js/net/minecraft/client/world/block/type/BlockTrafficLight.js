import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const FACING_NORTH = 2;
const FACING_SOUTH = 3;
const FACING_WEST = 4;
const FACING_EAST = 5;

export default class BlockTrafficLight extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Traffic Light";
        this.hardness = 0.6;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;

        this.noFaceCull = true;
    }

    getTextureForFace(face) {
        return 'gray_concrete';
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return [FACING_NORTH, FACING_EAST, FACING_SOUTH, FACING_WEST][dirIndex];
    }

    onBlockPlaced(world, x, y, z, face) {
        if (world && world.minecraft && world.minecraft.player) {
            const player = world.minecraft.player;
            world.setBlockDataAt(x, y, z, this.getPlacementMetadata(
                world, x, y, z, face, player.rotationYaw
            ));
        }
    }

    // Metadata is a single 4-bit value shared with the network format.
    // Entry [facing, state] for each metadata value; values 2-5 keep the
    // original facing-only metadata working, those blocks just have no light on.
    static DATA_LAYOUT = [
        [2, 1], [3, 1],
        [2, 0], [3, 0], [4, 0], [5, 0],
        [4, 1], [5, 1],
        [2, 2], [3, 2], [4, 2], [5, 2],
        [2, 3], [3, 3], [4, 3], [5, 3]
    ];

    static getFacing(data) {
        return BlockTrafficLight.DATA_LAYOUT[(data || 0) & 15][0];
    }

    static getLightState(data) {
        return BlockTrafficLight.DATA_LAYOUT[(data || 0) & 15][1];
    }

    static encodeData(facing, state) {
        const index = BlockTrafficLight.DATA_LAYOUT
            .findIndex(entry => entry[0] === facing && entry[1] === state);
        return index === -1 ? facing : index;
    }

    getLightValue(world, x, y, z) {
        if (!world || typeof x !== 'number') {
            return 0;
        }
        return BlockTrafficLight.getLightState(world.getBlockDataAt(x, y, z)) === 0 ? 0 : 10;
    }

    onMouseButton(world, x, y, z, button) {
        if (button !== 2) {
            return false;
        }

        const data = world.getBlockDataAt(x, y, z) || 0;
        const facing = BlockTrafficLight.getFacing(data);
        const nextState = (BlockTrafficLight.getLightState(data) + 1) & 3;
        world.setBlockDataAt(x, y, z, BlockTrafficLight.encodeData(facing, nextState));

        world.minecraft?.player?.swingArm?.();
        world.minecraft?.soundManager?.playGuiClick?.();
        return true;
    }

    onRender(world, x, y, z, blockRenderer) {
        blockRenderer.renderTrafficLight(world, x, y, z);
        return true;
    }

    shouldRenderFace(world, x, y, z, face) {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getOpacity() {
        return 0;
    }
}
