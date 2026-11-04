import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
    addExperiencePoints, experienceToNextLevel, splitExperienceOrbValues
} from '../experience.mjs';
import ExperienceOrbEntity from '../../../src/js/net/minecraft/client/entity/ExperienceOrbEntity.js';
import { createMobEntity } from '../../../src/js/net/minecraft/client/entity/MobEntity.js';
import { BlockRegistry } from '../../../src/js/net/minecraft/client/world/block/BlockRegistry.js';
import ExperienceOrbRenderer from '../../../src/js/net/minecraft/client/render/entity/entity/ExperienceOrbRenderer.js';
import * as THREE from '../../../libraries/three.module.js';
import { uiTextures } from '../../../src/js/assetManifest.js';

globalThis.window ??= { addEventListener() {} };
globalThis.document ??= { addEventListener() {} };
const { default: IngameOverlay } = await import('../../../src/js/net/minecraft/client/gui/overlay/IngameOverlay.js');

test('26.3 experience thresholds and progress carry-over match player leveling', () => {
    assert.equal(experienceToNextLevel(0), 7);
    assert.equal(experienceToNextLevel(14), 35);
    assert.equal(experienceToNextLevel(15), 37);
    assert.equal(experienceToNextLevel(30), 112);
    const player = { experienceLevel: 0, experienceProgress: 0, totalExperience: 0 };
    assert.equal(addExperiencePoints(player, 7), 7);
    assert.deepEqual(player, { experienceLevel: 1, experienceProgress: 0, totalExperience: 7 });
    addExperiencePoints(player, 5);
    assert.equal(player.experienceLevel, 1);
    assert.equal(player.experienceProgress, 5 / 9);
    assert.equal(player.totalExperience, 12);
});

test('XP orb denominations split a five-point undead reward like the JAR', () => {
    assert.deepEqual(splitExperienceOrbValues(5), [3, 1, 1]);
    assert.deepEqual(splitExperienceOrbValues(2500), [2477, 17, 3, 3]);
    assert.deepEqual(splitExperienceOrbValues(-1), []);
});

test('experience orb homes to the player, awards XP once, and despawns at 6000 ticks', () => {
    const player = {
        x: 0, y: 0, z: 0, height: 1.8, xpPickupCooldown: 0,
        addExperiencePoints(amount) { this.points = (this.points ?? 0) + amount; }
    };
    const world = {
        entities: [], getCollisionBoxes: () => [],
        removeEntityById(id) { this.entities = this.entities.filter(entity => entity.id !== id); }
    };
    const orb = new ExperienceOrbEntity({ player }, world, 0.2, 0.5, 0, 3);
    orb.id = 4;
    world.entities.push(orb);
    orb.onEntityUpdate();
    assert.equal(player.points, 3);
    assert.equal(player.xpPickupCooldown, 2);
    assert.equal(orb.isDead, true);
    orb.age = 5999;
    orb.isDead = false;
    orb.onEntityUpdate();
    assert.equal(orb.isDead, true);
});

test('XP orb uses the shipped animated vanilla sprite in the entity renderer', () => {
    const path = 'terrain/pack/minecraft/textures/entity/experience_orb.png';
    assert.ok(uiTextures.includes(path));
    assert.ok(existsSync(resolve('src/resources', path)));
    const renderer = new ExperienceOrbRenderer({
        camera: new THREE.PerspectiveCamera(),
        minecraft: { resources: {} }
    });
    const orb = new ExperienceOrbEntity({}, {}, 0, 1, 0, 1);
    renderer.render(orb, 0.5);
    assert.equal(renderer.group.visible, true);
    assert.equal(renderer.sprite.material.color.getHex(), 0x73ff52, 'missing texture falls back to a visible emissive orb');
});

test('undead grant five XP in 3/1/1 orbs only with recent player credit and mob drops enabled', () => {
    if (!BlockRegistry.init) BlockRegistry.create();
    const world = {
        entities: [], getBlockAt: () => 0, getFluidState: () => ({ empty: true }),
        getCollisionBoxes: () => [],
        addEntity(entity) { if (entity.id === -2) entity.id = this.entities.length + 1; this.entities.push(entity); },
        removeEntityById(id) { this.entities = this.entities.filter(entity => entity.id !== id); }
    };
    const minecraft = { worldRenderer: { entityRenderManager: { createEntityRendererByEntity: () => ({ group: {} }) } } };
    const zombie = createMobEntity(minecraft, world, 'zombie', { x: 0, y: 64, z: 0 });
    world.addEntity(zombie);
    zombie.lastHurtByPlayerTicks = 100;
    zombie.die();
    assert.deepEqual(world.entities.filter(entity => entity instanceof ExperienceOrbEntity).map(orb => orb.value), [3, 1, 1]);

    const drowned = createMobEntity(minecraft, world, 'drowned', { x: 0, y: 64, z: 0 });
    world.addEntity(drowned);
    drowned.lastHurtByPlayerTicks = 100;
    world.mobDrops = false;
    const entitiesBeforeGameruleKill = world.entities.length;
    drowned.die();
    assert.equal(world.entities.length, entitiesBeforeGameruleKill, 'MOB_DROPS=false suppresses both item loot and XP orbs');
    assert.equal(world.entities.filter(entity => entity instanceof ExperienceOrbEntity).length, 3);
});

test('XP HUD draws the JAR 182x5 background and clipped progress width', () => {
    const calls = [];
    const overlay = Object.create(IngameOverlay.prototype);
    overlay.window = { width: 320, height: 240 };
    overlay.minecraft = { player: { experienceProgress: 0.5, experienceLevel: 3 } };
    overlay.nativeHud = { experience_bar_background: 'bg', experience_bar_progress: 'progress' };
    overlay.drawSprite = (_, texture, ...args) => calls.push({ texture, args });
    overlay.drawCenteredString = (_, text, x, y, color) => calls.push({ text, x, y, color });
    overlay.renderExperience({});
    assert.deepEqual(calls[0], { texture: 'bg', args: [0, 0, 182, 5, 69, 211, 182, 5] });
    assert.deepEqual(calls[1], { texture: 'progress', args: [0, 0, 91, 5, 69, 211, 91, 5] });
    assert.equal(calls.filter(call => call.text === '3').length, 5);
});
