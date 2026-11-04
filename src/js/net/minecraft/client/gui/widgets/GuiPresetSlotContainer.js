import GuiWorldSlotContainer from "./GuiWorldSlotContainer.js";
import GuiWorldPresetSlot from "./GuiWorldPresetSlot.js";

export default class GuiPresetSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui, listContent) {
        super(parentGui, listContent);

        this.slotX = 5;
        this.slotWidth = parentGui.width - 10;

        this.slotList = listContent.map((data, index) =>
            new GuiWorldPresetSlot(
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
