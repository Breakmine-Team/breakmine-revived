import * as THREE from '../../../../../../../../libraries/three.module.js';
import EntityRenderer from '../EntityRenderer.js';
import { createTridentModel } from '../../HeldItemModel.js';

const PROJECTILE_TEXTURES = {
    normal: 'terrain/pack/minecraft/textures/entity/arrow_projectile.png',
    tipped: 'terrain/pack/minecraft/textures/entity/arrow_tipped.png',
    spectral: 'terrain/pack/minecraft/textures/entity/arrow_spectral.png'
};

function readTexture(worldRenderer, path) {
    const image = worldRenderer?.minecraft?.resources?.[path];
    if (!image) return null;
    const texture = new THREE.Texture(image);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;
    return texture;
}

function arrowPanelGeometry() {
    // ArrowModel.createBodyLayer() in the reference JAR uses two 16x4x0 cuboids
    // at Z rotations 45 and 135 degrees, with UV (0, 0) on a 32x32 sheet.
    const geometry = new THREE.PlaneGeometry(0.9, 0.225);
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, uv.getX(i) * 0.5, 0.875 + uv.getY(i) * 0.125);
    }
    uv.needsUpdate = true;
    return geometry;
}

/** Shared pinned-JAR arrow/trident geometry and projectile textures. */
export default class MobArrowRenderer extends EntityRenderer {
    constructor(worldRenderer) {
        super(null);
        this.projectileTextures = Object.fromEntries(
            Object.entries(PROJECTILE_TEXTURES).map(([kind, path]) => [kind, readTexture(worldRenderer, path)])
        );

        const arrowMaterial = new THREE.MeshBasicMaterial({
            map: this.projectileTextures.normal,
            color: this.projectileTextures.normal ? 0xffffff : 0x76583b,
            transparent: true,
            alphaTest: 0.01,
            side: THREE.DoubleSide,
            depthWrite: true
        });
        const panelGeometry = arrowPanelGeometry();
        const cross1 = new THREE.Mesh(panelGeometry, arrowMaterial);
        cross1.position.x = -0.225;
        cross1.rotation.z = Math.PI / 4;
        const cross2 = new THREE.Mesh(panelGeometry, arrowMaterial);
        cross2.position.x = -0.225;
        cross2.rotation.z = 3 * Math.PI / 4;
        // The JAR's `back` part is a 0x5x5 cuboid at (-11, 0, 0), scaled 0.8.
        const back = new THREE.Mesh(
            new THREE.BoxGeometry(0.018, 0.225, 0.225),
            new THREE.MeshBasicMaterial({ color: 0x76583b })
        );
        back.position.x = -0.619;
        back.rotation.z = Math.PI / 4;
        this.group.add(cross1, cross2, back);
        this.arrowMeshes = [cross1, cross2, back];
        this.arrowMaterial = arrowMaterial;

        this.tridentTexture = readTexture(worldRenderer, 'terrain/pack/minecraft/textures/entity/trident_model.png');
        this.tridentModel = createTridentModel(this.tridentTexture, { held: false });
        this.group.add(this.tridentModel);
        this.tridentMeshes = [];
        this.tridentModel.traverse(mesh => { if (mesh.isMesh) this.tridentMeshes.push(mesh); });
    }

    render(entity, partialTicks) {
        const isTrident = entity.projectileKind === 'trident';
        for (const mesh of this.arrowMeshes) mesh.visible = !isTrident;
        this.tridentModel.visible = isTrident;
        const textureKind = entity.projectileKind === 'spectral' ? 'spectral' : entity.effect ? 'tipped' : 'normal';
        const texture = this.projectileTextures[textureKind];
        const previousHasMap = !!this.arrowMaterial.map;
        this.arrowMaterial.map = texture;
        const potionTint = entity.effect === 'slowness' ? 0x5a6c81 : 0xffffff;
        this.arrowMaterial.color.setHex(texture ? potionTint : 0x76583b);
        if (previousHasMap !== !!texture) this.arrowMaterial.needsUpdate = true;
        this.group.position.set(
            entity.prevX + (entity.x - entity.prevX) * partialTicks,
            entity.prevY + (entity.y - entity.prevY) * partialTicks,
            entity.prevZ + (entity.z - entity.prevZ) * partialTicks
        );
        // ArrowRenderer.submit rotates the JAR model by (yaw - 90) around Y,
        // then by pitch around Z. Its body axis is local +X.
        const yaw = this.interpolateRotation(entity.prevRotationYaw ?? entity.rotationYaw, entity.rotationYaw, partialTicks);
        const pitch = this.interpolateRotation(entity.prevRotationPitch ?? entity.rotationPitch, entity.rotationPitch, partialTicks);
        this.group.rotation.set(0, (yaw - 90) * Math.PI / 180,
            (pitch + (isTrident ? 90 : 0)) * Math.PI / 180, 'YXZ');
        this.group.visible = !entity.isDead;
    }
}
