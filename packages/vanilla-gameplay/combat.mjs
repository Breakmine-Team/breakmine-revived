import reference from './generated/gameplay.json' with { type: 'json' };

export function nativeItemStats(item) {
    const material = { wood: 'wooden', gold: 'golden' }[item?.material] ?? item?.material;
    const name = item?.toolType && material ? `${material}_${item.toolType}` : item?.isItem?.() ? item.getTextureForFace?.()?.split('/').pop()?.replace(/\.png$/, '') : null;
    return reference.items[item?.nativeItemId ?? `minecraft:${name}`] ?? { attackDamage: item?.attackDamage ?? 1, attackSpeed: item?.attackSpeed ?? 4, nutrition: item?.nutrition ?? 0, saturation: item?.saturation ?? 0 };
}

export function attackResult(item, strength, attacker = {}) {
    strength = Math.max(0, Math.min(1, strength));
    const charged = strength > 0.9;
    const sprintHit = charged && !!attacker.sprinting;
    const critical = charged && (attacker.fallDistance ?? 0) > 0 && !attacker.onGround &&
        !attacker.inWater && !attacker.onClimbable && !attacker.blind && !attacker.passenger && !attacker.sprinting;
    const sweep = charged && !critical && !sprintHit && !!attacker.onGround && item?.toolType === 'sword' &&
        (attacker.horizontalSpeed ?? 0) < 0.25;
    const damage = nativeItemStats(item).attackDamage * (0.2 + strength * strength * 0.8) * (critical ? 1.5 : 1);
    return { damage, critical, sweep, sprintHit, strength, knockback: 0.4, extraKnockback: sprintHit ? 0.5 : 0 };
}

export function acceptedDamage(target, amount, { bypassInvulnerability = false } = {}) {
    target.lastDamageWasFresh = false;
    if (!Number.isFinite(amount) || amount <= 0 || target.isDead || target.health <= 0) return 0;
    // Damage types tagged minecraft:bypasses_invulnerability (including
    // minecraft:out_of_world in the reference JAR) ignore the hurt cooldown.
    if (bypassInvulnerability) { target.lastDamageWasFresh = true; return amount; }
    if ((target.invulnerableTime ?? 0) > 10) {
        if (amount <= (target.lastHurtDamage ?? 0)) return 0;
        const difference = amount - target.lastHurtDamage;
        target.lastHurtDamage = amount;
        return difference;
    }
    target.lastHurtDamage = amount;
    target.invulnerableTime = 20;
    target.lastDamageWasFresh = true;
    return amount;
}

/** the reference client CombatRules#getDamageAfterAbsorb, without armor enchantments. */
export function damageAfterArmor(amount, armor, toughness = 0) {
    if (!Number.isFinite(amount) || amount <= 0) return 0;
    const value = Math.max(0, Number.isFinite(armor) ? armor : 0);
    const toughnessValue = Math.max(0, Number.isFinite(toughness) ? toughness : 0);
    const effectiveArmor = Math.max(value * 0.2, value - amount / (2 + toughnessValue / 4));
    const reduction = Math.max(0, Math.min(20, effectiveArmor)) / 25;
    return amount * (1 - reduction);
}

export function applyKnockback(target, source, strength = 0.4, { force = false } = {}) {
    if (!force && target.lastDamageWasFresh === false)
        return { x: target.motionX ?? 0, y: target.motionY ?? 0, z: target.motionZ ?? 0 };
    strength *= 1 - Math.max(0, Math.min(1, target.knockbackResistance ?? 0));
    if (!(strength > 0)) return { x: target.motionX ?? 0, y: target.motionY ?? 0, z: target.motionZ ?? 0 };
    const dx = target.x - source.x, dz = target.z - source.z;
    const distance = Math.hypot(dx, dz);
    const yaw = (source.rotationYaw ?? source.yaw ?? 0) * Math.PI / 180;
    const x = distance > 1e-5 ? dx / distance : -Math.sin(yaw);
    const z = distance > 1e-5 ? dz / distance : Math.cos(yaw);
    const sign = target.horizontalMotionSign ?? 1;
    target.motionX = (target.motionX ?? 0) / 2 + sign * x * strength;
    target.motionZ = (target.motionZ ?? 0) / 2 + sign * z * strength;
    if (target.onGround) target.motionY = Math.min(0.4, (target.motionY ?? 0) / 2 + strength);
    return { x: target.motionX, y: target.motionY ?? 0, z: target.motionZ };
}

export function applyAttackKnockback(target, source, result) {
    // hurtServer supplies radial hurt knockback only on a fresh hurt interval.
    if (target.lastDamageWasFresh !== false) applyKnockback(target, source, result.knockback);
    if (result.extraKnockback > 0) {
        // Player.causeExtraKnockback uses facing, not target displacement.
        const yaw = (source.rotationYaw ?? source.yaw ?? 0) * Math.PI / 180;
        applyKnockback(target, { x: target.x + Math.sin(yaw), z: target.z - Math.cos(yaw) }, result.extraKnockback, { force: true });
        source.motionX = (source.motionX ?? 0) * .6;
        source.motionZ = (source.motionZ ?? 0) * .6;
    }
    return { x: target.motionX ?? 0, y: target.motionY ?? 0, z: target.motionZ ?? 0 };
}

export function combatTooltip(item) {
    if (!item?.isTool) return '';
    const stats = nativeItemStats(item);
    return `\n\n§7When in Main Hand:\n§2 ${Number(stats.attackDamage.toFixed(2))} Attack Damage\n§2 ${Number(stats.attackSpeed.toFixed(2))} Attack Speed`;
}
