import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { entityFluidDepth, fluidSurfaceHeight, pointInFluid, fluidFallingVelocity, travelInWater, travelInLava, waterVision } from '../movement.mjs';
import PlayerEntity from '../../../src/js/net/minecraft/client/entity/PlayerEntity.js';
import { createMobEntity } from '../../../src/js/net/minecraft/client/entity/MobEntity.js';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';
import ModelPlayer from '../../../src/js/net/minecraft/client/render/model/model/ModelPlayer.js';
import waterView from '../generated/water-view.json' with { type: 'json' };

const water = { name: 'water', level: 0 };
function movingEntity(overrides = {}) {
    return { x: .5, y: .1, z: .5, motionX: .1, motionY: 0, motionZ: 0, sprinting: false,
        world: { getFluidState: (_x, y) => y === 0 ? water : null, getCollisionBoxes: () => [] },
        boundingBox: new BoundingBox(.2, .1, .2, .8, 1.9, .8),
        moveRelative() {}, moveCollide() { return false; }, ...overrides };
}

test('source, flowing and covered fluids use the JAR amount/9 surface', () => {
    const world = { getFluidState: () => null };
    assert.equal(fluidSurfaceHeight(world, 0, 0, 0, water), Math.fround(8 / 9));
    assert.equal(fluidSurfaceHeight(world, 0, 0, 0, { name: 'water', level: 7 }), Math.fround(1 / 9));
    assert.equal(fluidSurfaceHeight({ getFluidState: () => water }, 0, 0, 0, water), 1);
    assert.equal(pointInFluid({ getFluidState: () => water }, .5, .9, .5, 'water'), true);
    assert.equal(pointInFluid({ getFluidState: (_x, y) => y === 0 ? water : null }, .5, .9, .5, 'water'), false);
});

test('fluid contact sees a hitbox edge even when the center block is dry', () => {
    const entity = movingEntity({ x: 1.1, boundingBox: new BoundingBox(.8, .5, .2, 1.4, 2.3, .8) });
    entity.world.getFluidState = (x, y) => x === 0 && y === 0 ? water : null;
    assert.ok(entityFluidDepth(entity, 'water') > .38);
    assert.equal(pointInFluid(entity.world, 1.1, .6, .5, 'water'), false);
});

test('contact reuse eliminates repeated body scans and expires on movement and tick', () => {
    let reads = 0;
    const entity = movingEntity({ ticksExisted: 1 });
    const lookup = entity.world.getFluidState;
    entity.world.getFluidState = (...args) => { reads++; return lookup(...args); };
    entityFluidDepth(entity, 'water');
    const first = reads;
    for (let i = 0; i < 100; i++) {
        entityFluidDepth(entity, 'water'); entityFluidDepth(entity, 'lava');
    }
    assert.equal(reads, first);
    entity.boundingBox.move(.1, 0, 0);
    entityFluidDepth(entity, 'water');
    assert.ok(reads > first);
    const moved = reads;
    entity.ticksExisted++;
    entityFluidDepth(entity, 'water');
    assert.ok(reads > moved);
});

test('26.3 water uses float drag, gravity/16, and no falling gravity while sprinting', () => {
    const entity = movingEntity();
    travelInWater(entity, 0, 0, 0);
    assert.equal(entity.motionX, .1 * Math.fround(.8));
    assert.equal(entity.motionY, -.005);
    const sprint = movingEntity({ sprinting: true });
    travelInWater(sprint, 0, 0, 0);
    assert.equal(sprint.motionX, .1 * Math.fround(.9));
    assert.equal(sprint.motionY, 0);
    assert.equal(fluidFallingVelocity(.012, .16, false, true), -.003);
});

test('water movement efficiency is halved off ground; dolphins grace overrides drag', () => {
    let acceleration;
    const entity = movingEntity({ waterMovementEfficiency: 1, getAIMoveSpeed: () => .1,
        moveRelative: (_f, _v, _s, a) => { acceleration = a; } });
    travelInWater(entity, 0, 0, 0);
    assert.ok(acceleration > .059 && acceleration < .061);
    const grace = movingEntity({ statusEffects: new Map([['dolphins_grace', {}]]) });
    travelInWater(grace, 0, 0, 0);
    assert.equal(grace.motionX, .1 * Math.fround(.96));
});

test('water and lava both use the JAR wall exit impulse and reject blocked/wet exits', () => {
    for (const travel of [travelInWater, travelInLava]) {
        const entity = movingEntity({ moveCollide: () => true });
        entity.world.getFluidState = () => null;
        travel(entity, 0, 0, 0);
        assert.equal(entity.motionY, Math.fround(.3));
        const blocked = movingEntity({ moveCollide: () => true });
        blocked.world.getCollisionBoxes = () => [{}];
        travel(blocked, 0, 0, 0);
        assert.notEqual(blocked.motionY, Math.fround(.3));
    }
    const wet = movingEntity({ moveCollide: () => true });
    wet.world.getFluidState = () => water;
    travelInWater(wet, 0, 0, 0);
    assert.notEqual(wet.motionY, Math.fround(.3));
});

