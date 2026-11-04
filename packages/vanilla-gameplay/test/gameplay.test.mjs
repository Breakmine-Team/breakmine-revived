import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import sharp from 'sharp';
import reference from '../generated/gameplay.json' with { type: 'json' };
import { nativeItemStats, attackResult, acceptedDamage, applyKnockback, combatTooltip } from '../combat.mjs';
import FoodData from '../food.mjs';
import { halfHeartState } from '../hud.mjs';
import { resolvePlayerAttack, startFoodUse, finishFoodUse, tickCombatPlayer } from '../../../src/js/net/minecraft/server/Combat.js';
import ItemSword from '../../../src/js/net/minecraft/client/world/block/type/ItemSword.js';
import ItemApple from '../../../src/js/net/minecraft/client/world/block/type/ItemApple.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import EntityLiving from '../../../src/js/net/minecraft/client/entity/EntityLiving.js';
import PlayerEntity from '../../../src/js/net/minecraft/client/entity/PlayerEntity.js';
import EntityRenderer from '../../../src/js/net/minecraft/client/render/entity/EntityRenderer.js';
import ModelPlayer from '../../../src/js/net/minecraft/client/render/model/model/ModelPlayer.js';
import { vanillaBlockFoliageColor } from '../../../src/js/net/minecraft/client/render/VanillaTerrainRenderer.js';
import * as THREE from '../../../libraries/three.module.js';

