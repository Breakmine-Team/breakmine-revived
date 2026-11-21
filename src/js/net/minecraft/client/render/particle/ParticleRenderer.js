import MathHelper from "../../../util/MathHelper.js";
import Block from "../../world/block/Block.js";
import ParticleDigging from "./particle/ParticleDigging.js";

export default class ParticleRenderer {

    constructor(minecraft) {
        this.minecraft = minecraft;
        this.particles = [];
    }

    // 'all', 'minimal' (fewer particles per burst) or 'off'.
    getParticleMode() {
        const mode = this.minecraft ? this.minecraft.settings?.particles : null;
        return mode === "minimal" || mode === "off" ? mode : "all";
    }

    clearParticles() {
        this.particles.length = 0;
    }

    spawnParticle(particle) {
        if (this.getParticleMode() === "off") {
            return;
        }
        this.particles.push(particle);
    }

    onTick() {
        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];
            particle.onUpdate();

            if (particle.isDead) {
                this.particles.splice(i, 1);
                i--;
            }
        }
    }

    renderParticles(cameraEntity, partialTicks) {
        if (this.getParticleMode() === "off") {
            return;
        }

        let yaw = cameraEntity.prevRotationYaw + (cameraEntity.rotationYaw - cameraEntity.prevRotationYaw) * partialTicks;
        let pitch = cameraEntity.prevRotationPitch + (cameraEntity.rotationPitch - cameraEntity.prevRotationPitch) * partialTicks;

        let rotationX = MathHelper.toRadians(pitch);
        let rotationY = -MathHelper.toRadians(yaw);

        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];

            particle.render(rotationX, rotationY, 0, partialTicks);
        }
    }

    
    spawnBlockBreakParticle(world, x, y, z, pose = null, blockOverride = null) {
        let block = blockOverride || Block.getById(world.getBlockAt(x, y, z));
        if (!block) {
            return;
        }

        const mode = this.getParticleMode();
        if (mode === "off") {
            return;
        }

        let range = mode === "minimal" ? 2 : 4;
        for (let offsetX = 0; offsetX < range; offsetX++) {
            for (let offsetY = 0; offsetY < range; offsetY++) {
                for (let offsetZ = 0; offsetZ < range; offsetZ++) {

                    let targetX = x + (offsetX + 0.5) / range;
                    let targetY = y + (offsetY + 0.5) / range;
                    let targetZ = z + (offsetZ + 0.5) / range;

                    let motionX = targetX - x - 0.5;
                    let motionY = targetY - y - 0.5;
                    let motionZ = targetZ - z - 0.5;

                    if (pose) {
                        const p = pose.point(targetX, targetY, targetZ);
                        targetX = p.x;
                        targetY = p.y;
                        targetZ = p.z;

                        const m = pose.delta(motionX, motionY, motionZ);
                        motionX = m.x;
                        motionY = m.y;
                        motionZ = m.z;
                    }

                    this.spawnParticle(new ParticleDigging(
                        this.minecraft,
                        world,
                        targetX,
                        targetY,
                        targetZ,
                        motionX,
                        motionY,
                        motionZ,
                        block
                    ));
                }
            }
        }
    }


}