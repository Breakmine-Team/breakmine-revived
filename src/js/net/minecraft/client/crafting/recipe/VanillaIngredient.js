export default class VanillaIngredient {
    constructor(itemIds, source = null) {
        this.itemIds = [...new Set(itemIds.filter(Number.isInteger))];
        this.source = source;
    }

    matches(item) {
        if (!item || item.isEmpty?.()) return false;
        const id = typeof item === 'number' ? item : item.getType?.() ?? item.typeId;
        return this.itemIds.includes(id);
    }

    resolveFrom(inventory, reserved = new Map()) {
        for (const id of this.itemIds) {
            let available = 0;
            for (let index = 0; index < (inventory.items?.length ?? 0); index++) {
                const item = inventory.getItemInSlot(index);
                if (!item?.isEmpty?.() && item.getType() === id) available += item.getCount();
            }
            if (available > (reserved.get(id) ?? 0)) return id;
        }
        return null;
    }
}
