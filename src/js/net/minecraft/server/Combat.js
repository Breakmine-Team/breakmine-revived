import Block from '../client/world/block/Block.js';
import FoodData from '../../../../../packages/vanilla-gameplay/food.mjs';
import { nativeItemStats, attackResult, acceptedDamage, applyAttackKnockback } from '../../../../../packages/vanilla-gameplay/combat.mjs';

const selected = player => player.inventory?.items?.[player.inventory?.selectedSlotIndex ?? 0];
const heldItem = player => { const stack = selected(player); return stack?.count > 0 ? Block.getById(stack.typeId) : null; };
export function trackCombatMovement(player, previous) {
    const dx = player.x - previous.x, dy = player.y - previous.y, dz = player.z - previous.z;
    if (![dx,dy,dz].every(Number.isFinite)) return;
    player.horizontalSpeed = Math.hypot(dx, dz);
    if (player.onGround) player.fallDistance = 0;
    else if (dy < 0) player.fallDistance = (player.fallDistance ?? 0) - dy;
    if (!player.foodData) player.foodData = new FoodData();
    if (player.gamemode === 0 && player.onGround && player.isSprinting) player.foodData.addExhaustion(player.horizontalSpeed * 0.1);
    if (player.gamemode === 0 && previous.onGround && !player.onGround && dy > 0) player.foodData.addExhaustion(player.isSprinting ? 0.2 : 0.05);
}

export function tickCombatPlayer(player) {
    if (!player.foodData) player.foodData = new FoodData();
    if (player.invulnerableTime > 0) player.invulnerableTime--;
    const itemId = selected(player)?.typeId ?? 0;
    if (player.lastAttackItemId !== undefined && player.lastAttackItemId !== itemId) player.attackStrengthTicker = 0;
    player.lastAttackItemId = itemId;
    player.attackStrengthTicker = Math.min(100, (player.attackStrengthTicker ?? 20) + 1);
    const oldHealth = player.health, oldFood = player.foodData.foodLevel, oldSaturation = player.foodData.saturationLevel;
    player.foodData.tick({
        get health() { return player.health; }, set health(value) { player.health = value; },
        creative: player.gamemode === 1, spectator: player.gamemode === 3,
        damageEntity(amount) { player.health = Math.max(0, player.health - amount); }
    });
    if (player.foodData.foodLevel <= 6 && player.gamemode === 0) player.isSprinting = false;
    return oldHealth !== player.health || oldFood !== player.foodData.foodLevel || oldSaturation !== player.foodData.saturationLevel;
}

export function resolvePlayerAttack(player, targetId, players, world) {
    if (!player.username || player.gamemode === 3 || player.health <= 0) return [];
    const item = heldItem(player);
    const charge = Math.min(1, ((player.attackStrengthTicker ?? 20) + 0.5) / (20 / nativeItemStats(item).attackSpeed));
    player.attackStrengthTicker = 0;
    const target = players.get(targetId);
    if (!target || target === player || target.gamemode === 1 || target.gamemode === 3 || target.health <= 0) return [];
    const eye = [player.x, player.y + 1.62, player.z];
    const point = [Math.max(target.x - 0.3, Math.min(target.x + 0.3, eye[0])),
        Math.max(target.y, Math.min(target.y + 1.8, eye[1])), Math.max(target.z - 0.3, Math.min(target.z + 0.3, eye[2]))];
    if (![...eye, ...point].every(Number.isFinite) || Math.hypot(...point.map((v,i) => v - eye[i])) > 3) return [];
    for (let t = 0.05; t < 1; t += 0.05) {
        const block = Block.getById(world.getBlockAt(...eye.map((v,i) => Math.floor(v + (point[i] - v) * t))));
        if (block?.isSolid() && block.getOpacity() >= 1) return [];
    }
    const feet = Block.getById(world.getBlockAt(Math.floor(player.x), Math.floor(player.y), Math.floor(player.z)));
    const result = attackResult(item, charge, { fallDistance: player.fallDistance, onGround: player.onGround,
        sprinting: player.isSprinting, inWater: feet?.isLiquid() && !feet.isLava(), onClimbable: feet?.ladder,
        horizontalSpeed: player.horizontalSpeed ?? 0 });
    const hits = [];
    const damageTarget = (target, amount, knockback, flags) => {
        const damage = acceptedDamage(target, amount);
        if (!damage) return;
        target.health = Math.max(0, target.health - damage);
        const velocity = applyAttackKnockback(target, player, { ...flags, knockback });
        hits.push({ ...flags, type: 'combat:hit', eid: target.eid, attackerId: player.eid, attacker: player.username,
            health: target.health, damage, hurtDamage: amount, velocity });
    };
    damageTarget(target, result.damage, result.knockback, result);
    if (hits.length) {
        const stack = selected(player);
        const durability = Number(item?.durability);
        if (player.gamemode === 0 && stack && (item?.toolType || item?.attackDurabilityDamage > 0) && Number.isFinite(durability) && durability > 0) {
            stack.damage = (stack.damage ?? 0) + (item.attackDurabilityDamage ?? (item.toolType === 'sword' ? 1 : 2));
            if (stack.damage >= durability) {
                stack.typeId = 0;
                stack.count = 0;
                delete stack.damage;
                delete stack.enchantments;
            }
        }
        if (player.gamemode === 0) player.foodData?.addExhaustion(0.1);
        if (result.sprintHit) player.isSprinting = false;
        if (result.sweep) for (const other of players.values()) {
            if (other === player || other === target || other.gamemode !== 0 || other.health <= 0) continue;
            if (Math.abs(other.x - target.x) <= 1.3 && Math.abs(other.z - target.z) <= 1.3 && Math.abs(other.y - target.y) <= 0.25 && Math.hypot(other.x - player.x, other.z - player.z) < 3)
                damageTarget(other, 1, 0.4, { critical: false, sweep: true, sprintHit: false });
        }
    }
    return hits;
}

export function startFoodUse(player, tick) {
    const item = heldItem(player);
    const food = nativeItemStats(item);
    if (!item || !food.nutrition || player.health <= 0 || player.gamemode === 3 ||
        !food.canAlwaysEat && player.foodData?.foodLevel >= 20 && player.gamemode !== 1) return;
    if (player.foodUse) return;
    player.foodUse = { started: tick, itemId: selected(player).typeId, slot: player.inventory.selectedSlotIndex };
}
export function finishFoodUse(player, tick) {
    const use = player.foodUse; player.foodUse = null;
    const stack = selected(player), item = heldItem(player);
    const food = nativeItemStats(item);
    if (!use || tick - use.started < (food.useDurationTicks ?? 32) - 1 || player.health <= 0 || player.gamemode === 3 || !stack || stack.typeId !== use.itemId || player.inventory.selectedSlotIndex !== use.slot) return false;
    if (!food.nutrition || !food.canAlwaysEat && player.foodData.foodLevel >= 20 && player.gamemode !== 1) return false;
    player.foodData.eat(food.nutrition, food.saturation);
    if (player.gamemode !== 1) { if (--stack.count <= 0) stack.typeId = 0; }
    return true;
}
