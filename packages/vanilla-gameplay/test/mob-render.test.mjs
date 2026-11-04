import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import * as THREE from '../../../libraries/three.module.js';
import { createMobEntity, MOB_ENTITY_TYPES, resolveMobEntityType } from '../../../src/js/net/minecraft/client/entity/MobEntity.js';
import MobRenderer from '../../../src/js/net/minecraft/client/render/entity/entity/MobRenderer.js';
import MobArrowRenderer from '../../../src/js/net/minecraft/client/render/entity/entity/MobArrowRenderer.js';
import BlockRenderer from '../../../src/js/net/minecraft/client/render/BlockRenderer.js';
import { BlockRegistry } from '../../../src/js/net/minecraft/client/world/block/BlockRegistry.js';
import { summonVanillithMob } from '../../../src/js/net/minecraft/client/world/generator/VanillithEntityPreview.js';
import { attachHeldItemModel, createTridentModel, applyHeldItemDisplay } from '../../../src/js/net/minecraft/client/render/HeldItemModel.js';

if (!BlockRegistry.init) BlockRegistry.create();

const jarPath = '/home/_doxism/minecraft-client-26.3.jar';

function equipmentTexture() {
    const texture = new THREE.DataTexture(new Uint8Array(16 * 16 * 4).fill(255), 16, 16);
    return texture;
}

test('undead mob aliases resolve to canonical entity IDs and preserve spawn transforms', () => {
    assert.equal(resolveMobEntityType('zombie'), 'minecraft:zombie');
    assert.equal(resolveMobEntityType('minecraft:WITHER_SKELETON'), 'minecraft:wither_skeleton');
    assert.equal(resolveMobEntityType('minecraft:unknown'), null);

    const entity = createMobEntity({}, {}, 'stray', { x: 12.5, y: 70, z: -4, yaw: 90, pitch: -10 });
    assert.equal(entity.entityType, 'minecraft:stray');
    assert.equal(entity.x, 12.5);
    assert.equal(entity.y, 70);
    assert.equal(entity.z, -4);
    assert.equal(entity.rotationYaw, 90);
    assert.equal(entity.rotationPitch, -10);
    assert.equal(createMobEntity({}, {}, 'minecraft:bat', { x: 0, y: 0, z: 0 }), null);
});

