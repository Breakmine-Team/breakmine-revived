import ItemStack from '../item/ItemStack.js';
import ItemEntity from '../entity/ItemEntity.js';
import ClientDropItemPacket from '../network/packet/play/client/ClientDropItemPacket.js';
import remainderData from '../../../../../../packages/vanilla-gameplay/generated/crafting-remainders.json' with { type: 'json' };

/** Consume one of each ingredient and return containers to the grid or inventory. */
export function consumeCraftingIngredients(inventory, slots, player, resolveItemId) {
    const remainderByInput = new Map();
    for (const [name, remainder] of Object.entries(remainderData.items)) {
        const input = resolveItemId(name);
        const result = resolveItemId(remainder.id);
        if (input !== null && result !== null) remainderByInput.set(input, { id: result, count: remainder.count });
    }
    for (const index of slots) {
        const stack = inventory.getItemInSlot(index);
        if (!stack || stack.isEmpty()) continue;
        const remainder = remainderByInput.get(stack.getType());
        stack.shrink(1);
        if (!remainder) {
            inventory.setItem(index, stack);
            continue;
        }
        if (stack.isEmpty()) {
            inventory.setItem(index, new ItemStack(remainder.id, remainder.count));
            continue;
        }
        inventory.setItem(index, stack);
        if (player.inventory.addItem(remainder.id, remainder.count)) continue;
        const game = player.minecraft;
        if (game.isSingleplayer()) {
            game.world.addEntity(new ItemEntity(game, game.world, remainder.id, player.x, player.y, player.z, remainder.count));
        } else {
            const handler = game.playerController?.getNetworkHandler?.();
            for (let i = 0; i < remainder.count; i++) handler?.sendPacket(new ClientDropItemPacket(remainder.id, player.x, player.y, player.z));
        }
    }
}
