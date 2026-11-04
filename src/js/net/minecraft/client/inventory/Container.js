import ItemStack from "../item/ItemStack.js";
import InventoryBasic from "./inventory/InventoryBasic.js";

export default class Container {

    constructor() {
        this.slots = [];
        this.dirty = true;
    }

    addSlot(slot) {
        this.slots.push(slot);
    }

    getBlockInventory(player, position, size, prefix = "block") {
        const world = player?.minecraft?.world;
        if (!world || !position || position.x === undefined || position.y === undefined || position.z === undefined) {
            return new InventoryBasic(size);
        }

        if (!world.blockInventories) {
            world.blockInventories = new Map();
        }

        const key = `${prefix}:${position.x}:${position.y}:${position.z}`;
        if (!world.blockInventories.has(key)) {
            world.blockInventories.set(key, new InventoryBasic(size));
        }

        return world.blockInventories.get(key);
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
        let slotInventory = slot.inventory;

        let slotItem = slotInventory.getItemInSlot(slot.index).copy();
        let hotbarItem = inventoryPlayer.getItemInSlot(hotbarIndex).copy();

        slotInventory.setItem(slot.index, hotbarItem);
        inventoryPlayer.setItem(hotbarIndex, slotItem);

        this.dirty = true;
    }

    onSlotClick(slot, player, mouseButton = 0) {
        let inventoryPlayer = player.inventory;
        let slotItem = slot.inventory.getItemInSlot(slot.index);
        let cursorItem = inventoryPlayer.itemInCursor;

        if (mouseButton === 1) {
            if (!player.creative) return;
            if (!slotItem.isEmpty() && cursorItem.isEmpty()) {
                let fullStack = slotItem.copy();
                fullStack.setCount(fullStack.getMaxStackSize());
                inventoryPlayer.itemInCursor = fullStack;
            }
        } else if (mouseButton === 2) {
            if (cursorItem.isEmpty()) {
                if (!slotItem.isEmpty()) {
                    let pickedItem = slotItem.split(1);
                    slot.inventory.setItem(slot.index, slotItem);
                    inventoryPlayer.itemInCursor = pickedItem;
                }
            } else if (slotItem.isEmpty()) {
                let oneItem = cursorItem.copy();
                oneItem.setCount(1);
                cursorItem.shrink(1);
                inventoryPlayer.itemInCursor = cursorItem.isEmpty() ? new ItemStack(0, 0) : cursorItem;
                slot.inventory.setItem(slot.index, oneItem);
            } else if (cursorItem.isItemEqual(slotItem)) {
                let canAdd = slotItem.getMaxStackSize() - slotItem.getCount();
                if (canAdd > 0) {
                    let toAdd = Math.min(1, Math.min(canAdd, cursorItem.getCount()));
                    slotItem.grow(toAdd);
                    cursorItem.shrink(toAdd);
                    slot.inventory.setItem(slot.index, slotItem);
                    inventoryPlayer.itemInCursor = cursorItem.isEmpty() ? new ItemStack(0, 0) : cursorItem;
                }
            } else {
                let slotCopy = slotItem.copy();
                let cursorCopy = cursorItem.copy();
                slot.inventory.setItem(slot.index, cursorCopy);
                inventoryPlayer.itemInCursor = slotCopy;
            }
        } else {
            if (cursorItem.isEmpty()) {
                if (!slotItem.isEmpty()) {
                    let pickedItem = slotItem.copy();
                    slot.inventory.setItem(slot.index, new ItemStack(0, 0));
                    inventoryPlayer.itemInCursor = pickedItem;
                }
            } else if (slotItem.isEmpty()) {
                slot.inventory.setItem(slot.index, cursorItem);
                inventoryPlayer.itemInCursor = new ItemStack(0, 0);
            } else if (cursorItem.isItemEqual(slotItem)) {
                let canAdd = slotItem.getMaxStackSize() - slotItem.getCount();
                if (canAdd > 0) {
                    let toAdd = Math.min(canAdd, cursorItem.getCount());
                    slotItem.grow(toAdd);
                    cursorItem.shrink(toAdd);
                    slot.inventory.setItem(slot.index, slotItem);
                    inventoryPlayer.itemInCursor = cursorItem;
                } else {
                    slot.inventory.setItem(slot.index, cursorItem);
                    inventoryPlayer.itemInCursor = slotItem;
                }
            } else {
                slot.inventory.setItem(slot.index, cursorItem);
                inventoryPlayer.itemInCursor = slotItem;
            }
        }
        this.dirty = true;
    }

}