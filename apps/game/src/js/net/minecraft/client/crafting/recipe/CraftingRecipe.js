import ItemStack from "../../item/ItemStack.js";

export default class CraftingRecipe {
    constructor(resultTypeId, resultCount = 1) {
        this.resultTypeId = resultTypeId;
        this.resultCount = resultCount;
    }

    matches() {
        return false;
    }

    getResult() {
        return new ItemStack(this.resultTypeId, this.resultCount);
    }
}
