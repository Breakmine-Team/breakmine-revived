export default class ItemStack {

    constructor(typeId = 0, count = 1) {
        this.typeId = typeId === null ? 0 : typeId;
        this.count = count;
    }

    getType() {
        return this.typeId;
    }

    getCount() {
        return this.count;
    }

    setCount(count) {
        this.count = count;
    }

    isEmpty() {
        return this.typeId === 0 || this.count <= 0;
    }

    isStackable() {
        return this.typeId !== 0;
    }

    split(count) {
        if (count >= this.count) {
            let stack = new ItemStack(this.typeId, this.count);
            this.count = 0;
            this.typeId = 0;
            return stack;
        } else {
            let stack = new ItemStack(this.typeId, count);
            this.count -= count;
            return stack;
        }
    }

    grow(count) {
        this.count += count;
    }

    shrink(count) {
        this.count -= count;
        if (this.count <= 0) {
            this.count = 0;
            this.typeId = 0;
        }
    }

    getMaxStackSize() {
        // Default max stack size for most items
        return 64;
    }

    isItemEqual(other) {
        if (other === null || other === undefined) {
            return this.typeId === 0;
        }
        return this.typeId === other.typeId;
    }

    copy() {
        return new ItemStack(this.typeId, this.count);
    }
}
