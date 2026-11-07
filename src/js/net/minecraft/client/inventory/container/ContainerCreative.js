import Container from "../Container.js";
import GuiContainerCreative from "../../gui/screens/container/GuiContainerCreative.js";
import ItemStack from "../../item/ItemStack.js";
import Slot from "../Slot.js";
import Block from "../../world/block/Block.js";
import Minecraft from "../../Minecraft.js";
import InventoryPlayer from "../inventory/InventoryPlayer.js";

export default class ContainerCreative extends Container {

    // Block ids the player saved with a middle click; the creative screen keeps
    // them in local storage so they survive a reload.
    static bookmarks = new Set();

    constructor(player, offset = 0) {
        super();

        this.itemList = [];
        this.currentScrollOffset = 0; // Track current scroll position for refresh
        this.bookmarksDirty = false;

        let playerInventory = player.inventory;

        // Creative palette - 5 rows plus the hotbar, laid out the way
        // creative.png draws them.
        this.paletteSlots = [];
        for (let y = 0; y < 5; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.paletteSlots.push(new Slot(GuiContainerCreative.inventory, y * 9 + x, 9 + x * 18, 18 + y * 18));
            }
        }
        for (let x = 0; x < 9; ++x) {
            this.paletteSlots.push(new Slot(playerInventory, x, 9 + x * 18, 112));
        }

        // The Survival Inventory tab points these slots straight at the
        // player's inventory on the creative_inventory.png panel: three storage
        // rows and a hotbar on the same row as the palette hotbar.
        this.survivalSlots = [];
        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.survivalSlots.push(new Slot(playerInventory, 9 + y * 9 + x, 9 + x * 18, 54 + y * 18));
            }
        }
        for (let x = 0; x < 9; ++x) {
            this.survivalSlots.push(new Slot(playerInventory, x, 9 + x * 18, 112));
        }

        this.slots = this.paletteSlots;

        this.initItems(offset);
        this.scrollTo(0);
        this.updateFilter(1);
    }

    updateFilter(tabIndex) {
        this.itemList = [];
        
        Block.blocks.forEach((block) => {
            if (block.inventoryTab && block.inventoryTab.id === tabIndex) {
                if (block.id !== 99 && block.id !== 43 && block.id !== -1 && block.id !== 59) {
                    this.itemList.push(block.getId());
                }
            }
        });

        // Reset scroll to top when changing tabs
        this.scrollTo(0);
    }

    /**
     * Fill the palette rows with every block whose name matches the query. An
     * empty query matches everything, which is what the search page opens on.
     */
    updateSearch(query) {
        const needle = (query ?? "").trim().toLowerCase();

        this.itemList = [];

        Block.blocks.forEach((block) => {
            if (!block.id || block.id === 99) return;
            if (block.id === 43 || block.id === -1 || block.id === 59) return;

            const name = String(block.getDescription?.() ?? "").toLowerCase();
            if (needle === "" || name.includes(needle)) {
                this.itemList.push(block.getId());
            }
        });

        this.scrollTo(0);
    }

    /**
     * Fill the palette rows with the bookmarked blocks, in the order they were
     * saved. Ids that no longer exist are left out.
     */
    showBookmarks() {
        this.itemList = Array.from(ContainerCreative.bookmarks).filter(id => Block.getById(id) !== null);
        this.scrollTo(0);
    }

    /**
     * Add or remove a block from the bookmarks.
     */
    toggleBookmark(typeId) {
        if (!typeId) return;

        if (ContainerCreative.bookmarks.has(typeId)) {
            ContainerCreative.bookmarks.delete(typeId);
        } else {
            ContainerCreative.bookmarks.add(typeId);
        }

        this.bookmarksDirty = true;
    }

    /**
     * Show the player's own inventory instead of the creative palette (or go
     * back to the palette). Palette slots hand out copies, survival slots are
     * the real inventory, so only the slot list is swapped here.
     */
    showSurvivalInventory(enabled) {
        this.slots = enabled ? this.survivalSlots : this.paletteSlots;

        if (enabled) {
            // Nothing to filter on the survival page, and clearing the list
            // keeps the palette's scroll math at zero while it is hidden.
            this.itemList = [];
            this.scrollTo(0);
        }

        this.dirty = true;
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
        // Survival slots hold real items, so they move like any other inventory
        // slot; only the palette hands out a copy of what it shows.
        if (slot.inventory instanceof InventoryPlayer) {
            super.swapWithHotbar(slot, inventoryPlayer, hotbarIndex);
            return;
        }

        let slotInventory = slot.inventory;
        let typeId = slotInventory.getItemInSlot(slot.index);

        inventoryPlayer.setItem(hotbarIndex, typeId);

        this.dirty = true;
    }

    onSlotClick(slot, player, mouseButton = 0) {
        if (slot.inventory instanceof InventoryPlayer) {
            super.onSlotClick(slot, player, mouseButton);
        } else {
            // Middle click saves what the palette slot shows, so the bookmarks
            // page can be filled without leaving the palette.
            if (mouseButton === 2) {
                this.toggleBookmark(slot.inventory.getItemInSlot(slot.index).getType());
            }

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
            if (block.id && block.id !== 99) {
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