import GuiContainer from "../GuiContainer.js";
import ContainerSurvival from "../../../inventory/container/ContainerSurvival.js";
import InventoryBasic from "../../../inventory/inventory/InventoryBasic.js";
import GuiRecipeBook from "../GuiRecipeBook.js";

export default class GuiContainerSurvival extends GuiContainer {

    static inventory = new InventoryBasic();
    static SHIFT_X = 78;

    constructor(player) {
        super(new ContainerSurvival(player));

        this.inventoryWidth = 195;
        this.inventoryHeight = 166;

        this.cantPauseGame = true;
    }

    init() {
        this.textureInventory = this.getTexture("gui/container/inventory.png");

        this.recipeBook = new GuiRecipeBook(this.minecraft);
        this.recipeBook.init();

        super.init();
    }

    _centeredX() {
        const cx = Math.floor((this.width - this.inventoryWidth) / 2);
        return this.recipeBook && this.recipeBook.isOpen() ? cx + GuiContainerSurvival.SHIFT_X : cx;
    }

    drawTitle(stack) {
        
    }

    drawInventoryBackground(stack) {
        this.drawSprite(
            stack,
            this.textureInventory,
            0,
            0,
            this.inventoryWidth,
            this.inventoryHeight,
            this.x,
            this.y,
            this.inventoryWidth,
            this.inventoryHeight
        );
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.y = Math.floor((this.height - this.inventoryHeight) / 2);
        this.x = this._centeredX();

        super.drawScreen(stack, mouseX, mouseY, partialTicks);

        if (this.minecraft.player) this.recipeBook.checkUnlock(this.minecraft.player.inventory);
        this.recipeBook.drawGui(stack, this.x - 5 - 150, this.y);
        this.recipeBook.draw(stack, this.x, this.y, mouseX, mouseY);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        super.mouseClicked(mouseX, mouseY, mouseButton);

        if (this.recipeBook.onClick(mouseX, mouseY, this.x, this.y)) {
            this.x = this._centeredX();
        }
    }

    keyTyped(key, character) {
        if (this.recipeBook.handleKey(key, character)) return true;

        if (key === this.minecraft.settings.keyOpenInventory) {
            this.recipeBook.setOpen(false);
            this.minecraft.displayScreen(null);
            return true;
        }

        return super.keyTyped(key, character);
    }

    onClose() {
        this.recipeBook.setOpen(false);
        super.onClose();
    }

}