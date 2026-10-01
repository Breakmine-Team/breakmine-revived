import Inventory from "../Inventory.js";
import ItemStack from "../../item/ItemStack.js";

export default class InventoryPlayer extends Inventory {

    constructor() {
        super("player");

        this.selectedSlotIndex = 0;
        this.itemInCursor = new ItemStack(0, 0);
        this.items = new Array(36).fill(null).map(() => new ItemStack(0, 0));
        this.itemRenderer = null;
    }

    setItemRenderer(itemRenderer) {
        this.itemRenderer = itemRenderer;
    }

    setInventoryChangeListener(listener) {
        this.onInventoryChanged = listener;
    }

    notifyInventoryChanged() {
        if (this.onInventoryChanged) {
            this.onInventoryChanged();
        }
    }

    toNetworkState() {
        const serializeItem = item => {
            if (!item || item.isEmpty()) {
                return { typeId: 0, count: 0 };
            }
            return { typeId: item.getType(), count: item.getCount() };
        };

        return {
            selectedSlotIndex: this.selectedSlotIndex,
            itemInCursor: serializeItem(this.itemInCursor),
            items: this.items.map(serializeItem)
        };
    }

    applyNetworkState(state) {
        if (!state || typeof state !== 'object') {
            return;
        }

        this.selectedSlotIndex = Number(state.selectedSlotIndex || 0);
        this.itemInCursor = new ItemStack(
            state.itemInCursor?.typeId || 0,
            state.itemInCursor?.count || 0
        );

        const items = Array.isArray(state.items) ? state.items : [];
        this.items = new Array(36).fill(null).map((_, index) => {
            const slot = items[index];
            return new ItemStack(slot?.typeId || 0, slot?.count || 0);
        });
        this.notifyInventoryChanged();
    }

    setItemInSelectedSlot(itemStack) {
        if (typeof itemStack === 'number') {
            this.items[this.selectedSlotIndex] = new ItemStack(itemStack, 1);
        } else if (itemStack === null || itemStack === undefined) {
            this.items[this.selectedSlotIndex] = new ItemStack(0, 0);
        } else {
            this.items[this.selectedSlotIndex] = itemStack.copy();
        }
        this.notifyInventoryChanged();
    }

    getItemInSelectedSlot() {
        return this.getItemInSlot(this.selectedSlotIndex);
    }

    shiftSelectedSlot(offset) {
        if (this.selectedSlotIndex + offset < 0) {
            this.selectedSlotIndex = 9 + (this.selectedSlotIndex + offset);
        } else {
            this.selectedSlotIndex = (this.selectedSlotIndex + offset) % 9;
        }
        this.notifyInventoryChanged();
    }

    getItemInSlot(slot) {
        return this.items.hasOwnProperty(slot) ? this.items[slot] : new ItemStack(0, 0);
    }

    addItem(typeId, count = 1) {
        let itemStack = new ItemStack(typeId, count);
        let changed = false;
        
        // First try to stack with existing items
        for (let i = 0; i < 36; i++) {
            if (this.items[i] && !this.items[i].isEmpty() && this.items[i].isItemEqual(itemStack)) {
                let canAdd = itemStack.getMaxStackSize() - this.items[i].getCount();
                if (canAdd > 0) {
                    let toAdd = Math.min(canAdd, itemStack.getCount());
                    this.items[i].grow(toAdd);
                    itemStack.shrink(toAdd);
                    changed = true;
                    
                    if (this.itemRenderer) {
                        this.itemRenderer.rebuildAllItems();
                        this.itemRenderer.scheduleDirty("hotbar");
                    }
                    
                    if (itemStack.isEmpty()) {
                        if (changed) {
                            this.notifyInventoryChanged();
                        }
                        return true;
                    }
                }
            }
        }
        
        // Then try to find empty slots
        for (let i = 0; i < 36; i++) {
            if (!this.items[i] || this.items[i].isEmpty()) {
                this.items[i] = itemStack;
                changed = true;
                if (this.itemRenderer) {
                    this.itemRenderer.rebuildAllItems();
                    this.itemRenderer.scheduleDirty("hotbar");
                }
                if (changed) {
                    this.notifyInventoryChanged();
                }
                return true;
            }
        }
        
        if (changed) {
            this.notifyInventoryChanged();
        }
        return false;
    }

    removeItem(typeId, count = 1, i = null) {
        let changed = false;
        let remaining = count;
        if (this.items[i] && !this.items[i].isEmpty() && this.items[i].getType() === typeId) {
            let inStack = this.items[i].getCount();
            let toRemove = Math.min(inStack, remaining);
            this.items[i].shrink(toRemove);
            remaining -= toRemove;
            changed = true;
            
            if (this.itemRenderer) {
                this.itemRenderer.rebuildAllItems();
                this.itemRenderer.scheduleDirty("hotbar");
            }
            
            if (remaining <= 0) {
                if (changed) {
                    this.notifyInventoryChanged();
                }
            }
            return true;
        }
        if (changed) {
            this.notifyInventoryChanged();
        }
        return remaining < count;
    }

    setItem(index, itemStack) {
        if (itemStack === null || itemStack === undefined) {
            this.items[index] = new ItemStack(0, 0);
        } else if (typeof itemStack === 'number') {
            this.items[index] = new ItemStack(itemStack, 1);
        } else {
            this.items[index] = itemStack.copy();
        }
        this.notifyInventoryChanged();
    }
}