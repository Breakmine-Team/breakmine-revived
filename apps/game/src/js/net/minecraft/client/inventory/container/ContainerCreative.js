import Container from "../Container.js";
import GuiContainerCreative from "../../gui/screens/container/GuiContainerCreative.js";
import ItemStack from "../../item/ItemStack.js";
import Slot from "../Slot.js";
import Block from "../../world/block/Block.js";
import Minecraft from "../../Minecraft.js";
import InventoryPlayer from "../inventory/InventoryPlayer.js";

export default class ContainerCreative extends Container {

    constructor(player, offset = 0) {
        super();

        this.itemList = [];
        this.currentScrollOffset = 0; // Track current scroll position for refresh

        let playerInventory = player.inventory;

        // Add creative inventory slots - 5 rows (original size)
        for (let y = 0; y < 5; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.addSlot(new Slot(GuiContainerCreative.inventory, y * 9 + x, 9 + x * 18, 18 + y * 18));
            }
        }

        // Add player hotbar
        for (let x = 0; x < 9; ++x) {
            this.addSlot(new Slot(playerInventory, x, 9 + x * 18, 112));
        }

        this.initItems(offset);
        this.scrollTo(0);
        this.updateFilter(1);
    }

    updateFilter(tabIndex) {
        this.itemList = [];
        
        Block.blocks.forEach((block) => {
            if (block.inventoryTab.id === tabIndex) {
                if (block.id !== 99 && block.id !== 43 && block.id !== -1 && block.id !== 59) {
                    this.itemList.push(block.getId());
                }
            }
        });

        // Reset scroll to top when changing tabs
        this.scrollTo(0);
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
        let slotInventory = slot.inventory;
        let typeId = slotInventory.getItemInSlot(slot.index);

        inventoryPlayer.setItem(hotbarIndex, typeId);

        this.dirty = true;
    }

    onSlotClick(slot, player, mouseButton = 0) {
        if (slot.inventory instanceof InventoryPlayer) {
            super.onSlotClick(slot, player, mouseButton);
        } else {
            let inventoryPlayer = player.inventory;
            // The creative palette is a single shared inventory, so the stack in
            // the slot must never be handed out by reference: using the item
            // (placing it, shrinking the count, or a bucket swapping its type)
            // would otherwise mutate the palette entry itself and the block
            // would disappear from the tab.
            let slotItem = slot.inventory.getItemInSlot(slot.index);
            inventoryPlayer.itemInCursor = slotItem.isEmpty() ? new ItemStack(0, 0) : slotItem.copy();
        }
        this.dirty = true;
    }

    scrollTo(scrollOffset) {
        // Track the current scroll offset for refresh operations
        this.currentScrollOffset = scrollOffset;
        
        // Calculate max scrollable rows for 5 visible rows
        const visibleRows = 5;
        const totalRows = Math.ceil(this.itemList.length / 9);
        const maxRows = Math.max(0, totalRows - visibleRows);
        
        let yOffset = Math.floor((scrollOffset * maxRows) + 0.5);

        if (yOffset < 0) {
            yOffset = 0;
        }
        if (yOffset > maxRows) {
            yOffset = maxRows;
        }

        // Fill the 5 visible rows with items starting from yOffset
        for (let y = 0; y < 5; ++y) {
            for (let x = 0; x < 9; ++x) {
                let index = x + (y + yOffset) * 9;

                if (index >= 0 && index < this.itemList.length) {
                    GuiContainerCreative.inventory.setItem(x + y * 9, this.itemList[index]);
                } else {
                    GuiContainerCreative.inventory.setItem(x + y * 9, null);
                }
            }
        }

        this.dirty = true;
    }

    initItems(offset) {
        Block.blocks.forEach((block) => {
            if (block.id !== 99) {
                if (Minecraft.MODE !== 1) {
                    if (block.id !== 43 && block.id !== -1 && block.id !== 59 && block.id > offset) {
                        this.itemList.push(block.getId());
                    }
                } else {
                    if (block.id > offset) {
                        this.itemList.push(block.getId());
                    }
                }
            }
        });
        this.dirty = true;
    }

    /**
     * Refresh the visible inventory items (call this when items are added/removed)
     */
    refreshInventoryDisplay() {
        // Re-populate the itemList from current blocks
        this.itemList = [];
        this.initItems(0);
        // Refresh the current scroll position to show updated items
        this.scrollTo(this.currentScrollOffset || 0);
        this.dirty = true;
    }
}