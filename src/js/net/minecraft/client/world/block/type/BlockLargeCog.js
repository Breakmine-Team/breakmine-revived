import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import LargeCogRenderer from "../../../render/LargeCogRenderer.js";

/**
 * The large cog: a thirty-pixel spruce wheel with a plank hub, twice the span
 * of the plain cog so its teeth reach into the neighbouring cells.
 *
 * It is a shaft part like the small cog - it faces whoever placed it, meshes
 * with cogs (turning them the other way) and is turned by whatever assembly it
 * belongs to - but it draws the bigger model instead of the renderer's
 * built-in cog, so it is never drawn as a plain shaft part. Because the wheel
 * reaches the corners of its cell, only the cogs sitting on its diagonals are
 * in mesh with it; one sharing a side stays still (see ShaftDrive).
 */
export default class BlockLargeCog extends BlockShaftPart {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Large Cog";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // The wheel overhangs its cell into the neighbours' space.
        this.noFaceCull = true;

        // Read by ShaftDrive: this wheel only meshes with cogs on its diagonals.
        this.isLargeCog = true;
    }

    /** The whole shape is the wheel model; there are no plain shaft parts. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return LargeCogRenderer.TEXTURE;
    }

    /** Icon, break particles and any non-part rendering use the bar texture. */
    getTextureForFace(face) {
        return LargeCogRenderer.TEXTURE;
    }

    getMultipart(world, x, y, z) {
        const data = world && typeof world.getBlockDataAt === 'function'
            ? world.getBlockDataAt(x, y, z)
            : 0;

        return LargeCogRenderer.getParts(this.getAxis(data));
    }

    // Cogs mesh with neighbouring cogs and turn the other way.
    isCog() {
        return true;
    }

    /**
     * The wheel spans thirty pixels, so its teeth reach fifteen out: meshed with
     * the plain cog (9px) it turns at 3/5 of its speed, and the plain cog at
     * 5/3 of the wheel's.
     */
    getCogRadius() {
        return 15 / 16;
    }

    getPreferredToolType() {
        return 'axe';
    }
}
