import GuiWorldSlotContainer from "./GuiWorldSlotContainer.js";
import GuiModSlot from "./GuiModSlot.js";

export default class GuiModSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui, modList) {
        super(parentGui, modList);

        this.slotX = 5;
        this.slotWidth = parentGui.width - 10;

        this.slotList = modList.map((data, index) =>
            new GuiModSlot(
                data,
                5,
                0,
                parentGui.width - 10,
                36,
                () => {
                    this.setSelected(index);
                },
                parentGui.minecraft
            )
        );
    }
}
