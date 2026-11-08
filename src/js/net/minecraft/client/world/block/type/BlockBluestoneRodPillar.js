import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockBluestoneDust from "./BlockBluestoneDust.js";

export default class BlockBluestoneRodPillar extends BlockBluestoneDust {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Rod";
        this.hardness = 0.5;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.isBluestoneDust = false;
    }

    getOpacity() {
        return 0;
    }

    getTransparency() {
        return 0.2;
    }

    isSolid() {
        return false;
    }

    isTranslucent() {
        return true;
    }

    getTextureForFace(face, data, x, y, z, world) {
        return 'bluestoneBlock';
    }
}
