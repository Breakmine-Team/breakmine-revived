import Container from '../Container.js';
import Slot from '../Slot.js';
import ItemStack from '../../item/ItemStack.js';
import StonecuttingRegistry from '../../crafting/StonecuttingRegistry.js';

export default class ContainerStonecutter extends Container {
    constructor(player, position) {
        super();
        this.inventory = this.getBlockInventory(player, position, 2, 'stonecutter');
        this.inventory.craftingOutputIndex = 1;
        this.recipes = [];
        this.selected = -1;
        this.inputType = null;
        this.addSlot(new Slot(this.inventory, 0, 20, 33));
        this.addSlot(new Slot(this.inventory, 1, 143, 33));
        for (let y = 0; y < 3; y++) for (let x = 0; x < 9; x++) this.addSlot(new Slot(player.inventory, 9 + y * 9 + x, 8 + x * 18, 84 + y * 18));
        for (let x = 0; x < 9; x++) this.addSlot(new Slot(player.inventory, x, 8 + x * 18, 142));
        this.refresh();
    }

    refresh() {
        const input = this.inventory.getItemInSlot(0);
        const type = input.isEmpty() ? 0 : input.getType();
        if (type !== this.inputType) {
            this.inputType = type;
            this.recipes = StonecuttingRegistry.forInput(input);
            this.selected = -1;
        }
        const recipe = this.recipes[this.selected];
        this.inventory.setItem(1, recipe && !input.isEmpty() ? new ItemStack(recipe.resultTypeId, recipe.count) : new ItemStack(0, 0));
        this.dirty = true;
    }

    select(index) {
        if (index < 0 || index >= this.recipes.length) return;
        this.selected = index;
        this.refresh();
    }

    swapWithHotbar(slot, player, index) {
        if (slot.inventory === this.inventory && slot.index === 1) return;
        super.swapWithHotbar(slot, player, index);
        this.refresh();
    }

    onSlotClick(slot, player, button = 0) {
        if (slot.inventory === this.inventory && slot.index === 1) {
            const result = this.inventory.getItemInSlot(1);
            const cursor = player.inventory.itemInCursor;
            if (!result.isEmpty() && (cursor.isEmpty() || cursor.isItemEqual(result) && cursor.getCount() + result.getCount() <= cursor.getMaxStackSize())) {
                if (cursor.isEmpty()) player.inventory.itemInCursor = result.copy();
                else cursor.grow(result.getCount());
                this.inventory.getItemInSlot(0).shrink(1);
            }
        } else super.onSlotClick(slot, player, button);
        this.refresh();
    }
}
