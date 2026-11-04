import test from 'node:test';
import assert from 'node:assert/strict';
import FoodData from '../food.mjs';

// Import the client without launching a canvas or opening a connection.
globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
const { default: NetworkManager } = await import('../../../src/js/net/minecraft/client/network/NetworkManager.js');
const { default: IngameOverlay } = await import('../../../src/js/net/minecraft/client/gui/overlay/IngameOverlay.js');

test('real JSON handler applies authoritative hit health once, velocity, death and hunger updates', () => {
    let deaths = 0;
    const player = { id: 2, health: 20, foodData: new FoodData(), renderer: {}, die() { deaths++; } };
    const minecraft = { player, world: { getEntityById: () => null } };
    const network = Object.create(NetworkManager.prototype); network.minecraft = minecraft;
    const hit = { type: 'combat:hit', eid: 2, attackerId: 1, attacker: 'other', health: 14,
        damage: 6, hurtDamage: 6, velocity: { x: 0.4, y: 0.4, z: 0 } };
    network._onJsonMessage(JSON.stringify(hit));
    network._onJsonMessage(JSON.stringify(hit));
    assert.equal(player.health, 14);
    assert.equal(player.lastHurtDamage, 6);
    assert.equal(player.motionX, 0.4); assert.equal(player.motionY, 0.4);
    assert.ok(player.renderer.hurtTimestamp > 0);
    network._onJsonMessage(JSON.stringify({ type: 'vitals', health: 14.5, food: { foodLevel: 17, saturationLevel: 2 } }));
    assert.equal(player.health, 14.5); assert.equal(player.foodData.foodLevel, 17);
    network._onJsonMessage(JSON.stringify({ ...hit, health: 0 }));
    network._onJsonMessage(JSON.stringify({ ...hit, health: 0 }));
    assert.equal(deaths, 1); assert.equal(player.typeOfDeath, 'was slain by other');
    network.minecraft.player = null;
    network._onJsonMessage(JSON.stringify({ type: 'vitals', health: 20, food: { foodLevel: 19 } }));
    assert.equal(network.pendingVitals.food.foodLevel, 19);
});

test('actual HUD draws half icons, native hotbar bounds and does not lose odd health/food points', () => {
    const sprites = [], rectangles = [];
    const hud = Object.create(IngameOverlay.prototype);
    hud.minecraft = { player: { health: 19, hurtTime: 0, foodData: new FoodData({ foodLevel: 17 }),
        inventory: { selectedSlotIndex: 8, getItemInSlot: () => ({ isEmpty: () => true }) } },
        isPaused: () => false, itemRenderer: { prepareRender() {} } };
    hud.nativeHud = { hotbar: 'bar', hotbar_selection: 'selection' };
    hud.lastHealth = hud.displayHealth = 19; hud.healthChangedAt = performance.now(); hud.healthBlinkUntil = 0;
    hud.drawHudSprite = (_, name, x, y) => sprites.push({ name, x, y });
    hud.drawSprite = (_, image, ...args) => rectangles.push({ image, args });
    hud.renderHealth({}, 10, 50); hud.renderFood({}, 192, 50); hud.renderHotbar({}, 10, 67);
    assert.equal(sprites.filter(s => s.name === 'heart/full').length, 9);
    assert.equal(sprites.filter(s => s.name === 'heart/half').length, 1);
    assert.equal(sprites.filter(s => s.name === 'food_full').length, 8);
    assert.equal(sprites.filter(s => s.name === 'food_half').length, 1);
    assert.deepEqual(rectangles[0], { image: 'bar', args: [0,0,182,22,10,67,182,22] });
    assert.deepEqual(rectangles[1], { image: 'selection', args: [0,0,24,23,169,66,24,23] });
});
