import GuiScreen from "../GuiScreen.js";
import Block from "../../world/block/Block.js";
import { BlockRegistry } from "../../world/block/BlockRegistry.js";
import GuiTooltip from "../widgets/GuiTooltip.js";
import ItemStack from "../../item/ItemStack.js";
import Keyboard from "../../../util/Keyboard.js";

export default class GuiContainer extends GuiScreen {

    constructor(container) {
        super();

        this.inventoryWidth = 176;
        this.inventoryHeight = 166;

        this.container = container;

        this.hoverSlot = null;
        this.tooltip = null;
    }

    
    usesGuiItems() {
        return true;
    }

    init() {
        super.init();

        this.x = Math.floor((this.width - this.inventoryWidth) / 2);
        this.y = Math.floor((this.height - this.inventoryHeight) / 2);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawInventoryBackground(stack);

        if (this.container.dirty) {
            this.container.dirty = false;
            this.minecraft.itemRenderer.destroy("inventory");
            this.minecraft.itemRenderer.scheduleDirty("hotbar");
        }

        this.hoverSlot = null;
        this.container.slots.forEach(slot => {
            this.drawSlot(stack, slot, mouseX, mouseY);
        });

        let inventoryPlayer = this.minecraft.player.inventory;
        let itemStack = inventoryPlayer.itemInCursor;
        if (!itemStack.isEmpty()) {
            let typeId = itemStack.getType();
            let block = Block.getById(typeId);
            if (block !== null) {
                this.minecraft.itemRenderer.zIndex = 10;
                this.minecraft.itemRenderer.renderItemInGui(
                    "inventory",
                    "cursor",
                    block,
                    mouseX,
                    mouseY
                );
                this.minecraft.itemRenderer.zIndex = 0;
            }
        } else {
            this.minecraft.itemRenderer.destroy("inventory", "cursor");
        }

        this.drawTitle(stack);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    renderPostScreen(stack, mouseX, mouseY, partialTicks) {
        if (this.hoverSlot) {
            let inventory = this.hoverSlot.inventory;
            let itemStack = inventory.getItemInSlot(this.hoverSlot.index);
            if (!itemStack.isEmpty()) {
                let hoveredTypeId = itemStack.getType();
                let block = Block.getById(hoveredTypeId);
                if (block && block.getDescription()) {
                    let slotX = this.x + this.hoverSlot.x;
                    let slotY = this.y + this.hoverSlot.y;
                    let tooltipText = `${block.getDescription()}\n${this.getShiftTooltipText(block)}§8${BlockRegistry.getNamespacedKeyFromId(hoveredTypeId)}\n§9${block.mod ?? "Unknown Mod"}§r`;
                    let tooltip = new GuiTooltip(this.minecraft, tooltipText, slotX, slotY, 16, 16);
                    tooltip.render(stack, mouseX, mouseY, partialTicks);
                }
            }
        }
    }

    
    getShiftTooltipText(block) {
        const info = typeof block.getShiftDescription === "function" ? block.getShiftDescription() : null;
        if (!info || (Array.isArray(info) && info.length === 0)) {
            return "";
        }

        if (!Keyboard.isShiftDown()) {
            return "§7[Shift for info]\n";
        }

        const lines = Array.isArray(info) ? info : String(info).split(/\r?\n/);
        return lines.map(line => `§7${line}§r`).join("\n") + "\n";
    }

    renderPostItem(stack, mouseX, mouseY, partialTicks) {
        for (const slot of this.container.slots) {
            let inventory = slot.inventory;
            let itemStack = inventory.getItemInSlot(slot.index);
            if (!itemStack.isEmpty()) {
                let typeId = itemStack.getType();
                let block = Block.getById(typeId);
                if (block !== null && itemStack.getCount() > 1) {
                    this.minecraft.fontRenderer.drawString(
                        stack,
                        itemStack.getCount().toString(),
                        this.x + slot.x + (16 - this.getStringWidth(stack, itemStack.getCount().toString())),
                        this.y + slot.y + 8,
                        0xFFFFFF
                    );
                }
            }
        }

        const cursorItem = this.minecraft.player.inventory.itemInCursor;
        if (!cursorItem.isEmpty() && cursorItem.getCount() > 1) {
            const countText = cursorItem.getCount().toString();
            const countWidth = this.getStringWidth(stack, countText);
            this.minecraft.fontRenderer.drawString(
                stack,
                countText,
                Math.floor(mouseX + 8 - countWidth),
                Math.floor(mouseY),
                0xFFFFFF,
                true
            );
        }
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        super.mouseClicked(mouseX, mouseY, mouseButton);

        for (const slot of this.container.slots) {
            if (this.isMouseOverSlot(slot, mouseX, mouseY)) {
                this.container.onSlotClick(slot, this.minecraft.player, mouseButton);
            }
        }
    }

    keyTyped(key, character) {
        for (let i = 1; i <= 9; i++) {
            if (key === this.minecraft.settings['keyHotbar' + i] && this.hoverSlot !== null) {
                this.container.swapWithHotbar(this.hoverSlot, this.minecraft.player.inventory, i - 1);
            }
        }

        return super.keyTyped(key, character);
    }

    drawSlot(stack, slot, mouseX, mouseY) {
        let x = this.x + slot.x;
        let y = this.y + slot.y;

        let inventory = slot.inventory;
        let itemStack = inventory.getItemInSlot(slot.index);
        let isMouseOver = this.isMouseOverSlot(slot, mouseX, mouseY);

        if (!itemStack.isEmpty()) {
            let typeId = itemStack.getType();
            let block = Block.getById(typeId);
            if (block !== null) {
                this.minecraft.itemRenderer.renderItemInGui(
                    "inventory",
                    inventory.name + ":" + slot.index,
                    block,
                    x + 8,
                    y + 8,
                    isMouseOver ? 1.5 : 1
                );
            }
        }

        if (isMouseOver) {
            this.drawRect(stack, x, y, x + 16, y + 16, '#ffffff', 0.5);

            this.hoverSlot = slot;
        }
    }

    onClose() {
        super.onClose();

        this.minecraft.player.inventory.itemInCursor = new ItemStack(0, 0);
        this.minecraft.itemRenderer.destroy("inventory");
    }

    drawTitle(stack) {

    }

    drawInventoryBackground(stack) {

    }

    isMouseOverSlot(slot, mouseX, mouseY) {
        let x = this.x + slot.x;
        let y = this.y + slot.y;
        return mouseX >= x && mouseX <= x + 16 && mouseY >= y && mouseY <= y + 16;
    }

}