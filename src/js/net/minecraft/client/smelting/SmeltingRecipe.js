import ItemStack from "../item/ItemStack.js";

export default class SmeltingRecipe {
    constructor(inputTypeId, resultTypeId, resultCount = 1, { recipeId = null, type = 'minecraft:smelting', cookingTime = 200, experience = 0 } = {}) {
        this.inputTypeId = inputTypeId;
        this.resultTypeId = resultTypeId;
        this.resultCount = resultCount;
        this.recipeId = recipeId;
        this.type = type;
        this.cookingTime = Math.max(1, Math.floor(cookingTime));
        this.experience = Math.max(0, Number(experience) || 0);
    }

    matches(item) {
        return this.inputTypeId?.matches ? this.inputTypeId.matches(item) : this.inputTypeId === item;
    }

    getResult() {
        return new ItemStack(this.resultTypeId, this.resultCount);
    }
}
