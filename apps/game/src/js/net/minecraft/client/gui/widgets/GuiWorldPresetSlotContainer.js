import GuiWorldPresetSlot from "../widgets/GuiWorldPresetSlot.js";
import GuiScreen from "../GuiScreen.js";

export default class GuiWorldPresetSlotContainer {

    constructor(parentGui, listContent) {
        super(parentGui.minecraft);
        this.parentGui = parentGui;
        this.selectedWorld = -1;
        
        this.slotList = listContent.map((data, index) => 
            new GuiWorldPresetSlot(
                data, 
                5, 
                0, 
                this.parentGui.width - 10, 
                24, 
                () => {
                    this.setSelected(index);
                },
                this.parentGui.minecraft
            )
        );

        this.slotHeight = 24;
        this.top = 32; 
        this.bottom = this.parentGui.height - 64; 
        this.amountScrolled = 0; 
    }
    
    setSelected(index) {
        this.selectedWorld = index;
        this.parentGui.setSelectedWorld(index);
    }
    
    drawScreen(stack, mouseX, mouseY, partialTicks) {
        const listTop = this.top;
        const listBottom = this.bottom;
        const slotWidth = this.parentGui.width - 10; 
        this.parentGui.drawBackground(stack, this.parentGui.getTexture("gui/background.png"), this.parentGui.width, this.parentGui.height);
        
        stack.save();
        
        stack.beginPath();
        stack.rect(0, listTop, this.parentGui.width, listBottom - listTop);
        stack.clip();

        let currentY = listTop + 7 - this.amountScrolled; 

        this.drawBackgroundPart(stack, this.top, this.bottom);
        
        for (let i = 0; i < this.slotList.length; i++) {
            const slot = this.slotList[i];
            const slotHeight = this.slotHeight;
            const slotTop = currentY + (i * (slotHeight + 2));
            const slotBottom = slotTop + slotHeight;
            const slotLeft = 5;
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
                // Ensure minecraft instance is set for rendering
                if (!slot.minecraft && this.parentGui.minecraft) {
                    slot.minecraft = this.parentGui.minecraft;
                }
                slot.render(stack, mouseX, mouseY, partialTicks);
            }
        }
        
        stack.restore();
    }

    drawBackgroundPart(stack, top, bottom) {
        this.parentGui.drawRect(stack, 0, top, this.parentGui.width, bottom, "rgba(0, 0, 0, 0.5)");
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        if (mouseY >= this.top && mouseY <= this.bottom) {
            let relativeY = mouseY - this.top + this.amountScrolled - 4;
            let clickedIndex = Math.floor(relativeY / this.slotHeight);
            
            if (clickedIndex >= 0 && clickedIndex < this.slotList.length) {
                this.setSelected(clickedIndex);
            }
        }
    }
}