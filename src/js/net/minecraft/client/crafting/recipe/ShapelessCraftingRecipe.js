import CraftingRecipe from "./CraftingRecipe.js";

export default class ShapelessCraftingRecipe extends CraftingRecipe {
    constructor(resultTypeId, resultCount = 1, ingredients) {
        super(resultTypeId, resultCount);
        this.ingredients = Array.isArray(ingredients) ? ingredients : [];
    }

    matches(gridItems) {
        const required = this.ingredients.filter((ingredient) => ingredient !== 0 && ingredient !== null);
        if (required.length === 0) {
            return false;
        }

        const available = (gridItems || []).filter((item) => this.getItemTypeId(item) !== 0);
        if (available.length !== required.length) {
            return false;
        }

        // Use a small augmenting-path matcher so overlapping tags/alternatives
        // are assigned correctly regardless of ingredient order.
        const assigned = new Array(required.length).fill(-1);
        const match = (itemIndex, visited) => {
            for (let recipeIndex = 0; recipeIndex < required.length; recipeIndex++) {
                if (visited[recipeIndex]) continue;
                const ingredient = required[recipeIndex];
                const item = available[itemIndex];
                const accepts = ingredient?.matches
                    ? ingredient.matches(item)
                    : ingredient === this.getItemTypeId(item);
                if (!accepts) continue;
                visited[recipeIndex] = true;
                if (assigned[recipeIndex] === -1 || match(assigned[recipeIndex], visited)) {
                    assigned[recipeIndex] = itemIndex;
                    return true;
                }
            }
            return false;
        };
        for (let itemIndex = 0; itemIndex < available.length; itemIndex++) {
            if (!match(itemIndex, new Array(required.length).fill(false))) return false;
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
