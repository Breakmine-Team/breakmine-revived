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
