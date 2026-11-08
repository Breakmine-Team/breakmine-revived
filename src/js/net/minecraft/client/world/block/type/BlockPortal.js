import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

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
