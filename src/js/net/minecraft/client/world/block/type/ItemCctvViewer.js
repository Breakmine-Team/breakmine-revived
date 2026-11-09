import Item from "../Item.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "../BlockRegistry.js";

export default class ItemCctvViewer extends Item {

    constructor(id, textureSlotId, description) {
        super(id, 0);
        this.tex = textureSlotId;
        this.description = description;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    getTextureForFace(face) {
        return this.tex;
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        const minecraft = world?.minecraft;
        const cctv = minecraft?.cctvManager;
        if (!cctv) return false;

        if (hitFace && x !== undefined && y !== undefined && z !== undefined) {
            const hitX = x - hitFace.x;
            const hitY = y - hitFace.y;
            const hitZ = z - hitFace.z;

            if (world.getBlockAt(hitX, hitY, hitZ) === BlockRegistry.CCTV_CAMERA?.id) {
                cctv.pair({ x: hitX, y: hitY, z: hitZ });
                return true;
            }
        }

        if (cctv.getCamera()) {
            cctv.toggleView();
            return true;
        }

        return false;
    }
}
