import GuiContainer from "../GuiContainer.js";
import ContainerChest from "../../../inventory/container/ContainerChest.js";

export default class GuiContainerChest extends GuiContainer {

    constructor(player, blockPosition = null) {
        super(new ContainerChest(player, blockPosition));

        this.inventoryWidth = 176;
        this.inventoryHeight = 166;
    }

    init() {
        this.textureInventory = this.getTexture("gui/container/chest.png");

        super.init();
    }

    drawTitle(stack) {
        this.drawString(stack, "Chest", this.x + 8, this.y + 6, 0xff404040, false);
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

    keyTyped(key, character) {
        if (key === this.minecraft.settings.keyOpenInventory) {
            this.minecraft.displayScreen(null);
            return true;
        }
        return super.keyTyped(key, character);
    }
}
