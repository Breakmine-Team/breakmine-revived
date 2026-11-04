import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import * as THREE from '../../../libraries/three.module.js';
import { BlockRegistry } from '../../../src/js/net/minecraft/client/world/block/BlockRegistry.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import CraftingRegistry from '../../../src/js/net/minecraft/client/crafting/CraftingRegistry.js';
import BlockRenderer from '../../../src/js/net/minecraft/client/render/BlockRenderer.js';
import MobArrowRenderer from '../../../src/js/net/minecraft/client/render/entity/entity/MobArrowRenderer.js';
import ItemEdible from '../../../src/js/net/minecraft/client/world/block/ItemEdible.js';
import FoodData from '../food.mjs';
import { startFoodUse, finishFoodUse } from '../../../src/js/net/minecraft/server/Combat.js';
import { canHarvestBlock, getBlockMiningTicks } from '../mining.mjs';
import { nativeItemStats } from '../combat.mjs';
import reference from '../generated/gameplay.json' with { type: 'json' };
import visuals from '../generated/item-visuals.json' with { type: 'json' };

BlockRegistry.create();
CraftingRegistry.reset();
const item = name => Block.getById(CraftingRegistry.resolveItemId(`minecraft:${name}`));

test('complete JAR initializer import gives durable items and native attack animations their components', () => {
    assert.ok(Object.keys(reference.items).length > 1600);
    assert.equal(item('bow').getMaxStackSize(), 1);
    assert.equal(item('bow').durability, 384);
    assert.equal(item('trident').durability, 250);
    assert.equal(nativeItemStats(item('trident')).attackDamage, 9);
    assert.equal(item('netherite_pickaxe').durability, 2031);
    assert.equal(item('iron_spear').attackAnimation.type, 'stab');
    assert.ok(item('iron_spear').attackDurabilityDamage > 0);
});

test('all seven spear variants use distinct byte-identical JAR inventory and held textures', async () => {
    const zip = await JSZip.loadAsync(await readFile('/home/_doxism/minecraft-client-26.3.jar'));
    const hash = bytes => createHash('sha256').update(bytes).digest('hex');
    const display = JSON.parse(await zip.file('assets/minecraft/models/item/spear_in_hand.json').async('string')).display;
    for (const material of ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite']) {
        const name = `${material}_spear`, definition = item(name);
        assert.equal(definition.tex, name);
        assert.deepEqual(definition.getHeldTextureLayers(), [`${name}_in_hand`]);
        assert.deepEqual(visuals.items[`minecraft:${name}`].display.firstperson_righthand, display.firstperson_righthand);
        for (const texture of [name, `${name}_in_hand`]) {
            const local = await readFile(`src/resources/terrain/pack/minecraft/textures/items/${texture}.png`);
            const original = await zip.file(`assets/minecraft/textures/item/${texture}.png`).async('nodebuffer');
            assert.equal(hash(local), hash(original), texture);
        }
    }
});

test('held spear mesh preserves its 32px source instead of re-reading the downsampled atlas tile', () => {
    const oldDocument = globalThis.document;
    const draws = [], canvases = [];
    globalThis.document = { createElement() {
        const canvas = { width: 0, height: 0, getContext: () => ({
            drawImage: (...args) => draws.push(args),
            getImageData: () => ({ data: new Uint8Array(canvas.width * canvas.height * 4).fill(255) })
        }) }; canvases.push(canvas); return canvas;
    } };
    try {
        const icon = { width: 16, height: 16 }, held = { width: 32, height: 32 };
        const atlas = { isLoaded: () => true, canvas: {}, textureSize: 16, getTexture: () => null,
            sourceImages: new Map([['iron_spear', icon], ['iron_spear_in_hand', held]]) };
        const renderer = new BlockRenderer({ textureAtlas: atlas });
        const mesh = renderer.createGeneratedItemMesh(item('iron_spear'), 1, true);
        assert.equal(canvases[0].width, 32); assert.equal(canvases[0].height, 32);
        assert.equal(draws[0][0], held);
        assert.equal(mesh.material.map.image.width, 32);
        renderer.createGeneratedItemMesh(item('iron_spear'), 1);
        assert.equal(canvases[1].width, 16); assert.equal(draws[1][0], icon);
    } finally { globalThis.document = oldDocument; }
});

test('thrown trident uses textured JAR cuboids, correct scale and pitch offset', () => {
    const image = { width: 32, height: 32 };
    const renderer = new MobArrowRenderer({ minecraft: { resources: {
        'terrain/pack/minecraft/textures/entity/trident_model.png': image
    } } });
    assert.equal(renderer.tridentMeshes.length, 5);
    assert.ok(renderer.tridentMeshes.every(mesh => mesh.material.map === renderer.tridentTexture));
    renderer.render({ x: 0, y: 64, z: 0, prevX: 0, prevY: 64, prevZ: 0,
        rotationYaw: 90, rotationPitch: 0, projectileKind: 'trident' }, 1);
    assert.equal(renderer.group.rotation.z, Math.PI / 2);
    assert.equal(renderer.tridentModel.scale.y, 1 / 16);
    assert.equal(renderer.tridentModel.position.y, 0, 'projectiles do not inherit the held-item origin shift');
    assert.ok(renderer.arrowMeshes.every(mesh => !mesh.visible));
});

test('plain food imports are edible and fast foods use the JAR consumption duration', () => {
    const steak = item('cooked_beef');
    assert.ok(steak instanceof ItemEdible);
    assert.equal(nativeItemStats(steak).nutrition, 8);
    const kelp = item('dried_kelp');
    assert.equal(kelp.useDurationTicks, 16);
    const player = { health: 20, gamemode: 0, foodData: new FoodData({ foodLevel: 10, saturationLevel: 0 }),
        inventory: { selectedSlotIndex: 0, items: [{ typeId: kelp.id, count: 2 }] } };
    startFoodUse(player, 0);
    assert.equal(finishFoodUse(player, 14), false);
    assert.equal(player.inventory.items[0].count, 2);
    startFoodUse(player, 20);
    assert.equal(finishFoodUse(player, 35), true);
    assert.equal(player.foodData.foodLevel, 11);
    assert.equal(player.inventory.items[0].count, 1);
});

test('JAR tool rules drive native-block mining speeds and harvest eligibility, including copper/netherite', () => {
    const stone = { nativeBlockName: 'minecraft:stone', requiresToolForDrops: true,
        getHardness: () => 1.5, getPreferredToolType: () => 'pickaxe' };
    assert.equal(getBlockMiningTicks(stone, item('copper_pickaxe')), 9);
    assert.equal(getBlockMiningTicks(stone, item('netherite_pickaxe')), 5);
    const obsidian = { ...stone, nativeBlockName: 'minecraft:obsidian', getHardness: () => 50 };
    assert.equal(canHarvestBlock(obsidian, item('copper_pickaxe')), false);
    assert.equal(canHarvestBlock(obsidian, item('diamond_pickaxe')), true);
    assert.equal(canHarvestBlock(obsidian, item('netherite_pickaxe')), true);
});
