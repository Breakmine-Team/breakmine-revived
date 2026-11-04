import Entity from './Entity.js';

export default class ExperienceOrbEntity extends Entity {
    static name = 'ExperienceOrbEntity';

    constructor(minecraft, world, x, y, z, value = 1) {
        super(minecraft, world, -2);
        this.width = 0.25;
        this.height = 0.25;
        this.value = Math.max(1, Math.floor(value));
        this.age = 0;
        this.setPosition(x, y, z);
    }

    onEntityUpdate() {
        super.onEntityUpdate();
        if (this.isDead) return;
        if (++this.age >= 6000) return this.remove();

        const player = this.minecraft?.player;
        if (player && !player.isDead) {
            const dx = player.x - this.x;
            const dy = player.y + (player.height ?? 1.8) * 0.5 - this.y;
            const dz = player.z - this.z;
            const distanceSq = dx * dx + dy * dy + dz * dz;
            if (distanceSq < 64 && distanceSq > 1e-8) {
                const distance = Math.sqrt(distanceSq);
                const pull = 0.1 * (1 - distance / 8) ** 2;
                this.motionX += dx / distance * pull;
                this.motionY += dy / distance * pull;
                this.motionZ += dz / distance * pull;
            }
            if (distanceSq < 1 && (player.xpPickupCooldown ?? 0) <= 0) {
                player.addExperiencePoints?.(this.value);
                player.xpPickupCooldown = 2;
                this.remove();
                return;
            }
        }

        this.motionY -= 0.03;
        this.motionX *= 0.98;
        this.motionY *= 0.98;
        this.motionZ *= 0.98;
        this.collision = this.moveCollide(this.motionX, this.motionY, this.motionZ);
        if (this.onGround) {
            this.motionX *= 0.7;
            this.motionZ *= 0.7;
            this.motionY *= -0.9;
        }
    }

    remove() {
        this.isDead = true;
        this.world?.removeEntityById?.(this.id);
    }
}
