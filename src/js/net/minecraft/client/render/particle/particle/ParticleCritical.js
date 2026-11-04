import Entity from '../../../entity/Entity.js';
import * as THREE from '../../../../../../../../libraries/three.module.js';

// CritParticle's sprite, short lifetime, color decay and non-colliding motion.
export default class ParticleCritical extends Entity {
    constructor(minecraft, world, x, y, z, dx, dy, dz, texture) {
        super(minecraft, world);
        this.setPosition(x, y, z);
        this.prevX = x; this.prevY = y; this.prevZ = z;
        this.motionX = dx * .4; this.motionY = dy * .4; this.motionZ = dz * .4;
        this.life = Math.max(1, Math.floor(6 / (Math.random() * .8 + .6)));
        this.red = this.green = this.blue = Math.random() * .3 + .6;
        this.texture = texture;
        this.texture.magFilter = this.texture.minFilter = THREE.NearestFilter;
        this.texture.generateMipmaps = false;
        this.group = null;
    }

    onUpdate() {
        this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
        if (++this.ticksExisted >= this.life) { this.kill(); return; }
        this.motionY -= .04;
        this.x += this.motionX; this.y += this.motionY; this.z += this.motionZ;
        this.motionX *= .98; this.motionY *= .98; this.motionZ *= .98;
        this.green *= .96; this.blue *= .9;
    }

    render(_yaw, _pitch, _roll, partialTicks) {
        if (!this.group) {
            this.group = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.texture, alphaTest: .1,
                transparent: false, depthTest: true, depthWrite: false }));
            this.minecraft.worldRenderer.scene.add(this.group);
        }
        const light = this.world.getLightBrightness?.(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) ?? 1;
        this.group.material.color.setRGB(this.red * light, this.green * light, this.blue * light);
        this.group.position.set(this.prevX + (this.x - this.prevX) * partialTicks,
            this.prevY + (this.y - this.prevY) * partialTicks, this.prevZ + (this.z - this.prevZ) * partialTicks);
        this.group.scale.setScalar(.15 * Math.min(1, (this.ticksExisted + partialTicks) / this.life * 32));
    }

    kill() {
        super.kill();
        this.group?.removeFromParent();
        this.group?.material.dispose();
    }
}
