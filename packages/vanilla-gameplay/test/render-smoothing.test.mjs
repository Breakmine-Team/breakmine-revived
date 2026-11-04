import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../../libraries/three.module.js';
import Timer from '../../../src/js/net/minecraft/util/Timer.js';
import PlayerEntity from '../../../src/js/net/minecraft/client/entity/PlayerEntity.js';
import EntityRenderer from '../../../src/js/net/minecraft/client/render/entity/EntityRenderer.js';
import { createTridentModel, applyHeldItemDisplay } from '../../../src/js/net/minecraft/client/render/HeldItemModel.js';
import { createSpriteItemGeometry } from '../../../src/js/net/minecraft/client/render/SpriteItemGeometry.js';
import FirstPersonItemRenderer from '../../../src/js/net/minecraft/client/render/FirstPersonItemRenderer.js';

test('fractional frame timing preserves 20 TPS and smooth interpolation at 144 Hz', () => {
    const timer = new Timer(20);
    timer.lastTime = 0;
    let ticks = 0;
    for (let frame = 1; frame <= 1440; frame++) {
        timer.advanceTime(frame * 1000 / 144);
        ticks += timer.ticks;
        assert.ok(timer.partialTicks >= 0 && timer.partialTicks < 1);
        assert.ok(Math.abs(timer.fps - 144) < 1e-8);
    }
    assert.ok(Math.abs(ticks + timer.partialTicks - 200) < 1e-9);
    timer.advanceTime(timer.lastTime);
    assert.ok(Number.isFinite(timer.fps));
});

test('mouse input shifts both interpolation endpoints, including clamped pitch', () => {
    const player = Object.assign(Object.create(PlayerEntity.prototype), {
        minecraft: { settings: { sensitivity: 500 } }, rotationYaw: 20,
        prevRotationYaw: 10, rotationPitch: 85, prevRotationPitch: 80
    });
    for (const partial of [0, .1, .5, .99]) {
        const before = player.prevRotationYaw + (player.rotationYaw - player.prevRotationYaw) * partial;
        player.turn(2, 0);
        const after = player.prevRotationYaw + (player.rotationYaw - player.prevRotationYaw) * partial;
        assert.equal(after - before, 2);
    }
    player.turn(0, -20);
    assert.equal(player.rotationPitch, 90);
    assert.equal(player.prevRotationPitch, 85);
});

test('swimmer model origin rotates with the body and does not accumulate between frames', () => {
    const renderer = new EntityRenderer({ rebuild() {}, render() {} });
    const entity = {
        prevX: 2, x: 2, prevY: 64, y: 64, prevZ: 3, z: 3,
        prevRenderYawOffset: 35, renderYawOffset: 35, prevRotationYawHead: 35, rotationYawHead: 35,
        prevRotationPitch: 0, rotationPitch: 0, prevLimbSwingStrength: 0, limbSwingStrength: 0,
        limbSwingProgress: 0, ticksExisted: 0, height: .6, swimming: true,
        updatePlayerPose() {}, isInWater: () => true, getSwimAmount: () => 1,
        getEntityBrightness: () => 1, renderer
    };
    renderer.render(entity, .5);
    const position = renderer.group.position.clone(), quaternion = renderer.group.quaternion.clone();
    assert.ok(Math.abs(position.y - 64.3) < 1e-9, 'horizontal body lies at swimming hitbox center');
    for (let frame = 0; frame < 100; frame++) renderer.render(entity, .5);
    assert.ok(renderer.group.position.distanceTo(position) < 1e-9);
    assert.ok(renderer.group.quaternion.angleTo(quaternion) < 1e-7);
    entity.getSwimAmount = () => 0;
    entity.swimming = false;
    renderer.render(entity, .5);
    assert.ok(Math.abs(renderer.group.position.y - 65.4) < 1e-9);
});

test('trident cuboids and bow/trident display transforms match the pinned model dimensions', () => {
    const model = createTridentModel(new THREE.Texture());
    model.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(model);
    assert.equal(bounds.max.x - bounds.min.x, 5);
    assert.equal(bounds.max.y - bounds.min.y, 31);
    assert.equal(bounds.max.z - bounds.min.z, 1);
    const display = new THREE.Group();
    applyHeldItemDisplay(display, 'bow');
    assert.deepEqual(display.position.toArray(), [-1, -2, 2.5]);
    assert.equal(display.scale.x, .9);
    applyHeldItemDisplay(display, 'trident', true);
    assert.deepEqual(display.position.toArray(), [8, -17, 9]);
    assert.equal(display.rotation.z, Math.PI);
});

test('shared item extrusion has front, back and edge faces rather than crossed planes', () => {
    const geometry = createSpriteItemGeometry(new Uint8Array([255, 255, 255, 255]), 1, 1);
    assert.equal(geometry.getAttribute('position').count, 24);
    assert.equal(geometry.index.count, 36);
    geometry.computeBoundingBox();
    assert.equal(geometry.boundingBox.max.z - geometry.boundingBox.min.z, 1 / 16);
});

test('reused first-person transform matrices preserve swing/eat motion without accumulating', () => {
    const renderer = new FirstPersonItemRenderer({});
    for (const type of ['whack', 'stab', 'none']) {
        for (const progress of [0, .05, .2, .5, 1]) {
            const pose = renderer.poseMatrix.identity();
            renderer.applyItemArmTransform(pose, .7);
            renderer.applySwingTransform(pose, progress, type);
            renderer.applyEatTransform(pose, 15, .5, 32);
            assert.ok(pose.elements.every(Number.isFinite));
            const expected = pose.clone();
            for (let frame = 0; frame < 100; frame++) {
                pose.identity();
                renderer.applyItemArmTransform(pose, .7);
                renderer.applySwingTransform(pose, progress, type);
                renderer.applyEatTransform(pose, 15, .5, 32);
                assert.deepEqual(pose.elements, expected.elements);
            }
        }
    }
});
