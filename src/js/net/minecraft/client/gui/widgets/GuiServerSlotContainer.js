import GuiWorldSlotContainer from "./GuiWorldSlotContainer.js";
import GuiServerSlot from "./GuiServerSlot.js";

export default class GuiServerSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui, listContent) {
        super(parentGui, listContent);
        // Don't create slotList here - let it be set by the async loading in GuiMultiplayer
        this.slotList = [];
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        const sb = this.getScrollBarBounds();
        const overScrollBar = sb.visible &&
            mouseX >= sb.x && mouseX <= sb.x + sb.width &&
            mouseY >= sb.trackTop && mouseY <= sb.trackBottom;

        // The base container only selects the row, but the server slot also
        // handles click-to-join, so the click has to reach the slot itself
        if (!overScrollBar) {
            const index = this.getSlotIndexAt(mouseX, mouseY);
            const slot = index >= 0 && index < this.slotList.length ? this.slotList[index] : null;

            if (slot) {
                slot.mouseClicked(mouseX, mouseY, mouseButton);
                return;
            }
        }

        super.mouseClicked(mouseX, mouseY, mouseButton);
    }
}