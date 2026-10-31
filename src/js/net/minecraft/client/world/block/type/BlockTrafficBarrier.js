import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const FACING_NORTH = 2;
const FACING_SOUTH = 3;
const FACING_WEST = 4;
const FACING_EAST = 5;

export default class BlockTrafficBarrier extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Traffic Barrier";
        this.hardness = 0.6;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;

        // The model is a thin panel, but the engine cannot rotate collision
        // boxes; keep the standard block box so collision matches every facing.
        this.noFaceCull = true;
    }

    // The barrier model uses its own texture, so this is only used for
    // breaking particles (the atlas has no traffic_barrier tile).
    getTextureForFace(face) {
        return 'white_concrete';
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

    onRender(world, x, y, z, blockRenderer) {
        blockRenderer.renderTrafficBarrier(world, x, y, z);
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
