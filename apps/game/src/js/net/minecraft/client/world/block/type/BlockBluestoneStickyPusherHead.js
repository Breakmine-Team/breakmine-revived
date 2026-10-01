import BoundingBox from "../../../../util/BoundingBox.js";
import BlockBluestonePusherHead from "./BlockBluestonePusherHead.js";
import { BlockRegistry } from "../BlockRegistry.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockBluestoneStickyPusherHead extends BlockBluestonePusherHead {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Sticky Bluestone Pusher Head";
        this.hardness = 0.3;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.unpushable = true;
        this.multipart = true;
    }

    getMultipart(world, x, y, z) {
        return [
            // Head Plate: uses the sticky planks texture
            ["texture", null, { texture: 'oak_planks_sticky', bbox: new BoundingBox(0, 0.75, 0, 1, 1, 1) }],
            // Shaft / Arm
            ["block", BlockRegistry.COBBLE_STONE.id, new BoundingBox(0.375, 0, 0.375, 0.625, 0.75, 0.625)]
        ];
    }
}
