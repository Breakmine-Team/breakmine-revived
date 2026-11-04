import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import LargeCogRenderer from "../../../render/LargeCogRenderer.js";

/**
 * The large cog: a thirty-pixel spruce wheel with a plank hub, twice the span
 * of the plain cog so its teeth reach into the neighbouring cells.
 *
 * It is a shaft part like the small cog - it faces whoever placed it, meshes
 * rim to rim with other cogs (turning the other way) and is turned by whatever
 * assembly it belongs to - but it draws the bigger model instead of the
 * renderer's built-in cog, so it is never drawn as a plain shaft part.
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

    getPreferredToolType() {
        return 'axe';
    }
}
