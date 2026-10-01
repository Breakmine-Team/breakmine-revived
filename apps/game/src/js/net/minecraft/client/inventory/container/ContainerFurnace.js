import Container from "../Container.js";
import Slot from "../Slot.js";
import ItemStack from "../../item/ItemStack.js";
import SmeltingRegistry from "../../smelting/SmeltingRegistry.js";
import Block from "../../world/block/Block.js";

export default class ContainerFurnace extends Container {

    constructor(player, blockPosition = null) {
        super();

        this.minecraft = player.minecraft;
        this.blockPosition = blockPosition;
        this.tileEntity = this.getBlockInventory(player, blockPosition, 3, "furnace");

        const inv = this.tileEntity;
        if (inv.burnTime === undefined) inv.burnTime = 0;
        if (inv.fuelBurnTime === undefined) inv.fuelBurnTime = 0;
        if (inv.cookTime === undefined) inv.cookTime = 0;

        let playerInventory = player.inventory;

        this.addSlot(new Slot(this.tileEntity, 0, 56, 17));
        this.addSlot(new Slot(this.tileEntity, 1, 56, 53));
        this.addSlot(new Slot(this.tileEntity, 2, 116, 35));

        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.addSlot(new Slot(playerInventory, (y * 9 + x) + 9, 8 + x * 18, 84 + y * 18));
            }
        }

        for (let x = 0; x < 9; ++x) {
            this.addSlot(new Slot(playerInventory, x, 8 + x * 18, 142));
        }
    }

    tick() {
        ContainerFurnace.tickFurnace(this.tileEntity, this.blockPosition, this.minecraft?.world);
        this.dirty = true;
    }

    static tickFurnace(inv, blockPosition, world) {
        if (!inv) return;

        // Initialize timer fields if missing (first tick or upgrade)
        if (inv.burnTime === undefined) inv.burnTime = 0;
        if (inv.fuelBurnTime === undefined) inv.fuelBurnTime = 0;
        if (inv.cookTime === undefined) inv.cookTime = 0;

        // Clean up if the furnace block was removed
        if (world && blockPosition && world.getBlockAt(blockPosition.x, blockPosition.y, blockPosition.z) !== 34) {
            const key = `furnace:${blockPosition.x}:${blockPosition.y}:${blockPosition.z}`;
            world.blockInventories?.delete(key);
            return;
        }

        const input = inv.getItemInSlot(0);
        const fuel = inv.getItemInSlot(1);
        const output = inv.getItemInSlot(2);
        const recipe = input.isEmpty() ? null : SmeltingRegistry.getSmeltingResult(input.getType());

        const canOutput = recipe && (output.isEmpty() || (output.getType() === recipe.getType() && output.getCount() + recipe.getCount() <= output.getMaxStackSize()));

        // Reset cook progress if the input item changed (removed or replaced)
        const currentRecipeId = input.isEmpty() ? 0 : recipe ? recipe.getType() : -1;
        if (currentRecipeId !== inv._lastRecipeId) {
            inv.cookTime = 0;
            inv._lastRecipeId = currentRecipeId;
        }

        const hasFuel = !fuel.isEmpty() && SmeltingRegistry.isFuel(fuel.getType());

        // Pause burn when player removes all fuel from the slot;
        // but NOT when the last item was consumed by the furnace (that keeps burning)
        const prevHasFuel = inv._prevHasFuel;
        inv._prevHasFuel = hasFuel;

        if (inv.burnTime > 0) {
            const playerRemovedFuel = prevHasFuel && !hasFuel && !inv._consumedThisTick;
            if (playerRemovedFuel) {
                inv._burnActive = false;
            }
            if (hasFuel || inv._burnActive) {
                inv.burnTime--;
            }
        }

        inv._consumedThisTick = false;

        if (inv.burnTime <= 0) {
            inv._burnActive = false;
        }

        if (inv.burnTime <= 0 && canOutput) {
            if (hasFuel) {
                const fuelValue = SmeltingRegistry.getFuelValue(fuel.getType());
                fuel.shrink(1);
                if (fuel.getCount() <= 0) inv.setItem(1, new ItemStack(0, 0));
                inv.fuelBurnTime = fuelValue;
                inv.burnTime = fuelValue;
                inv._burnActive = true;
                inv._consumedThisTick = true;
            }
        }

        if (inv.burnTime <= 0) {
            inv.cookTime = 0;
        }

        if (inv.burnTime > 0 && canOutput) {
            inv.cookTime++;
            if (inv.cookTime >= 200) {
                inv.cookTime = 0;
                input.shrink(1);
                if (input.getCount() <= 0) inv.setItem(0, new ItemStack(0, 0));
                if (output.isEmpty()) {
                    inv.setItem(2, recipe.copy());
                } else {
                    output.grow(recipe.getCount());
                }
            }
        }

        if (blockPosition && world) {
            const isLit = inv.burnTime > 0 && (hasFuel || inv._burnActive);
            if (isLit !== inv.wasLit) {
                const { x, y, z } = blockPosition;
                const data = world.getBlockDataAt(x, y, z);
                world.setBlockDataAt(x, y, z, isLit ? data | 8 : data & ~8);
                world.onBlockChanged(x, y, z);
            }
            inv.wasLit = isLit;
        }
    }

    swapWithHotbar(slot, inventoryPlayer, hotbarIndex) {
        if ([2].includes(slot.index)) return;
        let slotInventory = slot.inventory;
        let slotItem = slotInventory.getItemInSlot(slot.index).copy();

        inventoryPlayer.setItem(hotbarIndex, slotItem);

        this.dirty = true;
    }

    onSlotClick(slot, player, mouseButton = 0) {
        super.onSlotClick(slot, player, mouseButton);
        this.dirty = true;

        if (slot.inventory === this.tileEntity) {
            const networkController = player?.minecraft?.playerController;
            const networkHandler = networkController?.getNetworkHandler?.();
            const networkManager = networkHandler?.getNetworkManager?.();
            if (networkManager?.sendJson && this.blockPosition) {
                networkManager.sendJson({
                    type: 'blockInventory',
                    username: player.username,
                    key: `furnace:${this.blockPosition.x}:${this.blockPosition.y}:${this.blockPosition.z}`,
                    position: this.blockPosition,
                    inventory: this.tileEntity.toNetworkState()
                });
            }
        }
    }
}
