import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Block from "../Block.js";

/**
 * Example block: a stone cube that turns on all three axes at once, a few
 * degrees per tick. It lives in the Debug creative tab, which the creative
 * screen only shows when the game was opened with ?dev=1.
 *
 * It is not part of the chunk mesh: the renderer gives it a mesh of its own
 * and turns that object every frame, blending between the angles of the last
 * two ticks, so the spin is smooth and nothing ever re-meshes because of it.
 */
export default class BlockDebugSpinner extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Debug Spinner";
        this.hardness = 1.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.DEBUG;

        // It turns, so its own faces and the neighbours' faces must always be
        // drawn: a face hidden by a solid neighbour would otherwise be culled
        // and the block would look hollow or clipped as it spins.
        this.noFaceCull = true;
    }

    getTextureForFace(face) {
        return 'stone';
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getOpacity() {
        return 0;
    }

    getRenderRotation(world, x, y, z, data, tick) {
        // The renderer's animation clock (20 Hz) drives the turn, so it keeps
        // spinning in multiplayer, where the client world never ticks itself.
        const step = (typeof tick === 'number' ? tick : 0) + 1;

        return {
            x: (step * 3) % 360,
            y: (step * 5) % 360,
            z: (step * 7) % 360
        };
    }
}
