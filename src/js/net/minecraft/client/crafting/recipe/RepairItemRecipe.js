import CraftingRecipe from './CraftingRecipe.js';
import ItemStack from '../../item/ItemStack.js';
import Block from '../../world/block/Block.js';

// RepairItemRecipe from the reference JAR: combine remaining durability and add 5%.
export default class RepairItemRecipe extends CraftingRecipe {
    constructor() { super(0); }

    items(grid) {
        return (grid ?? []).filter(item => item && typeof item.isEmpty === 'function' && !item.isEmpty());
    }

    matches(grid) {
        const items = this.items(grid);
        if (items.length !== 2 || items.some(item => item.getCount() !== 1)) return false;
        return items[0].getType() === items[1].getType() && Number(Block.getById(items[0].getType())?.durability) > 0;
    }

    getResult(grid) {
        if (!this.matches(grid)) return null;
        const [first, second] = this.items(grid);
        const maximum = Number(Block.getById(first.getType()).durability);
        const remaining = maximum - first.damage + maximum - second.damage + Math.floor(maximum * .05);
        const result = new ItemStack(first.getType(), 1, Math.max(0, maximum - remaining));
        for (const curse of ['binding_curse', 'vanishing_curse']) {
            const level = Math.max(first.getEnchantmentLevel(curse), second.getEnchantmentLevel(curse));
            if (level) result.setEnchantmentLevel(curse, level);
        }
        return result;
    }
}
