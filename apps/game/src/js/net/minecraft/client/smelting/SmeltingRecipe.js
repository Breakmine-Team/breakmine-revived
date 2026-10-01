import ItemStack from "../item/ItemStack.js";

export default class SmeltingRecipe {
    constructor(inputTypeId, resultTypeId, resultCount = 1) {
        this.inputTypeId = inputTypeId;
        this.resultTypeId = resultTypeId;
        this.resultCount = resultCount;
    }

    matches(typeId) {
        return this.inputTypeId === typeId;
    }

    getResult() {
        return new ItemStack(this.resultTypeId, this.resultCount);
    }
}
