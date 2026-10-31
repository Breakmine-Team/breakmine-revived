import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

export default class BlockTrafficCone extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Traffic Cone";
        this.hardness = 0.3;
        this.sound = Block.sounds.cloth;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;

        // The model is 12/16 wide at the base and 15/16 tall.
        this.boundingBox = new BoundingBox(0.125, 0, 0.125, 0.875, 0.9375, 0.875);
        this.noFaceCull = true;
    }

    // The cone model uses its own texture, so this is only used for breaking
    // particles (the atlas has no traffic_cone tile).
    getTextureForFace(face) {
        return 'orange_concrete';
    }

    onRender(world, x, y, z, blockRenderer) {
        blockRenderer.renderTrafficCone(world, x, y, z);
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
