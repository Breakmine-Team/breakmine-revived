import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { BlockRegistry } from '../../../src/js/net/minecraft/client/world/block/BlockRegistry.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import ItemStack from '../../../src/js/net/minecraft/client/item/ItemStack.js';
import InventoryPlayer from '../../../src/js/net/minecraft/client/inventory/inventory/InventoryPlayer.js';
import ItemFood from '../../../src/js/net/minecraft/client/world/block/type/ItemFood.js';
import ItemTool from '../../../src/js/net/minecraft/client/world/block/type/ItemTool.js';
import EnumCreativeInventoryTab from '../../../src/js/net/minecraft/client/gui/EnumCreativeInventoryTab.js';
import SmeltingRegistry from '../../../src/js/net/minecraft/client/smelting/SmeltingRegistry.js';
import BlockGravel from '../../../src/js/net/minecraft/client/world/block/type/BlockGravel.js';
import { canHarvestBlock, getBlockMiningTicks, getVanillaMiningRule } from '../mining.mjs';
import { getVanillaBlockDrop, getVanillaBlockDrops } from '../block-drops.mjs';
import nativeBlockStates from '../../vanilla-worldgen/generated/block-states.json' with { type: 'json' };
import { atlasItemTextures } from '../../../src/js/assetManifest.js';
import { normalizeInventoryState } from '../../../src/js/net/minecraft/server/players.js';

test('block/item numeric IDs are unique, registered, and assigned a usable creative tab', () => {
    BlockRegistry.create();
    const objects = [...new Set(Object.values(BlockRegistry).filter(value =>
        value && typeof value === 'object' && Number.isInteger(value.id)))];
    const ids = new Map();

    for (const entry of objects) {
        const group = ids.get(entry.id) ?? [];
        group.push(entry);
        ids.set(entry.id, group);
        assert.equal(Block.getById(entry.id), entry, `ID ${entry.id} resolves to its registry entry`);
        assert.ok(Object.values(EnumCreativeInventoryTab).includes(entry.inventoryTab),
            `${entry.description ?? entry.id} has a valid creative tab`);
    }

    assert.deepEqual([...ids].filter(([, values]) => values.length > 1), []);
    assert.equal(BlockRegistry.ITEM_STICK.inventoryTab, EnumCreativeInventoryTab.MATERIALS);
    for (const [vanillaId, entry] of [
        ['minecraft:grass_block', BlockRegistry.GRASS],
        ['minecraft:oak_log', BlockRegistry.LOG],
        ['minecraft:oak_planks', BlockRegistry.WOOD],
        ['minecraft:golden_pickaxe', BlockRegistry.GOLD_PICKAXE],
        ['minecraft:raw_iron', BlockRegistry.ITEM_RAW_IRON],
        ['minecraft:spruce_log', BlockRegistry.SPRUCE_LOG],
        ['minecraft:birch_stairs', BlockRegistry.BIRCH_STAIRS],
        ['minecraft:light_blue_concrete_powder', BlockRegistry.LIGHT_BLUE_CONCRETE_POWDER],
        ['minecraft:black_dye', BlockRegistry.ITEM_BLACK_DYE],
        ['minecraft:oxeye_daisy', BlockRegistry.FLOWER_OXEYE_DAISY],
        ['minecraft:mossy_cobblestone_slab', BlockRegistry.MOSSY_COBBLESTONE_SLAB]
    ]) assert.equal(BlockRegistry.get(vanillaId), entry);
    assert.equal(BlockRegistry.get('minecraft:golden_pickaxe').id, BlockRegistry.GOLD_PICKAXE.id,
        'native aliases do not renumber existing save data');
});

test('vanilla aliases name real 26.3 blocks and their item icons exist in the atlas', () => {
    BlockRegistry.create();
    const nativeBlocks = new Set(nativeBlockStates.states.map(state => state.name));
    const atlasItems = new Set(atlasItemTextures.map(path => path.replace(/\.png$/, '')));
    const aliases = [...BlockRegistry.registry].filter(([key]) =>
        typeof key === 'string' && key.startsWith('minecraft:'));

    for (const [key, entry] of aliases) {
        if (entry.isItem?.()) {
            if (entry.modelTexture) continue;
            assert.ok(atlasItems.has(entry.getTextureForFace()), `${key} has an atlas texture`);
        } else {
            assert.ok(nativeBlocks.has(key), `${key} exists in the pinned native block registry`);
        }
    }
});

