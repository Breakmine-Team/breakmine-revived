import Entity from './Entity.js';
import { isFluidType } from '../../../../../../packages/vanilla-worldgen/fluid-state.mjs';
import MathHelper from '../../util/MathHelper.js';
import { BlockRegistry } from '../world/block/BlockRegistry.js';
import { applyKnockback } from '../../../../../../packages/vanilla-gameplay/combat.mjs';

function segmentAabbFraction(from, to, box) {
    let low = 0;
    let high = 1;
    for (const axis of ['x', 'y', 'z']) {
        const suffix = axis.toUpperCase();
        const min = box[`min${suffix}`];
        const max = box[`max${suffix}`];
        const delta = to[axis] - from[axis];
        if (Math.abs(delta) < 1e-12) {
            if (from[axis] < min || from[axis] > max) return null;
            continue;
        }
        let enter = (min - from[axis]) / delta;
        let leave = (max - from[axis]) / delta;
        if (enter > leave) [enter, leave] = [leave, enter];
        low = Math.max(low, enter);
        high = Math.min(high, leave);
        if (low > high) return null;
    }
    return low >= 0 && low <= 1 ? low : null;
}

function expandedAabb(box, radius) {
    return {
        minX: box.minX - radius, minY: box.minY - radius, minZ: box.minZ - radius,
        maxX: box.maxX + radius, maxY: box.maxY + radius, maxZ: box.maxZ + radius
    };
}

/** Small server-authoritative-style arrow simulation used by ported skeleton AI. */
export default class MobArrowEntity extends Entity {
    static name = 'MobArrowEntity';

    constructor(minecraft, world, owner, x, y, z, velocity, effect = null, { damage = 2, kind = 'arrow', uncertainty = 0 } = {}) {
        super(minecraft, world, -2);
        this.owner = owner;
        this.effect = effect;
        this.width = 0.12;
        this.height = 0.12;
        this.life = 0;
        this.inGround = false;
        this.inGroundTime = 0;
        this.inGroundBlock = null;
        this.inGroundMotion = null;
        this.dealtDamage = false;
        this.damage = damage;
        this.projectileKind = kind;
        this.setPosition(x, y, z);
        // Projectile#getMovementToShoot in the reference client adds an independent
        // RandomSource.triangle(0, 0.0172275 * uncertainty) to each normalized
        // direction component, then scales the vector by the requested speed.
        const length = Math.hypot(velocity.x, velocity.y, velocity.z) || 1;
        const spread = 0.0172275 * uncertainty;
        const triangle = () => (this.random.nextDouble() - this.random.nextDouble()) * spread;
        this.motionX = (velocity.x / length + triangle()) * length;
        this.motionY = (velocity.y / length + triangle()) * length;
        this.motionZ = (velocity.z / length + triangle()) * length;
        this.rotationYaw = MathHelper.toDegrees(Math.atan2(velocity.x, velocity.z));
        this.rotationPitch = MathHelper.toDegrees(Math.atan2(velocity.y, Math.hypot(velocity.x, velocity.z)));
        this.prevRotationYaw = this.rotationYaw;
        this.prevRotationPitch = this.rotationPitch;
    }

