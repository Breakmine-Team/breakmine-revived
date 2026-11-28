import GuiWorldSlotContainer from "./GuiWorldSlotContainer.js";
import GuiFriendSlot from "./GuiFriendSlot.js";

const SLOT_HEIGHT = 36;
const SLOT_SPACING = 2;

export default class GuiFriendSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui, friends) {
        super(parentGui, friends);

        this.slotHeight = SLOT_HEIGHT;
        this.slotSpacing = SLOT_SPACING;
        this.slotX = 5;
        this.slotWidth = parentGui.width - 10;

        this.setFriends(friends);
    }
    
    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.clampScroll();

        const listTop = this.top;
        const listBottom = this.bottom;
        const slotWidth = this.slotWidth;

        stack.save();
        stack.beginPath();
        stack.rect(this.viewLeft, listTop, this.viewRight - this.viewLeft, listBottom - listTop);
        stack.clip();

        let currentY = listTop + 7 - this.amountScrolled;

        for (let i = 0; i < this.slotList.length; i++) {
            const slot = this.slotList[i];
            const slotHeight = this.slotHeight;
            const slotTop = currentY + (i * (slotHeight + this.slotSpacing));
            const slotBottom = slotTop + slotHeight;
            const slotLeft = this.slotX;
            const slotRight = slotLeft + slotWidth;

            if (slotBottom >= listTop && slotTop <= listBottom) {
                if (i === this.selectedWorld) {
                    this.parentGui.drawRect(stack, slotLeft - 1, slotTop - 3, slotRight + 1, slotBottom - 1, "rgb(153, 153, 153)");
                    this.parentGui.drawRect(stack, slotLeft, slotTop - 2, slotRight, slotBottom - 2, "rgba(0, 0, 0)");
                }

                slot.x = slotLeft;
                slot.y = slotTop;
                slot.width = slotWidth;
                slot.height = slotHeight;
                if (!slot.minecraft && this.parentGui.minecraft) {
                    slot.minecraft = this.parentGui.minecraft;
                }
                slot.render(stack, mouseX, mouseY, partialTicks);
            }
        }

        stack.restore();

        this.drawScrollBar(stack, mouseX, mouseY);
    }

    setFriends(friends) {
        this.selectedWorld = -1;
        this.slotList = (friends || []).map((friend, index) =>
            new GuiFriendSlot(
                friend,
                0,
                0,
                this.slotWidth,
                SLOT_HEIGHT,
                () => {
                    this.setSelected(index);
                },
                this.parentGui.minecraft
            )
        );
        this.clampScroll();
    }

    setSelected(index) {
        this.selectedWorld = index;

        if (this.parentGui && typeof this.parentGui.setSelectedFriend === "function") {
            this.parentGui.setSelectedFriend(index);
        }
    }
}