test('item stack limits and tool durability follow their item definitions', () => {
    BlockRegistry.create();
    assert.equal(new ItemStack(BlockRegistry.ITEM_BUCKET_EMPTY.id).getMaxStackSize(), 16);
    assert.equal(new ItemStack(BlockRegistry.ITEM_BUCKET_WATER.id).getMaxStackSize(), 1);
    assert.equal(new ItemStack(BlockRegistry.WOOD_PICKAXE.id).getMaxStackSize(), 1);
    assert.equal(new ItemStack(BlockRegistry.ITEM_BREAD.id).getMaxStackSize(), 64);
    assert.deepEqual(ItemTool.materialDurability, { wood: 59, stone: 131, iron: 250, diamond: 1561, gold: 32 });
});

test('tool damage survives stack copies and inventory saves, then breaks at max durability', () => {
    BlockRegistry.create();
    const inventory = new InventoryPlayer();
    const tool = new ItemStack(BlockRegistry.WOOD_PICKAXE.id, 1, 58);
    inventory.items[0] = tool;

    const copy = tool.copy();
    assert.equal(copy.damage, 58);
    assert.equal(copy.isItemEqual(new ItemStack(BlockRegistry.WOOD_PICKAXE.id)), false);

    const restored = new InventoryPlayer();
    restored.applyNetworkState(inventory.toNetworkState());
    assert.equal(restored.items[0].damage, 58);
    assert.equal(restored.items[0].damageItem(), true);
    assert.equal(restored.items[0].isEmpty(), true);
});

test('multiplayer inventory normalization preserves valid tool damage safely', () => {
    const state = normalizeInventoryState({
        selectedSlotIndex: 2,
        items: [{ typeId: 101, count: 1, damage: 42 }, { typeId: 91, count: 1, damage: -8 }]
    });
    assert.deepEqual(state.items.slice(0, 2), [
        { typeId: 101, count: 1, damage: 42 },
        { typeId: 91, count: 1 }
    ]);
    assert.equal(state.items[2].typeId, 0);
});

test('food items expose vanilla nutrition and their registered texture assets', () => {
    BlockRegistry.create();
    for (const [item, nutrition, saturation, texture] of [
        [BlockRegistry.ITEM_ROTTEN_FLESH, 4, 0.8, 'rotten_flesh'],
        [BlockRegistry.ITEM_CARROT, 3, 3.6, 'carrot'],
        [BlockRegistry.ITEM_POTATO, 1, 0.6, 'potato'],
        [BlockRegistry.ITEM_BAKED_POTATO, 5, 6.0, 'baked_potato']
    ]) {
        assert.ok(item instanceof ItemFood);
        assert.equal(item.nutrition, nutrition);
        assert.equal(item.saturation, saturation);
        assert.equal(item.getTextureForFace(), texture);
        assert.ok(existsSync(resolve('src/resources/terrain/pack/minecraft/textures/items', `${texture}.png`)));
    }
});

test('ore drops and smelting recipes use registered raw-metal items', () => {
    BlockRegistry.create();
    SmeltingRegistry.reset();
    assert.deepEqual(BlockRegistry.GOLD_ORE.getDrop(), [BlockRegistry.ITEM_RAW_GOLD.id, 1]);
    assert.deepEqual(BlockRegistry.IRON_ORE.getDrop(), [BlockRegistry.ITEM_RAW_IRON.id, 1]);
    assert.equal(SmeltingRegistry.getSmeltingResult(BlockRegistry.ITEM_RAW_GOLD.id).getType(), BlockRegistry.ITEM_GOLD.id);
    assert.equal(SmeltingRegistry.getSmeltingResult(BlockRegistry.ITEM_RAW_IRON.id).getType(), BlockRegistry.ITEM_IRON.id);
    assert.equal(SmeltingRegistry.getSmeltingResult(BlockRegistry.ITEM_RAW_COPPER.id).getType(), BlockRegistry.ITEM_COPPER_INGOT.id);
    for (const item of [BlockRegistry.ITEM_RAW_GOLD, BlockRegistry.ITEM_RAW_IRON, BlockRegistry.ITEM_RAW_COPPER]) {
        assert.ok(existsSync(resolve('src/resources/terrain/pack/minecraft/textures/items', `${item.tex}.png`)));
    }
});

test('gravel always yields a valid vanilla-style drop, including the flint roll', () => {
    BlockRegistry.create();
    const gravel = new BlockGravel(9001, 13);
    const random = Math.random;
    try {
        Math.random = () => 0.5;
        assert.deepEqual(gravel.getDrop(), [gravel.id, 1]);
        Math.random = () => 0.05;
        assert.deepEqual(gravel.getDrop(), [BlockRegistry.FLINT.id, 1]);
    } finally {
        Math.random = random;
        Block.blocks.delete(gravel.id);
    }
});

