import Block from '../world/block/Block.js';

export default class ItemStack {

    constructor(typeId = 0, count = 1, damage = 0) {
        this.typeId = typeId === null ? 0 : typeId;
        this.count = count;
        this.damage = Math.max(0, Math.floor(Number(damage) || 0));
        this.enchantments = Object.create(null);
    }

    getType() {
        return this.typeId;
    }

    getCount() {
        return this.count;
    }

    getEnchantmentLevel(id) {
        const key = String(id ?? '').replace(/^minecraft:/, '');
        const enchantments = this.enchantments;
        const value = enchantments instanceof Map
            ? enchantments.get(id) ?? enchantments.get(key) ?? enchantments.get(`minecraft:${key}`)
            : enchantments?.[id] ?? enchantments?.[key] ?? enchantments?.[`minecraft:${key}`];
        return Number.isFinite(Number(value)) ? Math.max(0, Math.floor(Number(value))) : 0;
    }

    setEnchantmentLevel(id, level) {
        const key = String(id ?? '').replace(/^minecraft:/, '');
        const value = Math.max(0, Math.floor(Number(level) || 0));
        if (!key) return;
        if (value === 0) delete this.enchantments[key];
        else this.enchantments[key] = value;
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
        const amount = Math.min(this.count, Math.max(0, Math.floor(Number(count) || 0)));
        if (this.isEmpty() || amount === 0) return new ItemStack(0, 0);
        const stack = this.copy();
        stack.count = amount;
        this.shrink(amount);
        return stack;
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

    damageItem(amount = 1) {
        const item = Block.getById(this.typeId);
        const maxDamage = Number(item?.durability);
        if (!Number.isFinite(maxDamage) || maxDamage <= 0 || this.isEmpty()) return false;

        this.damage = Math.min(maxDamage, this.damage + Math.max(0, Math.floor(Number(amount) || 0)));
        if (this.damage < maxDamage) return false;

        this.typeId = 0;
        this.count = 0;
        this.damage = 0;
        this.enchantments = Object.create(null);
        return true;
    }

    getMaxStackSize() {
        const item = Block.getById(this.typeId);
        const limit = item?.getMaxStackSize?.();
        return Number.isInteger(limit) && limit > 0 ? limit : 64;
    }

    isItemEqual(other) {
        if (other === null || other === undefined) {
            return this.typeId === 0;
        }
        return this.typeId === other.typeId && this.damage === (other.damage ?? 0) && JSON.stringify(this.enchantments ?? {}) ===
            JSON.stringify(other.enchantments ?? {});
    }

    copy() {
        const stack = new ItemStack(this.typeId, this.count, this.damage);
        const entries = this.enchantments instanceof Map
            ? [...this.enchantments.entries()]
            : Object.entries(this.enchantments ?? {});
        stack.enchantments = Object.assign(Object.create(null), Object.fromEntries(entries));
        return stack;
    }
}
