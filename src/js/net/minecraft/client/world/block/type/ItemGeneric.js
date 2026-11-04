import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

export default class ItemGeneric extends Item {

    constructor(id, textureSlotId, description, overlayTexture = null, modelTexture = null) {
        super(id, 0);
        this.tex = textureSlotId;
        this.overlayTexture = overlayTexture;
        this.modelTexture = modelTexture;
        this.description = description;
        this.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
    }

    getTextureForFace(face) {
        return this.tex;
    }

    getTextureLayers() {
        return this.overlayTexture ? [this.tex, this.overlayTexture] : [this.tex];
    }
}
