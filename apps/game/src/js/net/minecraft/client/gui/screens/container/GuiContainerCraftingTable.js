import GuiContainer from "../GuiContainer.js";
import ContainerCraftingTable from "../../../inventory/container/ContainerCraftingTable.js";
import GuiRecipeBook from "../GuiRecipeBook.js";

export default class GuiContainerCraftingTable extends GuiContainer {

    static SHIFT_X = 78;

    constructor(player, blockPosition = null) {
        super(new ContainerCraftingTable(player, blockPosition));

        this.inventoryWidth = 195;
        this.inventoryHeight = 165;
        this.baseX = 0;
    }

    init() {
        this.textureInventory = this.getTexture("gui/container/crafting_table.png");

        this.recipeBook = new GuiRecipeBook(this.minecraft);
        this.recipeBook.init();

        super.init();
        this.baseX = this.x;
        this.applyRecipeBookOffset();
    }

    applyRecipeBookOffset() {
        if (this.recipeBook && this.recipeBook.isOpen()) {
            this.x = this.baseX + GuiContainerCraftingTable.SHIFT_X;
        } else {
            this.x = this.baseX;
        }
    }

    drawTitle(stack) {
        //
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
        super.drawScreen(stack, mouseX, mouseY, partialTicks);

        if (this.minecraft.player) this.recipeBook.checkUnlock(this.minecraft.player.inventory);
        this.recipeBook.drawGui(stack, this.x - 5 - 150, this.y);
        this.recipeBook.draw(stack, this.x, this.y, mouseX, mouseY);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        super.mouseClicked(mouseX, mouseY, mouseButton);

        if (this.recipeBook.onClick(mouseX, mouseY, this.x, this.y)) {
            this.applyRecipeBookOffset();
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