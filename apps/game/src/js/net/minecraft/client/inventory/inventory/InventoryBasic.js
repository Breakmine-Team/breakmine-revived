import Inventory from "../Inventory.js";
import ItemStack from "../../item/ItemStack.js";

export default class InventoryBasic extends Inventory {

    constructor(size = 0) {
        super("basic");

        this.items = new Array(size).fill(null).map(() => new ItemStack(0, 0));
    }

    toNetworkState() {
        const serializeItem = item => {
            if (!item || item.isEmpty()) {
                return { typeId: 0, count: 0 };
            }
            return { typeId: item.getType(), count: item.getCount() };
        };

        return {
            size: this.items.length,
            items: this.items.map(serializeItem)
        };
    }

    applyNetworkState(state) {
        if (!state || typeof state !== 'object') {
            return;
        }

        const items = Array.isArray(state.items) ? state.items : [];
        const size = Number(state.size || items.length || 0);
        this.items = new Array(size).fill(null).map((_, index) => {
            const slot = items[index];
            return new ItemStack(slot?.typeId || 0, slot?.count || 0);
        });

        for (const key of Object.keys(state)) {
            if (key !== 'size' && key !== 'items') {
                this[key] = state[key];
            }
        }
    }

    getItemInSlot(index) {
        return this.items[index] !== undefined ? this.items[index] : new ItemStack(0, 0);
    }

    setItem(index, itemStack) {
        if (itemStack === null || itemStack === undefined) {
            this.items[index] = new ItemStack(0, 0);
        } else if (typeof itemStack === 'number') {
            this.items[index] = new ItemStack(itemStack, 1);
        } else if (typeof itemStack === 'string') {
            this.items[index] = new ItemStack(itemStack, 1);
        } else {
            this.items[index] = itemStack.copy();
        }
    }

}