test('block mining time and harvestability distinguish hand, correct tool and tool tier', () => {
    BlockRegistry.create();
    const stone = BlockRegistry.STONE;
    const ironOre = BlockRegistry.IRON_ORE;
    const woodenPickaxe = BlockRegistry.WOOD_PICKAXE;
    const stonePickaxe = BlockRegistry.STONE_PICKAXE;
    const diamondPickaxe = BlockRegistry.DIAMOND_PICKAXE;

    assert.equal(getBlockMiningTicks(stone, null), 150);
    assert.equal(getBlockMiningTicks(stone, woodenPickaxe), 23);
    assert.equal(canHarvestBlock(stone, null), false);
    assert.equal(canHarvestBlock(stone, woodenPickaxe), true);
    assert.equal(canHarvestBlock(ironOre, woodenPickaxe), false);
    assert.equal(canHarvestBlock(ironOre, diamondPickaxe), true);
    assert.equal(getBlockMiningTicks(BlockRegistry.BEDROCK, diamondPickaxe), Infinity);
});

test('native block tool types and ore tiers come from the pinned 26.3 block tags', () => {
    assert.deepEqual(getVanillaMiningRule('minecraft:oak_log'), {
        toolType: 'axe', minimumToolLevel: null, requiresToolForDrops: false
    });
    assert.deepEqual(getVanillaMiningRule('minecraft:iron_ore'), {
        toolType: 'pickaxe', minimumToolLevel: 'stone', requiresToolForDrops: true
    });
    assert.deepEqual(getVanillaMiningRule('minecraft:diamond_ore'), {
        toolType: 'pickaxe', minimumToolLevel: 'iron', requiresToolForDrops: true
    });
});

test('native leaf and double-plant feature blocks do not drop their render-only block IDs', () => {
    const rolls = (...values) => { let index = 0; return () => values[index++] ?? 0.5; };
    assert.equal(getVanillaBlockDrop('minecraft:oak_leaves', {}, 5000, rolls(0.5, 0.5, 0.5)), null);
    assert.equal(getVanillaBlockDrop('minecraft:oak_leaves', {}, 5000, rolls(0.5, 0.5, 0.001)), 'minecraft:apple');
    assert.equal(getVanillaBlockDrop('minecraft:oak_leaves', {}, 5000, rolls(0.01)), 'minecraft:oak_sapling');
    assert.equal(getVanillaBlockDrop('minecraft:birch_leaves', {}, 5000, rolls(0.1, 0.01)), 'minecraft:stick');
    assert.equal(getVanillaBlockDrop('minecraft:sunflower', { half: 'upper' }, 5001), null);
    assert.equal(getVanillaBlockDrop('minecraft:sunflower', { half: 'lower' }, 5002), 'minecraft:sunflower',
        'return the canonical JAR loot item, not the synthetic render ID');
});

test('common Vanillith terrain drops match the canonical vanilla item instead of the render state', () => {
    assert.equal(getVanillaBlockDrop('minecraft:grass_block', {}, 5000), 'minecraft:dirt');
    assert.equal(getVanillaBlockDrop('minecraft:stone', {}, 5001), 'minecraft:cobblestone');
    assert.equal(getVanillaBlockDrop('minecraft:iron_ore', {}, 5002), 'minecraft:raw_iron');
    assert.equal(getVanillaBlockDrop('minecraft:short_grass', {}, 5003, () => 0.1), 'minecraft:wheat_seeds');
    assert.equal(getVanillaBlockDrop('minecraft:short_grass', {}, 5003, () => 0.9), null);
});

test('JAR block loot evaluates silk/shears and paired-plant context into all drops', () => {
    assert.deepEqual(getVanillaBlockDrops('minecraft:oak_leaves', {}, { shears: true }), [
        { name: 'minecraft:oak_leaves', count: 1 }
    ]);
    const world = { getNativeBlockStateAt: (_x, y) => y === 11
        ? { name: 'minecraft:tall_grass', properties: { half: 'upper' } }
        : { name: 'minecraft:air', properties: {} } };
    assert.deepEqual(getVanillaBlockDrops('minecraft:tall_grass', { half: 'lower' }, {
        shears: true, world, x: 0, y: 10, z: 0
    }), [{ name: 'minecraft:short_grass', count: 2 }]);
});