test('shallow lava and deep lava retain distinct vertical damping', () => {
    const shallow = movingEntity({ motionY: .1 });
    shallow.world.getFluidState = (_x, y) => y === 0 ? { name: 'lava', level: 7 } : null;
    travelInLava(shallow, 0, 0, 0);
    assert.ok(Math.abs(shallow.motionY - (.1 * Math.fround(.8) - .005 - .02)) < 1e-12);
    const deep = movingEntity({ motionY: .1 });
    deep.world.getFluidState = () => ({ name: 'lava', level: 0 });
    travelInLava(deep, 0, 0, 0);
    assert.equal(deep.motionY, .1 * .5 - .08 / 4);
});

test('swim entry requires submerged eyes; existing swimming can continue at the surface', () => {
    const player = Object.assign(Object.create(PlayerEntity.prototype), { sprinting: true, flying: false,
        isInWater: () => true, isHeadInWater: () => false, swimming: false });
    player.updateSwimming();
    assert.equal(player.swimming, false);
    player.isHeadInWater = () => true;
    player.updateSwimming();
    assert.equal(player.swimming, true);
    player.isHeadInWater = () => false;
    player.updateSwimming();
    assert.equal(player.swimming, true);
    player.flying = true;
    player.updateSwimming();
    assert.equal(player.swimming, false);
});

test('swim hitbox/eyes fit tunnels and standing resumes only with overhead clearance', () => {
    let ceiling = 1;
    const player = Object.assign(Object.create(PlayerEntity.prototype), { swimming: true, height: 1.8,
        boundingBox: new BoundingBox(0, 0, 0, .6, 1.8, .6), isSneaking: () => false,
        world: { getCollisionBoxes: box => box.maxY > ceiling ? [{}] : [] } });
    player.updatePlayerPose();
    assert.equal(player.height, .6);
    assert.equal(player.getEyeHeight(), .4);
    player.swimming = false;
    player.updatePlayerPose();
    assert.equal(player.height, .6);
    ceiling = 3;
    player.updatePlayerPose();
    assert.equal(player.height, 1.8);
    assert.equal(player.getEyeHeight(), 1.62);
});

test('player swim stroke uses movement phase, respects attack arm, and resets after exiting', () => {
    const model = new ModelPlayer();
    model.swimAmount = 1;
    const setup = (phase, time) => model.setRotationAngles({ translateY() {} }, phase, 0, time, 0, 0, 1);
    setup(18, 0);
    assert.ok(Math.abs(model.rightArm.rotateAngleX - Math.PI / 4) < 1e-9);
    const stroke = model.rightArm.rotateAngleX;
    setup(18, 1000);
    assert.equal(model.rightArm.rotateAngleX, stroke);
    model.swimAmount = 0;
    setup(18, 0);
    assert.equal(model.body.rotateAngleX, 0);
    assert.equal(model.head.rotateAngleX, 0);
});

test('Mob MOVE_TO supplies attribute speed as input and converges to normal walking speed', () => {
    const mob = createMobEntity({ player: null }, {}, 'zombie', { x: 0, y: 64, z: 0 });
    mob.navigateTo({ x: 10, y: 64, z: 0 });
    assert.equal(mob.moveForward, .23);
    mob.moveCollide = function(dx, dy, dz) { this.x += dx; this.y += dy; this.z += dz; return false; };
    for (let tick = 0; tick < 100; tick++) {
        mob.onGround = true;
        mob.travel(.23 * .98, 0, 0);
    }
    const blocksPerSecond = Math.hypot(mob.motionX, mob.motionZ) / (.6 * .91) * 20;
    assert.ok(blocksPerSecond > 2.2 && blocksPerSecond < 2.4, `${blocksPerSecond} blocks/s`);
});

test('underwater vision follows both JAR adaptation ramps', () => {
    assert.equal(waterVision(0), 0);
    assert.equal(waterVision(50), .3);
    assert.equal(waterVision(100), .6);
    assert.equal(waterVision(350), .8);
    assert.equal(waterVision(600), 1);
});

test('water fog biome values are extracted from the exact pinned JAR', async () => {
    const bytes = await readFile('/home/_doxism/minecraft-client-26.3.jar');
    assert.equal(createHash('sha256').update(bytes).digest('hex'), waterView.sourceSha256);
    const jar = await JSZip.loadAsync(bytes);
    for (const view of Object.values(waterView.biomes)) {
        const biome = JSON.parse(await jar.file(`data/minecraft/worldgen/biome/${view.name.slice(10)}.json`).async('string'));
        const color = biome.attributes?.['minecraft:visual/water_fog_color'];
        assert.equal(view.color, color ? parseInt(color.slice(1), 16) : waterView.defaults.color);
    }
});
