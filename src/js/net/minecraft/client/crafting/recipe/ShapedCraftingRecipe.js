import CraftingRecipe from "./CraftingRecipe.js";

export default class ShapedCraftingRecipe extends CraftingRecipe {
    constructor(resultTypeId, resultCount = 1, width, height, ingredients) {
        super(resultTypeId, resultCount);
        this.width = width;
        this.height = height;
        this.ingredients = Array.isArray(ingredients) ? ingredients : [];
    }

    matches(gridItems, width, height) {
        const normalized = gridItems || [];
        
        // Recipe must fit in the grid
        if (this.width > width || this.height > height) {
            return false;
        }

        // Vanilla shaped recipes support offsets and horizontal mirroring.
        for (let offsetY = 0; offsetY <= height - this.height; offsetY++) {
            for (let offsetX = 0; offsetX <= width - this.width; offsetX++) {
                if (this.matchesAtPosition(normalized, width, offsetX, offsetY, false) ||
                    this.matchesAtPosition(normalized, width, offsetX, offsetY, true)) {
                    return true;
                }
            }
        }

        return false;
    }

    matchesAtPosition(gridItems, gridWidth, offsetX, offsetY, mirrored = false) {
        for (let recipeY = 0; recipeY < this.height; recipeY++) {
            for (let recipeX = 0; recipeX < this.width; recipeX++) {
                const gridIndex = (recipeY + offsetY) * gridWidth + (recipeX + offsetX);
                const recipeIndex = recipeY * this.width + (mirrored ? this.width - recipeX - 1 : recipeX);
                
                const expected = this.ingredients[recipeIndex];
                const actual = this.getItemTypeId(gridItems[gridIndex]);
                
                if (expected === 0 || expected === null) {
                    if (actual !== 0) {
                        return false;
                    }
                } else if (expected?.matches ? !expected.matches(gridItems[gridIndex]) : expected !== actual) {
                    return false;
                }
            }
        }
        
        // Check that all slots outside the recipe area are empty
        for (let gridY = 0; gridY < gridItems.length / gridWidth; gridY++) {
            for (let gridX = 0; gridX < gridWidth; gridX++) {
                const gridIndex = gridY * gridWidth + gridX;
                
                // Skip if this slot is within the recipe area
                if (gridX >= offsetX && gridX < offsetX + this.width &&
                    gridY >= offsetY && gridY < offsetY + this.height) {
                    continue;
                }
                
                // Slot outside recipe area must be empty
                if (this.getItemTypeId(gridItems[gridIndex]) !== 0) {
                    return false;
                }
            }
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