test('each undead type builds non-empty textured geometry through the shared entity renderer', () => {
    const worldRenderer = { minecraft: { getThreeTexture: equipmentTexture } };
    for (const type of Object.keys(MOB_ENTITY_TYPES)) {
        const entity = createMobEntity({ player: null }, { getLightBrightness: () => 1 }, type, { x: 0, y: 64, z: 0 });
        if (type === 'minecraft:drowned') {
            entity.heldWeaponTexture = 'trident';
            entity.hasTrident = true;
        }
        const renderer = new MobRenderer(worldRenderer, type);
        assert.equal(renderer.tessellator.material.transparent, false, `${type} base skin is opaque`);
        assert.equal(renderer.tessellator.material.alphaTest, 0.1, `${type} base skin uses cutout alpha`);
        assert.equal(renderer.tessellator.material.depthWrite, true, `${type} base skin writes depth`);
        entity.renderer = renderer;
        if (['minecraft:zombie', 'minecraft:husk'].includes(type)) {
            const biped = renderer.model.model;
            const uvBounds = part => {
                const values = part.cubes.flatMap(faces => faces.flatMap(face => face.vertices.flatMap(vertex => [vertex.u, vertex.v])));
                return [Math.min(...values.filter((_, i) => i % 2 === 0)), Math.min(...values.filter((_, i) => i % 2 === 1)),
                    Math.max(...values.filter((_, i) => i % 2 === 0)), Math.max(...values.filter((_, i) => i % 2 === 1))];
            };
            const closeTo = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ~= ${expected}`);
            const armUv = uvBounds(biped.leftArm), legUv = uvBounds(biped.leftLeg);
            closeTo(armUv[0], 40 / 64); closeTo(armUv[2], 56 / 64);
            closeTo(armUv[1], 1 - 32 / 64); closeTo(armUv[3], 1 - 16 / 64);
            closeTo(legUv[0], 0); closeTo(legUv[2], 16 / 64);
            closeTo(legUv[1], 1 - 32 / 64); closeTo(legUv[3], 1 - 16 / 64);
        }
        if (type === 'minecraft:drowned') {
            const biped = renderer.model.model;
            assert.deepEqual([biped.leftArm.textureOffsetX, biped.leftArm.textureOffsetY], [32, 48], 'drowned keeps its distinct modern left arm UV');
            assert.deepEqual([biped.leftLeg.textureOffsetX, biped.leftLeg.textureOffsetY], [16, 48], 'drowned keeps its distinct modern left leg UV');
        }
        renderer.render(entity, 0.5);
        const meshes = [];
        renderer.group.traverse(child => { if (child.isMesh) meshes.push(child); });
        assert.ok(meshes.length >= 1, `${type} model mesh count`);
        assert.ok(meshes.every(mesh => mesh.geometry.getAttribute('position').count > 0), `${type} vertex count`);
        assert.ok(meshes.every(mesh => mesh.geometry.getAttribute('uv').array.every(Number.isFinite)), `${type} UVs`);
        const overlayMeshes = meshes.filter(mesh => mesh.userData.mobOverlay);
        const shouldHaveOverlay = ['minecraft:drowned', 'minecraft:stray'].includes(type);
        assert.equal(overlayMeshes.length > 0, shouldHaveOverlay, `${type} overlay layer`);
        if (shouldHaveOverlay) {
            assert.ok(overlayMeshes.every(mesh => mesh.material.map === renderer.overlayTexture), `${type} overlay texture binding`);
            assert.ok(overlayMeshes.every(mesh => mesh.material.alphaTest > 0), `${type} overlay cutout`);
            assert.equal(overlayMeshes.some(mesh => mesh.userData.mobHeldWeapon), false, `${type} overlay does not duplicate its weapon`);
        }
        const expectedWeapon = type === 'minecraft:skeleton' || type === 'minecraft:stray' ? 'bow'
            : type === 'minecraft:drowned' ? 'trident'
                : type === 'minecraft:wither_skeleton' ? 'stone_sword' : null;
        const weaponMeshes = meshes.filter(mesh => mesh.userData.mobHeldWeapon);
        assert.equal(weaponMeshes.length, expectedWeapon === 'trident' ? 5 : expectedWeapon ? 1 : 0, `${type} solid equipment geometry`);
        if (expectedWeapon) {
            assert.ok(weaponMeshes.every(mesh => mesh.material.map === renderer.heldWeaponTextures.get(expectedWeapon)));
            assert.ok(weaponMeshes.every(mesh => mesh.userData.dynamicHeldItemLight));
            assert.ok(weaponMeshes.every(mesh => mesh.material.side === THREE.FrontSide), 'solid equipment uses outward faces');
        }
        if (expectedWeapon === 'bow') {
            assert.equal(renderer.model.model.aiming, false, `${type} bow is lowered while idle`);
            entity.attackTarget = {};
            entity.rangedChargeTicks = 12;
            renderer.render(entity, 0.5);
            assert.equal(renderer.model.model.aiming, true, `${type} raises its bow against a target`);
            assert.ok(weaponMeshes.every(mesh => mesh.material.map === renderer.heldWeaponTextures.get('bow_pulling_2')), `${type} bow draw texture`);
        }
    }
});

test('26.3 arrow renderer uses the JAR cross-plane model dimensions, UV region and projectile textures', async () => {
    const jarBytes = await readFile(jarPath);
    const zip = await JSZip.loadAsync(jarBytes);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(await readFile('src/resources/terrain/pack/minecraft/textures/entity/trident_model.png')),
        hash(await zip.file('assets/minecraft/textures/entity/trident/trident.png').async('nodebuffer')),
        'trident model texture is byte-identical to the pinned JAR');
    for (const [jarName, localName] of [
        ['arrow.png', 'arrow_projectile.png'],
        ['arrow_tipped.png', 'arrow_tipped.png'],
        ['arrow_spectral.png', 'arrow_spectral.png']
    ]) {
        const jarTexture = await zip.file(`assets/minecraft/textures/entity/projectiles/${jarName}`)?.async('nodebuffer');
        const localTexture = await readFile(`src/resources/terrain/pack/minecraft/textures/entity/${localName}`);
        assert.ok(jarTexture, `pinned JAR projectile texture ${jarName} exists`);
        assert.equal(hash(localTexture), hash(jarTexture), `${localName} is byte-identical to the JAR`);
    }

    const textures = Object.fromEntries([
        'arrow_projectile', 'arrow_tipped', 'arrow_spectral'
    ].map(name => [`terrain/pack/minecraft/textures/entity/${name}.png`, { width: 32, height: 32 }]));
    const renderer = new MobArrowRenderer({ minecraft: { resources: textures } });
    assert.deepEqual(renderer.arrowMeshes.slice(0, 2).map(mesh => Number(mesh.geometry.parameters.width.toFixed(3))), [0.9, 0.9]);
    assert.ok(Math.abs(renderer.arrowMeshes[0].rotation.z - Math.PI / 4) < 1e-12);
    assert.ok(Math.abs(renderer.arrowMeshes[1].rotation.z - 3 * Math.PI / 4) < 1e-12);
    const uv = renderer.arrowMeshes[0].geometry.getAttribute('uv');
    assert.ok(uv.array.every(Number.isFinite));
    renderer.render({ prevX: 0, x: 1, prevY: 2, y: 3, prevZ: 4, z: 5,
        rotationYaw: 90, rotationPitch: 0, projectileKind: 'arrow', isDead: false }, 0.5);
    assert.equal(renderer.group.position.x, 0.5);
    assert.equal(renderer.group.rotation.y, 0);
    assert.equal(renderer.arrowMaterial.map, renderer.projectileTextures.normal);
    renderer.render({ prevX: 0, x: 0, prevY: 0, y: 0, prevZ: 0, z: 0,
        rotationYaw: 0, rotationPitch: 0, projectileKind: 'arrow', effect: 'slowness', isDead: false }, 1);
    assert.equal(renderer.arrowMaterial.map, renderer.projectileTextures.tipped);
});

test('zombie arms swing naturally while walking and only raise into the JAR attack pose when aggressive', () => {
    const worldRenderer = { minecraft: { getThreeTexture: equipmentTexture } };
    const zombie = createMobEntity({ player: null }, { getLightBrightness: () => 1 }, 'minecraft:zombie', { x: 0, y: 64, z: 0 });
    const renderer = new MobRenderer(worldRenderer, zombie.entityType);
    zombie.renderer = renderer;
    zombie.limbSwingProgress = 1.2;
    zombie.limbSwingStrength = 0.8;
    renderer.render(zombie, 1);
    const model = renderer.model.model;
    assert.equal(model.isAggressive, false);
    assert.notEqual(model.rightArm.rotateAngleX, model.leftArm.rotateAngleX, 'walking arms counter-swing with the legs');
    assert.ok(Math.abs(model.rightArm.rotateAngleX) < 1, 'idle walker arm is not frozen above horizontal');

    zombie.attackTarget = {};
    zombie.getSwingAnimation = () => 0.5;
    renderer.render(zombie, 1);
    assert.equal(model.isAggressive, true);
    assert.ok(model.rightArm.rotateAngleX < -1.4 && model.leftArm.rotateAngleX < -1.4, 'attack arms use the raised undead pose');
    assert.notEqual(model.rightArm.rotateAngleY, model.leftArm.rotateAngleY, 'raised arms angle inward symmetrically');
});

test('bow skeletons keep the bow lowered while walking and aim only at a combat target', () => {
    const worldRenderer = { minecraft: { getThreeTexture: equipmentTexture } };
    const skeleton = createMobEntity({ player: null }, { getLightBrightness: () => 1 }, 'minecraft:skeleton', { x: 0, y: 64, z: 0 });
    const renderer = new MobRenderer(worldRenderer, skeleton.entityType);
    skeleton.renderer = renderer;
    skeleton.limbSwingProgress = 2;
    skeleton.limbSwingStrength = 0.8;

    renderer.render(skeleton, 1);
    const model = renderer.model.model;
    assert.equal(model.aiming, false);
    assert.notEqual(model.rightArm.rotateAngleX, model.leftArm.rotateAngleX, 'idle bow-holding arms counter-swing with the legs');

    skeleton.attackTarget = {};
    renderer.render(skeleton, 1);
    assert.equal(model.aiming, true);
    assert.ok(model.rightArm.rotateAngleX < -1.4 && model.leftArm.rotateAngleX < -1.4, 'combat pose raises both arms to aim');
    skeleton.prevRotationPitch = skeleton.rotationPitch = 30;
    renderer.render(skeleton, 1);
    assert.ok(Math.abs(model.rightArm.rotateAngleX - (-Math.PI / 2 + Math.PI / 6)) < 1e-9,
        'bow arm follows full head pitch, not a small fraction');
});

test('undead humanoid render models blend into the JAR 26-tick swim cycle and back out cleanly', () => {
    const worldRenderer = { minecraft: { getThreeTexture: () => new THREE.Texture() } };
    const drowned = createMobEntity({ player: null }, { getLightBrightness: () => 1 }, 'minecraft:drowned', { x: 0, y: 64, z: 0 });
    const renderer = new MobRenderer(worldRenderer, drowned.entityType);
    drowned.renderer = renderer;
    drowned.limbSwingProgress = 4;
    drowned.limbSwingStrength = 0.8;
    drowned.prevSwimAmount = drowned.swimAmount = 1;
    renderer.render(drowned, 1);
    const model = renderer.model.model;
    assert.equal(model.swimAmount, 1);
    assert.equal(model.head.rotateAngleX, 0, 'drowned swim override keeps head level');
    const wave = Math.sin(.1 * (drowned.ticksExisted + 1));
    assert.ok(Math.abs(model.leftLeg.rotateAngleX - (Math.cos(4 * .6662 + Math.PI) * 1.4 * .8 - .55 * wave)) < 1e-9);
    assert.ok(Math.abs(model.rightLeg.rotateAngleX - (Math.cos(4 * .6662) * 1.4 * .8 + .55 * wave)) < 1e-9);
    drowned.prevSwimAmount = drowned.swimAmount = 0;
    renderer.render(drowned, 1);
    assert.equal(model.head.rotateAngleX, 0, 'leaving water restores the ordinary head pose');
});

test('mob model scale remains stable across repeated animation/render frames', () => {
    const worldRenderer = { minecraft: { getThreeTexture: () => new THREE.Texture() } };
    const zombie = createMobEntity({ player: null }, { getLightBrightness: () => 1 }, 'minecraft:zombie', { x: 0, y: 64, z: 0 });
    const renderer = new MobRenderer(worldRenderer, zombie.entityType);
    zombie.renderer = renderer;
    zombie.height = 1.95;

    for (let frame = 0; frame < 240; frame++) renderer.render(zombie, (frame % 10) / 10);

    const expectedScale = zombie.height / 32;
    assert.ok(Math.abs(renderer.group.scale.x + expectedScale) < 1e-12);
    assert.ok(Math.abs(renderer.group.scale.y + expectedScale) < 1e-12);
    assert.ok(Math.abs(renderer.group.scale.z - expectedScale) < 1e-12);
    renderer.group.updateMatrixWorld(true);
    const foot = new THREE.Vector3(0, 24, 0).applyMatrix4(renderer.group.matrixWorld);
    assert.ok(Math.abs(foot.y - zombie.y) < 1e-9, 'model feet align with the collision-box base');
});

test('held bow and trident matrices match the complete JAR item transform chain', async () => {
    const zip = await JSZip.loadAsync(await readFile(jarPath));
    for (const [name, file, throwing] of [
        ['bow', 'bow', false], ['trident', 'trident_in_hand', false], ['trident', 'trident_throwing', true]
    ]) {
        const json = JSON.parse(await zip.file(`assets/minecraft/models/item/${file}.json`).async('string'));
        const transform = json.display.thirdperson_righthand;
        const parent = new THREE.Group();
        const model = name === 'trident' ? createTridentModel(equipmentTexture())
            : new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
        const display = attachHeldItemModel(parent, model, name);
        applyHeldItemDisplay(display, name, throwing);
        parent.updateMatrixWorld(true);
        const expected = new THREE.Matrix4().makeRotationX(-Math.PI / 2)
            .multiply(new THREE.Matrix4().makeRotationY(Math.PI))
            .multiply(new THREE.Matrix4().makeTranslation(1, 2, -10))
            .multiply(new THREE.Matrix4().makeTranslation(...transform.translation))
            .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(
                ...transform.rotation.map(v => v * Math.PI / 180), 'XYZ')))
            .multiply(new THREE.Matrix4().makeScale(...transform.scale));
        if (name === 'trident') {
            expected.multiply(new THREE.Matrix4().makeTranslation(-8, -8, -8))
                .multiply(new THREE.Matrix4().makeScale(1, -1, -1));
        } else expected.multiply(new THREE.Matrix4().makeScale(16, 16, 16));
        model.matrixWorld.elements.forEach((value, i) => assert.ok(Math.abs(value - expected.elements[i]) < 1e-9,
            `${file} matrix component ${i}: ${value} vs ${expected.elements[i]}`));
    }
});

test('mob equipment uses player BlockRenderer and skeleton hand pivot correction is applied before arm rotation', () => {
    const worldRenderer = { minecraft: { getThreeTexture: equipmentTexture } };
    const blockRenderer = new BlockRenderer(worldRenderer);
    // CPU-only stand-in for atlas decode; keep the real attachment path.
    blockRenderer.createGeneratedItemMesh = () => new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ map: equipmentTexture() }));
    worldRenderer.blockRenderer = blockRenderer;
    const skeleton = createMobEntity({ player: null }, { getLightBrightness: () => 1 }, 'skeleton', { x: 0, y: 64, z: 0 });
    const renderer = new MobRenderer(worldRenderer, skeleton.entityType);
    skeleton.renderer = renderer;
    skeleton.attackTarget = {};
    skeleton.prevRotationPitch = skeleton.rotationPitch = 25;
    let attachments = 0;
    const attach = blockRenderer.renderBlockInHandThirdPerson.bind(blockRenderer);
    blockRenderer.renderBlockInHandThirdPerson = (...args) => { attachments++; return attach(...args); };
    renderer.render(skeleton, 1);
    assert.equal(attachments, 1, 'uses the same holding method as PlayerRenderer');
    const arm = renderer.model.model.rightArm.bone;
    const hand = renderer.heldItemDisplay.parent.parent;
    const correction = hand.position.clone().applyQuaternion(arm.quaternion);
    assert.ok(correction.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-9,
        'SkeletonModel +1 pivot shift stays in model axes, not rotating arm axes');
});

test('Wither Skeleton Skull item uses the JAR 8px head cube and 64x32 skin UVs', () => {
    const skin = new THREE.Texture();
    const worldRenderer = {
        textureTerrain: null,
        minecraft: { getThreeTexture: path => path === 'entities/mobs/wither_skeleton.png' ? skin : null }
    };
    const blockRenderer = new BlockRenderer(worldRenderer);
    const group = new THREE.Group();
    const mesh = blockRenderer.createSkullModelMesh(BlockRegistry.ITEM_WITHER_SKELETON_SKULL, 1, group);
    assert.ok(mesh);
    assert.equal(mesh.parent, group, 'item entity rebuild can detach/dispose the model mesh cleanly');
    assert.equal(mesh.material.map, skin);
    assert.equal(mesh.material.transparent, false);
    assert.equal(mesh.material.alphaTest, 0.05);
    mesh.geometry.computeBoundingBox();
    const bounds = mesh.geometry.boundingBox;
    assert.deepEqual([
        Number((bounds.max.x - bounds.min.x).toFixed(6)),
        Number((bounds.max.y - bounds.min.y).toFixed(6)),
        Number((bounds.max.z - bounds.min.z).toFixed(6))
    ], [0.5, 0.5, 0.5]);
    const uv = mesh.geometry.getAttribute('uv');
    assert.equal(uv.count, 24);
    assert.ok(uv.array.every(value => Number.isFinite(value) && value >= 0 && value <= 1));
});

test('Vanillith summon creates temporary preview entities with absolute or relative coordinates only', () => {
    const player = { x: 10, y: 72, z: -4, rotationYaw: 35, getLook: () => ({ x: 1, y: 0, z: 0 }) };
    const minecraft = { player };
    const spawned = [];
    const world = { addEntity: entity => spawned.push(entity), setBlockAt() { throw new Error('preview must stay read-only'); } };

    const near = summonVanillithMob(minecraft, world, 'zombie');
    assert.equal(near.ok, true);
    assert.deepEqual([near.x, near.y, near.z], [12, 72, -4]);
    assert.equal(near.entity.entityType, 'minecraft:zombie');

    const placed = summonVanillithMob(minecraft, world, 'minecraft:stray', ['~1.5', '~', '~-2']);
    assert.equal(placed.ok, true);
    assert.deepEqual([placed.x, placed.y, placed.z], [11.5, 72, -6]);
    assert.equal(placed.entity.rotationYaw, 35);

    assert.equal(summonVanillithMob(minecraft, world, 'bat').reason, 'unknown_type');
    assert.equal(summonVanillithMob(minecraft, world, 'zombie', ['NaN', '~', '~']).reason, 'invalid_position');
    assert.equal(spawned.length, 2);
    const cappedWorld = { entities: Array.from({ length: 32 }, (_, id) => ({ id, entityType: 'minecraft:zombie' })), addEntity() {} };
    assert.equal(summonVanillithMob(minecraft, cappedWorld, 'zombie').reason, 'limit');
});

test('undead model family dimensions and texture assets match Minecraft 26.3 JAR', async () => {
    const jarBytes = await readFile(jarPath);
    const zip = await JSZip.loadAsync(jarBytes);
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    for (const definition of Object.values(MOB_ENTITY_TYPES)) {
        const jarTexture = `assets/minecraft/textures/entity/${definition.sourceTexture}`;
        const source = await zip.file(jarTexture)?.async('nodebuffer');
        const local = await readFile(`src/resources/${definition.texture}`);
        assert.ok(source, `missing pinned texture ${jarTexture}`);
        assert.equal(hash(local), hash(source), definition.texture);
        assert.ok(definition.width > 0 && definition.height > 0 && definition.health > 0);
        assert.ok(['zombie', 'skeleton'].includes(definition.family));
        if (definition.sourceOverlayTexture) {
            const jarOverlay = `assets/minecraft/textures/entity/${definition.sourceOverlayTexture}`;
            const sourceOverlay = await zip.file(jarOverlay)?.async('nodebuffer');
            const localOverlay = await readFile(`src/resources/${definition.overlayTexture}`);
            assert.ok(sourceOverlay, `missing pinned overlay ${jarOverlay}`);
            assert.equal(hash(localOverlay), hash(sourceOverlay), definition.overlayTexture);
        }
    }
});
