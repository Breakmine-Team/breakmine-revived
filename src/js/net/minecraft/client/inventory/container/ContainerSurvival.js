import Container from "../Container.js";
import Slot from "../Slot.js";
import Block from "../../world/block/Block.js";
import GuiContainerSurvival from "../../gui/screens/container/GuiContainerSurvival.js";
import ItemStack from "../../item/ItemStack.js";
import CraftingRegistry from "../../crafting/CraftingRegistry.js";
import { consumeCraftingIngredients } from "../../crafting/CraftingRemainders.js";
import { equipmentSlots, equipmentStats } from '../Equipment.js';

export default class ContainerSurvival extends Container {

    constructor(player) {
        super();

        this.itemList = [];
        this.minecraft = player.minecraft;
        let playerInventory = player.inventory;

        for (let i = 0; i < 4; i++) this.addSlot(new Slot(playerInventory, 39 - i, 8, 8 + i * 18));

        // Add crafting slots (lazy)
        let offset = 46;
        this.addSlot(new Slot(playerInventory, offset + 0, 100 - 12 + 10, 26 - 8)); // top left, 46
        this.addSlot(new Slot(playerInventory, offset + 1, 100 + 6 + 10, 26 - 8));  // top right, 47
        this.addSlot(new Slot(playerInventory, offset + 2, 100 - 12 + 10, 44 - 8)); // bottom left, 48
        this.addSlot(new Slot(playerInventory, offset + 3, 100 + 6 + 10, 44 - 8));  // bottom right, 49

        // Add crafting result slot
        this.addSlot(new Slot(playerInventory, offset + 4, 144 + 10, 36 - 8)); // 50

        // Add inventory slots
        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.addSlot(new Slot(playerInventory, (y * 9 + x) + 9, 8 + x * 18, 84 + y * 18));
            }
        }

        // Add player hotbar
        for (let x = 0; x < 9; ++x) {
            this.addSlot(new Slot(playerInventory, x, 8 + x * 18, 142));
        }

        this.initItems();
        this.scrollTo(0);
        this.refreshCraftingResult();
    }

    refreshCraftingResult() {
        const playerInventory = this.minecraft?.player?.inventory;
        if (!playerInventory) {
            return;
        }

        // Purely visual preview logic
        const result = CraftingRegistry.getCraftResult([
            playerInventory.getItemInSlot(46),
            playerInventory.getItemInSlot(47),
            playerInventory.getItemInSlot(48),
            playerInventory.getItemInSlot(49)
        ], 2, 2);

        if (result) {
            playerInventory.setItem(50, result);
        } else {
            playerInventory.setItem(50, new ItemStack(0, 0));
        }
    }

    onSlotClick(slot, player, mouseButton = 0) {
        if (slot.inventory === player.inventory && equipmentSlots[slot.index]) {
            const cursor = player.inventory.itemInCursor;
            const equipped = player.inventory.getItemInSlot(slot.index);
            if (!cursor.isEmpty() && equipmentStats(cursor)?.equipmentSlot !== equipmentSlots[slot.index]) return;
            if (!cursor.isEmpty() && cursor.getCount() > 1 && equipped.isEmpty() && mouseButton === 0) {
                player.inventory.setItem(slot.index, cursor.split(1));
                this.dirty = true;
                return;
            }
            if (!cursor.isEmpty() && cursor.getCount() > 1 && !equipped.isEmpty()) return;
        }
        // Check if the clicked slot is the crafting result slot
        if (slot.inventory === player.inventory && slot.index === 50) {
            const resultItem = player.inventory.getItemInSlot(50);
            if (!resultItem.isEmpty()) {
                const cursor = player.inventory.itemInCursor;
                if (cursor.isEmpty() || (cursor.isItemEqual(resultItem) && cursor.getCount() + resultItem.getCount() <= cursor.getMaxStackSize())) {
                    if (cursor.isEmpty()) {
                        player.inventory.itemInCursor = resultItem.copy();
                    } else {
                        cursor.grow(resultItem.getCount());
                    }
                    consumeCraftingIngredients(player.inventory, [46, 47, 48, 49], player, name => CraftingRegistry.resolveItemId(name));
                    player.inventory.setItem(50, new ItemStack(0, 0));
                }
            }
        } else {
            super.onSlotClick(slot, player, mouseButton);
        }

        this.refreshCraftingResult();
        this.dirty = true;
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
        if ([50].includes(slot.index)) return;
        const hotbar = inventoryPlayer.getItemInSlot(hotbarIndex);
        if (equipmentSlots[slot.index] && !hotbar.isEmpty() && (hotbar.getCount() !== 1 || equipmentStats(hotbar)?.equipmentSlot !== equipmentSlots[slot.index])) return;
        super.swapWithHotbar(slot, inventoryPlayer, hotbarIndex);
        this.refreshCraftingResult();
    }

    scrollTo(scrollOffset) {
        let xOffset = (this.itemList.length + 9 - 1) / 9 - 5;
        let yOffset = Math.floor((scrollOffset * xOffset) + 0.5);

        if (yOffset < 0) {
            yOffset = 0;
        }

        for (let y = 0; y < 5; ++y) {
            for (let x = 0; x < 9; ++x) {
                let index = x + (y + yOffset) * 9;

                if (index >= 0 && index < this.itemList.length) {
                    GuiContainerSurvival.inventory.setItem(x + y * 9, this.itemList[index]);
                } else {
                    GuiContainerSurvival.inventory.setItem(x + y * 9, null);
                }
            }
        }
    }

    initItems() {
        // Fill inventory with blocks
        Block.blocks.forEach((block) => {
            // InventoryBasic.setItem expects an ItemStack/number, not ids/strings.
            // Block ids are numeric in this project.
            this.itemList.push(block.getId());
        });


    }
}
