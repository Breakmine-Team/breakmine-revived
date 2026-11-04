import Block from '../world/block/Block.js';
import gameplay from '../../../../../../packages/vanilla-gameplay/generated/gameplay.json' with { type: 'json' };

export const equipmentSlots = { 36: 'feet', 37: 'legs', 38: 'chest', 39: 'head' };

export function equipmentStats(stack) {
    if (!stack || stack.isEmpty()) return null;
    const item = Block.getById(stack.getType());
    const name = item?.nativeItemId ?? item?.descriptor?.name ?? (item?.name ? `minecraft:${item.name}` : null);
    return name ? gameplay.items[name] ?? null : null;
}
