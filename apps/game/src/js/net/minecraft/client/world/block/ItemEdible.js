import Item from "./Item.js";

export default class ItemEdible extends Item {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Edible Item";
        this.healAmount = 2;
    }

    getDescription() {
        let healSymbol = '\u00c8'.repeat(Math.floor(this.healAmount / 2)) + '\u00cb'.repeat(Math.ceil(this.healAmount % 2));
        return this.description + `\n§7${healSymbol} ${this.healAmount} HP`;
    }

    onUse(world, x, y, z, itemstack) {
        if (world.minecraft.player.health < 20) {
            world.minecraft.player.health = Math.min(20, world.minecraft.player.health + this.healAmount);
            world.minecraft.player.sendHealthUpdate();
            world.minecraft.player.swingArm();
            world.minecraft.soundManager.playSound('random.eat', world.minecraft.player.x, world.minecraft.player.y, world.minecraft.player.z, 10, 1.0);
            itemstack.shrink(1);
            world.minecraft.itemRenderer.destroy("inventory");
            world.minecraft.itemRenderer.scheduleDirty("hotbar");
            return;
        }
    }
}
