import test from 'node:test';
import assert from 'node:assert/strict';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import ItemStack from '../../../src/js/net/minecraft/client/item/ItemStack.js';
import ItemSword from '../../../src/js/net/minecraft/client/world/block/type/ItemSword.js';
import BoundingBox from '../../../src/js/net/minecraft/util/BoundingBox.js';
import EnumBlockFace from '../../../src/js/net/minecraft/util/EnumBlockFace.js';
import CraftingRegistry from '../../../src/js/net/minecraft/client/crafting/CraftingRegistry.js';
import { isExcludedVanillithContent } from '../content-policy.mjs';
import { acceptedDamage, applyAttackKnockback } from '../combat.mjs';
import { getBlockMiningTicks } from '../mining.mjs';
import visuals from '../generated/item-visuals.json' with { type: 'json' };
import { atlasItemTextures } from '../../../src/js/assetManifest.js';

globalThis.window = { addEventListener() {} };
globalThis.document = { addEventListener() {} };
const { default: Minecraft } = await import('../../../src/js/net/minecraft/client/Minecraft.js');

test('playable Vanillith right-click places a block and consumes one item; spectator/debug remains read-only', () => {
    const block = new Block(750001);
    block.canPlaceAt = () => true; block.onBlockPlaced = () => {};
    block.getSound = () => ({ getStepSound: () => 'step.stone', getPitch: () => 1 });
    let consumed = 0;
    const stack = new ItemStack(block.id, 4);
    const writes = [];
    const minecraft = Object.assign(Object.create(Minecraft.prototype), {
        world: { vanillaPreview: true, vanillithPlayable: true, mobCombatEnabled: true,
            getBlockAt: () => 0, setBlockAt: (...args) => writes.push(args) },
        window: { isLocked: () => true }, timer: { partialTicks: 1 },
        soundManager: { playSound() {} }, isSingleplayer: () => true,
        worldRenderer: {},
        player: { creative: false, spectator: false, swingArm() {},
            boundingBox: new BoundingBox(10, 10, 10, 11, 12, 11),
            rayTrace: () => ({ x: 0, y: 63, z: 0, face: EnumBlockFace.TOP }),
            inventory: { getItemInSelectedSlot: () => stack, selectedSlotIndex: 0,
                removeItem: (_id, count) => { consumed += count; } } }
    });
    minecraft.onMouseClicked(2);
    assert.equal(writes.length, 1);
    assert.deepEqual(writes[0].slice(0, 4), [0, 64, 0, block.id]);
    assert.equal(consumed, 1);
    minecraft.world.vanillithPlayable = false;
    minecraft.onMouseClicked(2);
    assert.equal(writes.length, 1, 'terrain-only debug stays read-only');
});

test('actual client sword hit applies durability and emits a charged falling critical', () => {
    const sword = new ItemSword(750002, 'wooden_sword', 'Wooden Sword', 'wood');
    const stack = new ItemStack(sword.id, 1);
    let criticals = 0, inflicted = 0;
    const mob = { x: 0, z: 2, onGround: true, motionX: 0, motionY: 0, motionZ: 0,
        horizontalMotionSign: -1, damageEntity(amount) { inflicted = amount; return amount; } };
    const player = { x: 0, z: 0, rotationYaw: 0, creative: false, spectator: false,
        username: 'test', fallDistance: 1, onGround: false, isInWater: () => false,
        motionX: 0, motionZ: 0, getAttackStrengthScale: () => 1, resetAttackStrengthTicker() {},
        getAttackAnimation() {}, swingArm() {}, rayTrace: () => null,
        foodData: { addExhaustion() {} }, inventory: { getItemInSelectedSlot: () => stack, notifyInventoryChanged() {} } };
    const minecraft = Object.assign(Object.create(Minecraft.prototype), {
        player, world: { vanillaPreview: true, vanillithPlayable: true, mobCombatEnabled: true },
        window: { isLocked: () => true }, timer: { partialTicks: 1 }, isSingleplayer: () => true,
        itemRenderer: { destroy() {}, scheduleDirty() {} },
        particleRenderer: { emitCriticalHit: () => criticals++ }, rayTraceEntity: () => mob
    });
    minecraft.onMouseClicked(0);
    assert.equal(inflicted, 6);
    assert.equal(stack.damage, 1);
    assert.equal(criticals, 1);
    assert.ok(mob.motionZ < 0, 'internal living velocity moves away');
});

test('sprint extra knockback uses facing and stronger cooldown damage does not repeat base hurt lift', () => {
    const target = { x: 2, z: 0, health: 20, onGround: true, motionX: 0, motionY: 0, motionZ: 0 };
    const attacker = { x: 0, z: 0, rotationYaw: 0, motionX: 1, motionZ: 1 };
    acceptedDamage(target, 4);
    applyAttackKnockback(target, attacker, { knockback: .4, extraKnockback: .5 });
    assert.equal(target.motionX, .2); assert.equal(target.motionZ, .5);
    assert.equal(attacker.motionX, .6);
    target.motionY = .1;
    acceptedDamage(target, 6);
    applyAttackKnockback(target, attacker, { knockback: .4 });
    assert.equal(target.motionY, .1);
});

test('Pale Garden content is excluded from crafting without breaking reference state decoding', () => {
    for (const name of ['pale_oak_log', 'stripped_pale_oak_wood', 'pale_oak_boat', 'pale_moss_block',
        'pale_hanging_moss', 'creaking_heart', 'resin_clump', 'chiseled_resin_bricks']) {
        assert.equal(isExcludedVanillithContent(`minecraft:${name}`), true);
        assert.equal(CraftingRegistry.resolveItemId(`minecraft:${name}`), null);
    }
    assert.equal(isExcludedVanillithContent('minecraft:dark_oak_log'), false);
});

test('JAR sprite item catalog has atlas coverage and registers independently of recipes', () => {
    assert.ok(Object.keys(visuals.items).length >= 500);
    for (const name of visuals.textures) assert.ok(atlasItemTextures.includes(`${name}.png`), name);
    for (const name of Object.keys(visuals.items)) assert.equal(isExcludedVanillithContent(name), false);
    const id = CraftingRegistry.resolveItemId('minecraft:bow');
    assert.ok(Number.isInteger(id));
    assert.deepEqual(Block.getById(id).itemDisplay.thirdperson_righthand.rotation, [-80, 260, -40]);
    assert.equal(Block.getById(id).inventoryTab.id, 6, 'bow appears in the combat tab, not only search');
});

test('survival mining keeps tool speed, airborne and underwater penalties', () => {
    const stone = { getHardness: () => 1.5, getPreferredToolType: () => 'pickaxe', requiresToolForDrops: true };
    const tool = { material: 'iron', toolType: 'pickaxe' };
    const ground = getBlockMiningTicks(stone, tool);
    assert.equal(getBlockMiningTicks(stone, tool, { onGround: false, underwater: true }), Math.ceil(1.5 * 30 / (6 / 25)));
    assert.ok(getBlockMiningTicks(stone, tool, { haste: 1 }) < ground);
    assert.ok(getBlockMiningTicks(stone, tool, { fatigue: 1 }) > ground);
});