const sword = material => ({ toolType: 'sword', material, isTool: true });
test('JAR attributes replace material-index damage and drive tooltip/cooldown', () => {
    assert.equal(nativeItemStats(sword('diamond')).attackDamage, 7);
    assert.equal(nativeItemStats(sword('gold')).attackDamage, 4);
    assert.equal(nativeItemStats(sword('wood')).attackDamage, 4);
    assert.equal(nativeItemStats(null).attackDamage, 1);
    assert.match(combatTooltip(sword('iron')), /6 Attack Damage\n§2 1.6 Attack Speed/);
    assert.ok(Math.abs(20 / nativeItemStats(sword('iron')).attackSpeed - 12.5) < 0.000001);
});
test('fully charged falling attacks crit; sprint, water and weak hits cannot crit', () => {
    const falling = { fallDistance: 1, onGround: false };
    assert.equal(attackResult(sword('diamond'), 1, falling).damage, 10.5);
    assert.equal(attackResult(null, 1, falling).damage, 1.5);
    for (const state of [{ sprinting: true }, { inWater: true }, { onClimbable: true }, { onGround: true }, { blind: true }])
        assert.equal(attackResult(sword('diamond'), 1, { ...falling, ...state }).critical, false);
    assert.equal(attackResult(sword('diamond'), 0, falling).damage, 1.4000000000000001);
    assert.equal(attackResult(sword('diamond'), 0.9, falling).critical, false);
    assert.equal(attackResult(sword('diamond'), 1, { onGround: true }).sweep, true);
});
test('hurt resistance accepts stronger-hit difference but blocks click-spam damage', () => {
    const target = { health: 20 };
    assert.equal(acceptedDamage(target, 4), 4);
    assert.equal(acceptedDamage(target, 4), 0);
    assert.equal(acceptedDamage(target, 7), 3);
    target.invulnerableTime = 10;
    assert.equal(acceptedDamage(target, 4), 4);
    assert.equal(acceptedDamage(target, NaN), 0);
    assert.deepEqual(applyKnockback({ x: 0, z: 0, onGround: true }, { x: 0, z: 0 }), { x: 0, y: 0.4, z: 0.4 });
});
test('JAR out-of-world damage bypasses the ordinary hurt cooldown', () => {
    const target = { health: 20, invulnerableTime: 18, lastHurtDamage: 7 };
    assert.equal(acceptedDamage(target, 4, { bypassInvulnerability: true }), 4);
    assert.equal(target.invulnerableTime, 18);
    assert.equal(target.lastHurtDamage, 7);
});
test('player lava wall collision gets the JAR jump-out impulse when overhead is clear', () => {
    const player = Object.assign(Object.create(PlayerEntity.prototype), {
        motionX: 0.2, motionY: 0, motionZ: 0.1, boundingBox: { offset: () => ({}) },
        world: { getCollisionBoxes: () => [] }, moveRelative() {}, moveCollide: () => true
    });
    player.travelInLava(0, 0, 0);
    assert.equal(player.motionY, Math.fround(0.3));
    assert.equal(player.motionX, 0.1);
});
test('player swim pose eases in like the JAR and animates the humanoid model', () => {
    const player = Object.assign(Object.create(PlayerEntity.prototype), { prevSwimAmount: 0.36, swimAmount: 0.45 });
    assert.equal(player.getSwimAmount(0.5), 0.405);
    const model = new ModelPlayer();
    model.swimAmount = 1;
    model.setRotationAngles({ translateY() {} }, 7, 0, 5, 0, 0, 1);
    assert.equal(model.body.rotateAngleX, 0, 'JAR tilts the complete entity, not just the torso');
    assert.ok(Math.abs(model.head.rotateAngleX + Math.PI / 4) < 1e-9);
    assert.notEqual(model.rightArm.rotateAngleZ, model.leftArm.rotateAngleZ);
});
test('26.3 cherry leaves keep their pink texture instead of receiving biome foliage tint', () => {
    assert.equal(vanillaBlockFoliageColor(null, 'minecraft:cherry_leaves', 0, 0, 0), 0xffffff);
});
test('actual living-entity damage keeps environmental death causes and shares hurt resistance', () => {
    let deaths = 0;
    const target = Object.assign(Object.create(EntityLiving.prototype), { health: 2,
        minecraft: { player: null }, typeOfDeath: 'hit the ground too hard', die() { deaths++; } });
    assert.equal(target.damageEntitySimple(2), 2);
    assert.equal(target.typeOfDeath, 'hit the ground too hard');
    assert.equal(target.damageEntitySimple(2), 0);
    assert.equal(deaths, 1);
});
test('server calculates PvP from its inventory, checks reach/walls and publishes absolute health once', () => {
    const weapon = new ItemSword(1800, 'iron_sword', 'Iron Sword', 'iron');
    const player = { eid: 1, username: 'a', x: 0, y: 64, z: 0, health: 20, gamemode: 0, onGround: true,
        attackStrengthTicker: 20, foodData: new FoodData(), inventory: { selectedSlotIndex: 0, items: [{ typeId: weapon.id, count: 1 }] } };
    const target = { eid: 2, x: 2, y: 64, z: 0, health: 20, gamemode: 0, onGround: true };
    const players = new Map([[1, player],[2,target]]), world = { getBlockAt: () => 0 };
    const hits = resolvePlayerAttack(player, 2, players, world);
    assert.equal(hits.length, 1); assert.equal(hits[0].health, 14); assert.equal(hits[0].damage, 6);
    assert.equal(player.inventory.items[0].damage, 1, 'a successful JAR melee hit wears the sword once');
    assert.equal(player.attackStrengthTicker, 0);
    assert.equal(resolvePlayerAttack(player, 2, players, world).length, 0);
    target.x = 8; target.invulnerableTime = 0; player.attackStrengthTicker = 20;
    assert.equal(resolvePlayerAttack(player, 2, players, world).length, 0);
    target.x = 2; player.attackStrengthTicker = 20;
    const solid = new Block(1801);
    assert.equal(resolvePlayerAttack(player, 2, players, { getBlockAt: () => solid.id }).length, 0);
    target.gamemode = 1; player.attackStrengthTicker = 20;
    assert.equal(resolvePlayerAttack(player, 2, players, world).length, 0);
});
test('server consumption requires a complete use duration and matching slot; food regenerates instead of healing instantly', () => {
    const apple = new ItemApple(1802, 0);
    const player = { health: 10, gamemode: 0, foodData: new FoodData({ foodLevel: 16, saturationLevel: 0 }),
        inventory: { selectedSlotIndex: 0, items: [{ typeId: apple.id, count: 2 }] } };
    startFoodUse(player, 0); assert.equal(finishFoodUse(player, 3), false);
    startFoodUse(player, 4); assert.equal(finishFoodUse(player, 36), true);
    assert.equal(player.health, 10); assert.equal(player.foodData.foodLevel, 20);
    assert.equal(player.foodData.saturationLevel, 2.4); assert.equal(player.inventory.items[0].count, 1);
    for (let i = 0; i < 10; i++) tickCombatPlayer(player);
    assert.equal(player.health, 10.4);
});
test('food exhaustion, saturation, starvation and saved state follow FoodData constants', () => {
    const food = new FoodData(); const player = { health: 20 };
    food.addExhaustion(4); food.tick(player); assert.equal(food.saturationLevel, 5);
    food.addExhaustion(0.1); food.tick(player); assert.equal(food.saturationLevel, 4);
    const empty = new FoodData({ foodLevel: 0, saturationLevel: 0 });
    player.health = 1; player.damageEntity = amount => player.health -= amount;
    for (let i=0;i<80;i++) empty.tick(player); assert.equal(player.health, 1);
    for (let i=0;i<80;i++) empty.tick(player,{difficulty:'hard'}); assert.equal(player.health, 0);
    assert.deepEqual(new FoodData(food.snapshot()).snapshot(), food.snapshot());
});
test('odd and fractional HP/food use vanilla half icons with no missing nineteenth point', () => {
    assert.equal(halfHeartState(19,9), 'half'); assert.equal(halfHeartState(18,9), null);
    assert.equal(halfHeartState(18.1,9), 'half'); assert.equal(halfHeartState(1,0), 'half');
    assert.equal(halfHeartState(0,0), null); assert.equal(halfHeartState(20,9), 'full');
});
test('native HUD PNGs exactly match the pinned JAR and their intended pixel dimensions', async () => {
    const bytes = await readFile('/home/_doxism/minecraft-client-26.3.jar');
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    assert.equal(hash(bytes), reference.source.sha256);
    const zip = await JSZip.loadAsync(bytes);
    for (const [name, sprite] of Object.entries(reference.sprites)) {
        const png = await zip.file(sprite.resource).async('nodebuffer');
        assert.equal(hash(png), sprite.sha256);
        assert.deepEqual(png, Buffer.from(sprite.dataUrl.split(',')[1], 'base64'));
        const info = await sharp(png).metadata();
        assert.deepEqual([info.width,info.height], name === 'hotbar' ? [182,22] : name === 'hotbar_selection' ? [24,23] : [9,9]);
    }
});
test('actual entity renderer restores held-item light instead of resetting it to emissive white', () => {
    const renderer = new EntityRenderer({ render() {} });
    renderer.prepareModel = () => {};
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    mesh.userData.dynamicHeldItemLight = true; renderer.group.add(mesh);
    let brightness = 0.15;
    const entity = { renderer, getEntityBrightness: () => brightness };
    for (const key of ['prevRenderYawOffset','renderYawOffset','prevRotationYawHead','rotationYawHead','prevLimbSwingStrength','limbSwingStrength','limbSwingProgress','prevRotationPitch','rotationPitch','prevX','x','prevY','y','prevZ','z','ticksExisted']) entity[key] = 0;
    renderer.render(entity, 0);
    assert.equal(mesh.material.color.r, 0.15);
    brightness = 0.8; renderer.render(entity, 0); assert.equal(mesh.material.color.r, 0.8);
});
