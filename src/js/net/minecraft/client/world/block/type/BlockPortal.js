import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

/**
 * Nether portal sheet.
 *
 * A lit portal is a 2px-thick plate, not a full cube. Metadata records which
 * way the sheet lies (0 = along X, thin in Z; 1 = along Z, thin in X), matching
 * the plane the frame was built in. It has no collision and is deliberately
 * hidden from the creative palette.
 */
export default class BlockPortal extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Nether Portal";
        this.hardness = 0.0;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
    }

    getTextureForFace() {
        return 'portal';
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getOpacity() {
        return 0;
    }

    getBoundingBox(world, x, y, z) {
        const thinInX = world ? (world.getBlockDataAt(x, y, z) & 1) === 1 : false;
        return thinInX
            ? new BoundingBox(0.4375, 0, 0, 0.5625, 1, 1)
            : new BoundingBox(0, 0, 0.4375, 1, 1, 0.5625);
    }

    getCollisionBoundingBox() {
        return null;
    }

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        if (!world) {
            return true;
        }
        const typeId = prefetchedTypeId !== undefined ? prefetchedTypeId : world.getBlockAtFace(x, y, z, face);
        return typeId !== this.id;
    }
}
