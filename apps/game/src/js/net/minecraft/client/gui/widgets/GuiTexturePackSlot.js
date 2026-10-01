import GuiButton from "./GuiButton.js";

export default class GuiTexturePackSlot extends GuiButton {

    packName = "";
    packDescription = "";
    packVersion = "";
    packAuthor = "";
    
    constructor(packData, x, y, width, height, callback, minecraft) {
        super(minecraft, packData.name, x, y, width, height, callback); 
        
        this.packName = packData.name;
        this.packDescription = packData.description;
        this.packVersion = packData.version;
        this.packAuthor = packData.author;

        this.drawButton = () => {}; 
        
        this.renderE = true;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;
        
        const slotX = this.x;
        const slotY = this.y;
        
        const WHITE = 16777215;
        const GRAY = 8421504;
        const YELLOW = 16777045;
        
        this.drawString(stack, this.packName, slotX + 2, slotY + 1, WHITE, true, false);
        this.drawString(stack, this.packDescription, slotX + 2, slotY + 12, GRAY, true, false);
        this.drawString(stack, "v" + this.packVersion + " by " + this.packAuthor, slotX + 2, slotY + 22, YELLOW, true, false);
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback(); 
        }
    }
}
