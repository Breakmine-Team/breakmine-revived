import Container from "../Container.js";
import GuiContainerCreative from "../../gui/screens/container/GuiContainerCreative.js";
import ItemStack from "../../item/ItemStack.js";
import Slot from "../Slot.js";
import Block from "../../world/block/Block.js";
import Minecraft from "../../Minecraft.js";
import InventoryPlayer from "../inventory/InventoryPlayer.js";
import EnumCreativeInventoryTab from "../../gui/EnumCreativeInventoryTab.js";

export default class ContainerCreative extends Container {

    static bookmarks = new Set();

    constructor(player, offset = 0) {
        super();

        this.itemList = [];
        this.currentScrollOffset = 0; 
        this.bookmarksDirty = false;

        let playerInventory = player.inventory;

        this.paletteSlots = [];
        for (let y = 0; y < 5; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.paletteSlots.push(new Slot(GuiContainerCreative.inventory, y * 9 + x, 9 + x * 18, 18 + y * 18));
            }
        }
        for (let x = 0; x < 9; ++x) {
            this.paletteSlots.push(new Slot(playerInventory, x, 9 + x * 18, 112));
        }

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

        this.scrollTo(0);
    }

    
    updateSearch(query) {
        const needle = (query ?? "").trim().toLowerCase();

        this.itemList = [];

        Block.blocks.forEach((block) => {
            if (!block.id || block.id === 99) return;
            if (block.id === 43 || block.id === -1 || block.id === 59) return;

            if (EnumCreativeInventoryTab.isHidden(block.inventoryTab)) return;

            const name = String(block.getDescription?.() ?? "").toLowerCase();
            if (needle === "" || name.includes(needle)) {
                this.itemList.push(block.getId());
            }
        });

        this.scrollTo(0);
    }

    
    showBookmarks() {
        this.itemList = Array.from(ContainerCreative.bookmarks).filter(id => Block.getById(id) !== null);
        this.scrollTo(0);
    }

    
    toggleBookmark(typeId) {
        if (!typeId) return;

        if (ContainerCreative.bookmarks.has(typeId)) {
            ContainerCreative.bookmarks.delete(typeId);
        } else {
            ContainerCreative.bookmarks.add(typeId);
        }

        this.bookmarksDirty = true;
    }

    
    showSurvivalInventory(enabled) {
        this.slots = enabled ? this.survivalSlots : this.paletteSlots;

        if (enabled) {
            this.itemList = [];
            this.scrollTo(0);
        }

        this.dirty = true;
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
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
            if (mouseButton === 2) {
                this.toggleBookmark(slot.inventory.getItemInSlot(slot.index).getType());
            }

            let inventoryPlayer = player.inventory;
            let slotItem = slot.inventory.getItemInSlot(slot.index);
            inventoryPlayer.itemInCursor = slotItem.isEmpty() ? new ItemStack(0, 0) : slotItem.copy();
        }
        this.dirty = true;
    }

    scrollTo(scrollOffset) {
        this.currentScrollOffset = scrollOffset;
        
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
            if (!block.id || block.id === 99) return;
            if (EnumCreativeInventoryTab.isHidden(block.inventoryTab)) return;

            if (Minecraft.MODE !== 1) {
                if (block.id !== 43 && block.id !== -1 && block.id !== 59 && block.id > offset) {
                    this.itemList.push(block.getId());
                }
            } else if (block.id > offset) {
                this.itemList.push(block.getId());
            }
        });
        this.dirty = true;
    }

    
    refreshInventoryDisplay() {
        this.itemList = [];
        this.initItems(0);
        this.scrollTo(this.currentScrollOffset || 0);
        this.dirty = true;
    }
}