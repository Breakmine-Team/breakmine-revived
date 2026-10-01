import Container from "../Container.js";
import Slot from "../Slot.js";

export default class ContainerChest extends Container {

    constructor(player, blockPosition = null) {
        super();

        this.minecraft = player.minecraft;
        this.blockPosition = blockPosition;

        // Reuse chest inventory for the same block position so contents persist when the screen closes.
        this.chestInventory = this.getBlockInventory(player, blockPosition, 27, "chest");

        let playerInventory = player.inventory;

        // Add chest slots (27 slots, 9x3 grid)
        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.addSlot(new Slot(this.chestInventory, y * 9 + x, 8 + x * 18, 18 + y * 18));
            }
        }

        // Add inventory slots
        for (let y = 0; y < 3; ++y) {
            for (let x = 0; x < 9; ++x) {
                this.addSlot(new Slot(playerInventory,  (y * 9 + x) + 9, 8 + x * 18, 85 + y * 18));
            }
        }

        // Add player hotbar
        for (let x = 0; x < 9; ++x) {
            this.addSlot(new Slot(playerInventory, x, 8 + x * 18, 143));
        }
    }

    onSlotClick(slot, player, mouseButton = 0) {
        super.onSlotClick(slot, player, mouseButton);
        this.dirty = true;

        if (slot.inventory === this.chestInventory) {
            const networkController = player?.minecraft?.playerController;
            const networkHandler = networkController?.getNetworkHandler?.();
            const networkManager = networkHandler?.getNetworkManager?.();
            if (networkManager?.sendJson && this.blockPosition) {
                networkManager.sendJson({
                    type: 'blockInventory',
                    username: player.username,
                    key: `chest:${this.blockPosition.x}:${this.blockPosition.y}:${this.blockPosition.z}`,
                    position: this.blockPosition,
                    inventory: this.chestInventory.toNetworkState()
                });
            }
        }
    }
}
