import GuiWorldSlotContainer from "./GuiWorldSlotContainer.js";
import GuiTexturePackSlot from "./GuiTexturePackSlot.js";

export default class GuiTexturePackSlotContainer extends GuiWorldSlotContainer {

    constructor(parentGui, listContent) {
        super(parentGui, listContent);

        this.slotX = 5;
        this.slotWidth = parentGui.width - 10;

        this.slotList = listContent.map((data, index) =>
            new GuiTexturePackSlot(
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

    setSelected(index) {
        this.selectedPack = index;
        this.selectedWorld = index;
        this.parentGui.setSelectedPack(index);
    }
}
