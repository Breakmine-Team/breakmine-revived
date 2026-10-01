import CraftingRecipe from "./CraftingRecipe.js";

export default class ShapelessCraftingRecipe extends CraftingRecipe {
    constructor(resultTypeId, resultCount = 1, ingredients) {
        super(resultTypeId, resultCount);
        this.ingredients = Array.isArray(ingredients) ? ingredients : [];
    }

    matches(gridItems) {
        const required = this.ingredients.filter((id) => id !== 0);
        if (required.length === 0) {
            return false;
        }

        const available = (gridItems || []).map((item) => this.getItemTypeId(item)).filter((id) => id !== 0);
        if (available.length !== required.length) {
            return false;
        }

        const remaining = [...required];
        for (const id of available) {
            const index = remaining.indexOf(id);
            if (index === -1) {
                return false;
            }
            remaining.splice(index, 1);
        }

        return true;
    }

    getItemTypeId(item) {
        if (!item) {
            return 0;
        }
        if (typeof item === 'number') {
            return item;
        }
        if (typeof item === 'object') {
            if (typeof item.isEmpty === 'function' && item.isEmpty()) {
                return 0;
            }
            if (typeof item.getType === 'function') {
                return item.getType();
            }
            if (item.typeId !== undefined) {
                return item.typeId;
            }
        }
        return 0;
    }
}
