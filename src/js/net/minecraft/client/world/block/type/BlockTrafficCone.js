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

        this.noFaceCull = true;
    }

    // The cone model uses its own texture, so this is only used for breaking
    // particles (the atlas has no traffic_cone tile).
    getTextureForFace(face) {
        return 'red_concrete';
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
