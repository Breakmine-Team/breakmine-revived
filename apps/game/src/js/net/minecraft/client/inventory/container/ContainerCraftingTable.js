import Container from "../Container.js";
import Slot from "../Slot.js";
import ItemStack from "../../item/ItemStack.js";
import CraftingRegistry from "../../crafting/CraftingRegistry.js";

export default class ContainerCraftingTable extends Container {

    constructor(player, blockPosition = null) {
        super();

        this.minecraft = player.minecraft;
        this.craftingInventory = this.getBlockInventory(player, blockPosition, 10, "crafting_table");

        let playerInventory = player.inventory;

        // Crafting grid slots (0-8)
        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 3; ++x) {
                this.addSlot(new Slot(this.craftingInventory, y * 3 + x, 30 + x * 18, 17 + y * 18));
            }
        }

        // Crafting result slot (9)
        this.addSlot(new Slot(this.craftingInventory, 9, 124, 35));

        // Player Inventory
        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.addSlot(new Slot(playerInventory, (y * 9 + x) + 9, 8 + x * 18, 84 + y * 18));
            }
        }

        // Player Hotbar
        for (let x = 0; x < 9; ++x) {
            this.addSlot(new Slot(playerInventory, x, 8 + x * 18, 142));
        }

        this.refreshCraftingResult();
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
        if ([9].includes(slot.index)) return;
        let slotInventory = slot.inventory;
        let slotItem = slotInventory.getItemInSlot(slot.index).copy();

        inventoryPlayer.setItem(hotbarIndex, slotItem);

        this.dirty = true;
    }

    refreshCraftingResult() {
        // Purely visual preview logic
        const result = CraftingRegistry.getCraftResult(
            Array.from({ length: 9 }, (_, index) => this.craftingInventory.getItemInSlot(index)),
            3,
            3
        );

        if (result) {
            this.craftingInventory.setItem(9, result);
        } else {
            this.craftingInventory.setItem(9, new ItemStack(0, 0));
        }
    }

    onSlotClick(slot, player, mouseButton = 0) {
        // Check if the clicked slot is the crafting table result slot
        if (slot.inventory === this.craftingInventory && slot.index === 9) {
            const resultItem = this.craftingInventory.getItemInSlot(9);
            if (resultItem && !resultItem.isEmpty()) {
                const cursor = player.inventory.itemInCursor;
                if (cursor.isEmpty() || (cursor.isItemEqual(resultItem) && cursor.getCount() + resultItem.getCount() <= cursor.getMaxStackSize())) {
                    if (cursor.isEmpty()) {
                        player.inventory.itemInCursor = resultItem.copy();
                    } else {
                        cursor.grow(resultItem.getCount());
                    }
                    // Consume exactly 1 item from each grid slot upon successful click
                    for (let i = 0; i < 9; i++) {
                        const item = this.craftingInventory.getItemInSlot(i);
                        if (item && !item.isEmpty()) {
                            item.shrink(1);
                        }
                    }
                    this.craftingInventory.setItem(9, new ItemStack(0, 0));
                }
            }
        } else {
            super.onSlotClick(slot, player, mouseButton);
        }

        this.refreshCraftingResult();
        this.dirty = true;
    }
}