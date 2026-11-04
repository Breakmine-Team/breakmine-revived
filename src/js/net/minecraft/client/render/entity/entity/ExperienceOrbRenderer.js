import * as THREE from '../../../../../../../../libraries/three.module.js';
import EntityRenderer from '../EntityRenderer.js';

const ORB_TEXTURE = 'terrain/pack/minecraft/textures/entity/experience_orb.png';

export default class ExperienceOrbRenderer extends EntityRenderer {
    constructor(worldRenderer) {
        super(null);
        this.worldRenderer = worldRenderer;
        const image = worldRenderer?.minecraft?.resources?.[ORB_TEXTURE];
        const texture = image ? new THREE.Texture(image) : null;
        if (texture) {
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.wrapS = THREE.RepeatWrapping;
            texture.wrapT = THREE.RepeatWrapping;
            texture.repeat.set(0.25, 0.25);
            texture.needsUpdate = true;
        }
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            color: texture ? 0xffffff : 0x73ff52,
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide
        });
        this.sprite = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 0.25), material);
        this.sprite.renderOrder = 10000;
        this.group.add(this.sprite);
    }

    render(entity, partialTicks) {
        const x = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        const y = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        const z = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;
        this.group.position.set(x, y, z);
        this.group.quaternion.copy(this.worldRenderer.camera.quaternion);
        this.group.visible = !entity.isDead;
        const texture = this.sprite.material.map;
        if (texture) {
            const frame = Math.floor((entity.age + partialTicks) / 2) & 15;
            texture.offset.set((frame & 3) * 0.25, 0.75 - (frame >> 2) * 0.25);
        }
    }
}
