import ItemFood from "./ItemFood.js";
import Block from "../Block.js";

export default class ItemChorusFruit extends ItemFood {

    constructor(id) {
        super(id, "chorus_fruit", "Chorus Fruit", 2);
    }

    // Chorus fruit is always edible, even with a full health bar, and teleports
    // the eater somewhere nearby instead of only healing like other foods.
    onUse(world, x, y, z, itemstack) {
        const minecraft = world.minecraft;
        const player = minecraft ? minecraft.player : null;
        if (!player) return;

        player.health = Math.min(20, player.health + this.healAmount);
        if (typeof player.sendHealthUpdate === "function") {
            player.sendHealthUpdate();
        }
        if (typeof player.swingArm === "function") {
            player.swingArm();
        }

        minecraft.soundManager.playSound('random.eat', player.x, player.y, player.z, 10, 1.0);
        itemstack.shrink(1);
        minecraft.itemRenderer.destroy("inventory");
        minecraft.itemRenderer.scheduleDirty("hotbar");

        this.teleportNearby(world, player);
    }

    teleportNearby(world, player) {
        for (let attempt = 0; attempt < 16; attempt++) {
            const targetX = Math.floor(player.x) + Math.floor(Math.random() * 17) - 8;
            const targetZ = Math.floor(player.z) + Math.floor(Math.random() * 17) - 8;

            for (let dy = 8; dy >= -16; dy--) {
                const targetY = Math.floor(player.y) + dy;

                const groundId = world.getBlockAt(targetX, targetY - 1, targetZ);
                const ground = Block.getById(groundId);
                if (!ground || !ground.isSolid()) continue;

                if (world.getBlockAt(targetX, targetY, targetZ) !== 0) continue;
                if (world.getBlockAt(targetX, targetY + 1, targetZ) !== 0) continue;

                player.setPosition(targetX + 0.5, targetY, targetZ + 0.5);
                return true;
            }
        }
        return false;
    }
}