    onEntityUpdate() {
        super.onEntityUpdate();
        if (this.isDead) return;
        if (this.inGround) {
            if (this.inGroundBlock) {
                const { x, y, z, id, data } = this.inGroundBlock;
                const stateChanged = this.world.getBlockAt?.(x, y, z) !== id ||
                    (this.world.getBlockDataAt?.(x, y, z) ?? 0) !== data;
                const canFall = stateChanged && !this.world.getCollisionBoxes?.(this.boundingBox.clone().expand(0.06, 0.06, 0.06)).length;
                if (canFall) {
                    this.inGround = false;
                    this.inGroundBlock = null;
                    this.inGroundTime = 0;
                    this.life = 0;
                    const velocity = this.inGroundMotion ?? { x: 0, y: 0, z: 0 };
                    this.motionX = velocity.x * this.random.nextFloat() * 0.2;
                    this.motionY = velocity.y * this.random.nextFloat() * 0.2;
                    this.motionZ = velocity.z * this.random.nextFloat() * 0.2;
                    this.inGroundMotion = null;
                } else {
                    this.inGroundTime++;
                    if (this.projectileKind === 'trident' && this.inGroundTime > 4) this.dealtDamage = true;
                    this.life = this.inGroundTime;
                    if (this.inGroundTime >= 1200) this.remove();
                    return;
                }
            } else {
                this.inGroundTime++;
                if (this.projectileKind === 'trident' && this.inGroundTime > 4) this.dealtDamage = true;
                this.life = this.inGroundTime;
                if (this.inGroundTime >= 1200) this.remove();
                return;
            }
        }

        const inWater = this.isInWater();
        // AbstractArrow applies water inertia before moving; normal arrows
        // use 0.6 while tridents override it to 0.99. In air both use 0.99
        // after movement. Applying 0.99 universally was making arrows travel
        // much too far through water compared with the reference JAR.
        if (inWater) {
            const inertia = this.projectileKind === 'trident' ? 0.99 : 0.6;
            this.motionX *= inertia;
            this.motionY *= inertia;
            this.motionZ *= inertia;
        }
        const from = { x: this.x, y: this.y, z: this.z };
        const to = { x: this.x + this.motionX, y: this.y + this.motionY, z: this.z + this.motionZ };
        const swept = this.boundingBox.clone().expand(this.motionX, this.motionY, this.motionZ);
        let nearestBlock = null;
        for (const box of this.world.getCollisionBoxes(swept)) {
            // Minecraft clips the projectile centerline against block shapes;
            // only entity pick boxes receive the projectile's pick-radius expansion.
            const fraction = segmentAabbFraction(from, to, box);
            if (fraction !== null && (!nearestBlock || fraction < nearestBlock.fraction)) {
                nearestBlock = { fraction, box };
            }
        }

        let nearestEntity = null;
        if (!this.dealtDamage) {
            for (const entity of this.world.entities ?? []) {
                if (entity === this || entity === this.owner || entity.isDead || entity.creative || entity.spectator ||
                    typeof entity.damageEntity !== 'function') continue;
                // ProjectileUtil#getEntityHitResult inflates the target's pick
                // box by AbstractArrow's 0.3-block pick radius.
                const halfWidth = (entity.width ?? 0.6) * 0.5;
                const targetBox = entity.boundingBox ?? {
                    minX: entity.x - halfWidth, maxX: entity.x + halfWidth,
                    minY: entity.y, maxY: entity.y + (entity.height ?? 1.8),
                    minZ: entity.z - halfWidth, maxZ: entity.z + halfWidth
                };
                const fraction = segmentAabbFraction(from, to, expandedAabb(targetBox, 0.3));
                if (fraction !== null && (!nearestEntity || fraction < nearestEntity.fraction)) {
                    nearestEntity = { fraction, entity };
                }
            }
        }

        if (nearestBlock && (!nearestEntity || nearestBlock.fraction <= nearestEntity.fraction)) {
            const hitX = from.x + (to.x - from.x) * nearestBlock.fraction;
            const hitY = from.y + (to.y - from.y) * nearestBlock.fraction;
            const hitZ = from.z + (to.z - from.z) * nearestBlock.fraction;
            // AbstractArrow backs off slightly from the face after a block hit
            // while retaining the exact state/position that was struck.
            this.setPosition(
                hitX - Math.sign(this.motionX) * 0.05,
                hitY - Math.sign(this.motionY) * 0.05,
                hitZ - Math.sign(this.motionZ) * 0.05
            );
            const blockX = Math.floor(hitX + Math.sign(this.motionX) * 1e-5);
            const blockY = Math.floor(hitY + Math.sign(this.motionY) * 1e-5);
            const blockZ = Math.floor(hitZ + Math.sign(this.motionZ) * 1e-5);
            this.embedInBlock(this.x, this.y, this.z, { x: blockX, y: blockY, z: blockZ });
            return;
        }

        if (nearestEntity) {
            const hit = nearestEntity.entity;
            const hitX = from.x + (to.x - from.x) * nearestEntity.fraction;
            const hitY = from.y + (to.y - from.y) * nearestEntity.fraction;
            const hitZ = from.z + (to.z - from.z) * nearestEntity.fraction;
            this.setPosition(hitX, hitY, hitZ);
                // AbstractArrow's base damage is 2.0. It rounds up the
                // impact-velocity-scaled damage; thrown tridents use fixed 8.
                const impactDamage = this.projectileKind === 'trident'
                    ? this.damage
                    : Math.ceil(Math.hypot(this.motionX, this.motionY, this.motionZ) * this.damage);
                const dealt = hit.damageEntity(impactDamage,
                    this.owner?.entityType?.split(':').pop() ?? 'Skeleton', this.projectileKind, this.owner);
                if (dealt > 0) {
                    // LivingEntity.dealDefaultKnockback applies 0.4 after an
                    // accepted hit. Projectiles use their current movement
                    // vector as the horizontal knockback direction; construct
                    // an equivalent source point for the shared combat helper.
                    applyKnockback(hit, {
                        x: hit.x - this.motionX,
                        y: hit.y - this.motionY,
                        z: hit.z - this.motionZ
                    }, 0.4);
                    if (this.effect) hit.addStatusEffect?.(this.effect, 600, 0);
                }
                if (this.projectileKind === 'trident' && dealt > 0) {
                    // ThrownTrident marks dealtDamage and continues its flight;
                    // it is not discarded like AbstractArrow on an accepted hit.
                    this.dealtDamage = true;
                    return;
                }
                // AbstractArrow discards itself after an accepted entity hit;
                // only block hits remain embedded for the 1200-tick lifetime.
                return this.remove();
        }

        this.setPosition(this.x + this.motionX, this.y + this.motionY, this.z + this.motionZ);
        if (!inWater) {
            this.motionX *= 0.99;
            this.motionY *= 0.99;
            this.motionZ *= 0.99;
        }
        this.motionY -= 0.05;
        this.rotationYaw = MathHelper.toDegrees(Math.atan2(this.motionX, this.motionZ));
        this.rotationPitch = MathHelper.toDegrees(Math.atan2(this.motionY, Math.hypot(this.motionX, this.motionZ)));
    }

    embedInBlock(x, y, z, hitBlock = null) {
        const blockX = hitBlock?.x ?? Math.floor(x);
        const blockY = hitBlock?.y ?? Math.floor(y);
        const blockZ = hitBlock?.z ?? Math.floor(z);
        this.inGround = true;
        this.inGroundTime = 0;
        this.life = 0;
        this.inGroundMotion = { x: this.motionX, y: this.motionY, z: this.motionZ };
        this.motionX = this.motionY = this.motionZ = 0;
        this.inGroundBlock = {
            x: blockX, y: blockY, z: blockZ,
            id: this.world.getBlockAt?.(blockX, blockY, blockZ),
            data: this.world.getBlockDataAt?.(blockX, blockY, blockZ) ?? 0
        };
    }

    isInWater() {
        const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
        const fluid = this.world?.getFluidState?.(x, y, z);
        if (fluid != null) return isFluidType(fluid, 'water');
        const waterId = BlockRegistry.WATER?.getId?.();
        return waterId !== undefined && this.world?.getBlockAt?.(x, y, z) === waterId;
    }

    remove() {
        this.isDead = true;
        this.world.removeEntityById?.(this.id);
    }
}
