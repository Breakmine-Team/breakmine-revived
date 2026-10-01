import GuiWorldSlotContainer from "./GuiWorldSlotContainer.js";
import GuiServerSlot from "./GuiServerSlot.js";

export default class GuiServerSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui, listContent) {
        super(parentGui, listContent);
        // Don't create slotList here - let it be set by the async loading in GuiMultiplayer
        this.slotList = [];
    }
}