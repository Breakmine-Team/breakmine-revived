import Item from "./Item.js";
import { nativeItemStats } from '../../../../../../../packages/vanilla-gameplay/combat.mjs';

export default class ItemEdible extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Edible Item";
        this.healAmount = 2;
        this.useAnimation = 'eat';
        this.useDurationTicks = 32;
    }

    getDescription() {
        const food = nativeItemStats(this);
        return `${this.description}\n§7${food.nutrition} Food\n§7${Number(food.saturation.toFixed(2))} Saturation`;
    }

    onUse(world, x, y, z, itemstack) {
        const player = world.minecraft.player;
        if (player.foodData.foodLevel < 20 || player.creative || this.canAlwaysEat) {
            if (!world.minecraft.isSingleplayer()) {
                world.minecraft.playerController.getNetworkHandler()?.getNetworkManager()?.sendJson({ type: 'food:finish' });
                return;
            }
            const food = nativeItemStats(this);
            player.foodData.eat(food.nutrition, food.saturation);
            world.minecraft.soundManager.playSound('random.eat', world.minecraft.player.x, world.minecraft.player.y, world.minecraft.player.z, 10, 1.0);
            if (!player.creative) itemstack.shrink(1);
            world.minecraft.itemRenderer.destroy("inventory");
            world.minecraft.itemRenderer.scheduleDirty("hotbar");
            return;
        }
    }
}
