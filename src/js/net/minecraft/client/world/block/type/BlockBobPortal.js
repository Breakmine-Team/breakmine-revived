import BlockPortal from "./BlockPortal.js";

// Same shape and behaviour as the Hell portal, but tinted red.
const BOB_PORTAL_COLOR = 0xff5a4a;

export default class BlockBobPortal extends BlockPortal {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Bob Portal";
    }

    getColor() {
        return BOB_PORTAL_COLOR;
    }
}
