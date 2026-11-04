import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockBluestoneDust from "./BlockBluestoneDust.js";

/**
 * Render-only helper used as the multipart pillar part of the Bluestone Rod.
 * It shows the Bluestone Block texture while keeping the bluestone power
 * color-fading logic (inherited from the dust), so the pillar glows and fades
 * with the network like the rest of the bluestone wiring.
 */
export default class BlockBluestoneRodPillar extends BlockBluestoneDust {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bluestone Rod";
        this.hardness = 0.5;
        this.inventoryTab = EnumCreativeInventoryTab.NOTLISTED;
        this.isBluestoneDust = false;
    }

    getTextureForFace(face, data, x, y, z, world) {
        return 'bluestoneBlock';
    }
}
