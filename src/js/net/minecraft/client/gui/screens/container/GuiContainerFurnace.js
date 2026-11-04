import GuiContainer from "../GuiContainer.js";
import ContainerFurnace from "../../../inventory/container/ContainerFurnace.js";
import InventoryBasic from "../../../inventory/inventory/InventoryBasic.js";
import SmeltingRegistry from "../../../smelting/SmeltingRegistry.js";

export default class GuiContainerFurnace extends GuiContainer {

    static SHIFT_X = 78;

    constructor(player, blockPosition = null) {
        super(new ContainerFurnace(player, blockPosition));

        this.inventoryWidth = 176;
        this.inventoryHeight = 166;
        this.baseX = 0;
    }

    init() {
        this.textureInventory = this.getTexture("gui/container/furnace.png");
        this.textureFlame = this.getTexture("gui/container/lit_progress.png");
        this.textureArrow = this.getTexture("gui/container/burn_progress.png");

        super.init();
        this.baseX = this.x;
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

        const container = this.container;

        // Fuel burn indicator (flame) — stays full while fuel is in the slot, drains only after consumption
        const inv = container.tileEntity;
        const fuelStack = inv.getItemInSlot(1);
        let burnPct;
        if (!fuelStack.isEmpty() && SmeltingRegistry.isFuel(fuelStack.getType())) {
            burnPct = 1;
        } else if (inv.fuelBurnTime > 0) {
            burnPct = inv.burnTime / inv.fuelBurnTime;
        } else {
            burnPct = 0;
        }
        if (burnPct > 0) {
            const w = this.textureFlame.naturalWidth;
            const h = this.textureFlame.naturalHeight;
            const sh = Math.floor(h * burnPct);
            const sy = h - sh;
            this.drawSprite(
                stack,
                this.textureFlame,
                0,
                sy,
                w,
                sh,
                this.x + 56,
                this.y + 36 + sy,
                w,
                sh
            );
        }

        // Cook progress indicator (arrow) — left portion visible, clipped from right
        const cookPct = Math.min(inv.cookTime / 200, 1);
        if (cookPct > 0) {
            const w = this.textureArrow.naturalWidth;
            const h = this.textureArrow.naturalHeight;
            const sw = Math.floor(w * cookPct);
            this.drawSprite(
                stack,
                this.textureArrow,
                0,
                0,
                sw,
                h,
                this.x + 79,
                this.y + 34,
                sw,
                h
            );
        }
    }

    updateScreen() {
        this.container.dirty = true;
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    keyTyped(key, character) {
        if (key === this.minecraft.settings.keyOpenInventory) {
            this.minecraft.displayScreen(null);
            return true;
        }

        return super.keyTyped(key, character);
    }

}