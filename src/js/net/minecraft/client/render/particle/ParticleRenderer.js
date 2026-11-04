import MathHelper from "../../../util/MathHelper.js";
import Block from "../../world/block/Block.js";
import ParticleDigging from "./particle/ParticleDigging.js";
import ParticleCritical from './particle/ParticleCritical.js';

export default class ParticleRenderer {

    constructor(minecraft) {
        this.minecraft = minecraft;
        this.particles = [];
        this.criticalEmitters = [];
    }

    spawnParticle(particle) {
        this.particles.push(particle);
    }

    onTick() {
        for (let i = this.criticalEmitters.length - 1; i >= 0; i--) {
            const emitter = this.criticalEmitters[i], entity = emitter.entity;
            // TrackingEmitter samples a unit sphere 16 times per tick for 3 ticks.
            for (let sample = 0; sample < 16; sample++) {
                const x = Math.random() * 2 - 1, y = Math.random() * 2 - 1, z = Math.random() * 2 - 1;
                if (x * x + y * y + z * z > 1) continue;
                this.spawnParticle(new ParticleCritical(this.minecraft, entity.world,
                    entity.x + x * entity.width / 4, entity.y + (.5 + y / 4) * entity.height,
                    entity.z + z * entity.width / 4, x, y + .2, z, this.criticalTexture));
            }
            if (++emitter.age >= 3) this.criticalEmitters.splice(i, 1);
        }
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
        let yaw = cameraEntity.prevRotationYaw + (cameraEntity.rotationYaw - cameraEntity.prevRotationYaw) * partialTicks;
        let pitch = cameraEntity.prevRotationPitch + (cameraEntity.rotationPitch - cameraEntity.prevRotationPitch) * partialTicks;

        let rotationX = MathHelper.toRadians(pitch);
        let rotationY = -MathHelper.toRadians(yaw);

        for (let i = 0; i < this.particles.length; i++) {
            const particle = this.particles[i];

            particle.render(rotationX, rotationY, 0, partialTicks);
        }
    }

    spawnBlockBreakParticle(world, x, y, z) {
        let typeId = world.getBlockAt(x, y, z);
        if (typeId === 0) {
            return;
        }

        let block = Block.getById(typeId);
        let range = 4;
        for (let offsetX = 0; offsetX < range; offsetX++) {
            for (let offsetY = 0; offsetY < range; offsetY++) {
                for (let offsetZ = 0; offsetZ < range; offsetZ++) {

                    let targetX = x + (offsetX + 0.5) / range;
                    let targetY = y + (offsetY + 0.5) / range;
                    let targetZ = z + (offsetZ + 0.5) / range;

                    let motionX = targetX - x - 0.5;
                    let motionY = targetY - y - 0.5;
                    let motionZ = targetZ - z - 0.5;

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

    emitCriticalHit(entity) {
        this.criticalTexture ??= this.minecraft.getThreeTexture('particles/critical_hit.png');
        if (this.criticalTexture) this.criticalEmitters.push({ entity, age: 0 });
    }


}
