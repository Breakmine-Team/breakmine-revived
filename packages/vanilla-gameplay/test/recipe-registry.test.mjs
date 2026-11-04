import test from 'node:test';
import assert from 'node:assert/strict';
import { BlockRegistry } from '../../../src/js/net/minecraft/client/world/block/BlockRegistry.js';
import Block from '../../../src/js/net/minecraft/client/world/block/Block.js';
import CraftingRegistry from '../../../src/js/net/minecraft/client/crafting/CraftingRegistry.js';
import ShapedCraftingRecipe from '../../../src/js/net/minecraft/client/crafting/recipe/ShapedCraftingRecipe.js';
import ShapelessCraftingRecipe from '../../../src/js/net/minecraft/client/crafting/recipe/ShapelessCraftingRecipe.js';
import VanillaIngredient from '../../../src/js/net/minecraft/client/crafting/recipe/VanillaIngredient.js';
import SmeltingRegistry from '../../../src/js/net/minecraft/client/smelting/SmeltingRegistry.js';
import SmeltingRecipe from '../../../src/js/net/minecraft/client/smelting/SmeltingRecipe.js';

BlockRegistry.create();
CraftingRegistry.reset();

test('crafting registry is sourced from the pinned JAR and indexes hundreds of locally supported recipes', () => {
    assert.equal(CraftingRegistry.jarRecipeStats.source, 2042);
    assert.ok(CraftingRegistry.jarRecipeStats.supportedCrafting >= 300);
    assert.ok(CraftingRegistry.jarRecipeStats.unsupportedOutput > 0, 'unmapped block items must not be fabricated as placeable blocks');
});

test('JAR oak-log tag recipe crafts four planks from one supported log', () => {
    const recipe = CraftingRegistry.recipes.find(entry => entry.recipeId === 'minecraft:oak_planks');
    assert.ok(recipe);
    const oakLog = BlockRegistry.get('minecraft:oak_log');
    assert.ok(oakLog);
    assert.equal(recipe.matches([oakLog.id, 0, 0, 0], 2, 2), true);
    assert.equal(recipe.getResult().getCount(), 4);
});

test('Vanillith crafting resolves block ingredients to the same native render item IDs as terrain', () => {
    const legacyGrass = BlockRegistry.get('minecraft:grass_block');
    const nativeGrass = new Block(9003);
    CraftingRegistry.setVanillaRenderedItems(new Map([['minecraft:grass_block', nativeGrass]]));
    try {
        assert.equal(CraftingRegistry.resolveItemId('minecraft:grass_block'), nativeGrass.id);
        assert.notEqual(CraftingRegistry.resolveItemId('minecraft:grass_block'), legacyGrass.id);
    } finally {
        CraftingRegistry.setVanillaRenderedItems(null);
        CraftingRegistry.refreshVanillaRecipes();
        Block.blocks.delete(nativeGrass.id);
    }
});

test('tag ingredients resolve alternatives and shapeless matching is independent of slot order', () => {
    const recipe = CraftingRegistry.recipes.find(entry => entry.recipeId === 'minecraft:flint_and_steel');
    assert.ok(recipe);
    const flint = BlockRegistry.get('minecraft:flint');
    const iron = BlockRegistry.get('minecraft:iron_ingot');
    assert.ok(flint && iron);
    assert.equal(recipe.matches([iron.id, 0, 0, flint.id], 2, 2), true);
});

test('shaped crafting accepts mirrored patterns and rejects extra occupied slots', () => {
    const recipe = new ShapedCraftingRecipe(999, 1, 2, 2, [new VanillaIngredient([1]), 0, new VanillaIngredient([2]), new VanillaIngredient([3])]);
    assert.equal(recipe.matches([0, 1, 3, 2], 2, 2), true);
    assert.equal(recipe.matches([1, 0, 2, 3, 4, 0], 3, 2), false);
});

test('JAR-generated generic ingredients receive stable IDs across registry refreshes', () => {
    const item = BlockRegistry.get('minecraft:feather');
    assert.ok(item);
    const id = item.id;
    CraftingRegistry.reset();
    assert.equal(BlockRegistry.get('minecraft:feather')?.id, id);
    assert.equal(Block.getById(id), item);
});

test('furnace recipes and cooking times use the JAR data, while mod recipes survive refresh', () => {
    SmeltingRegistry.reset();
    const rawIron = BlockRegistry.get('minecraft:raw_iron');
    assert.ok(rawIron);
    const ironRecipe = SmeltingRegistry.getCookingRecipe(rawIron.id, 'minecraft:smelting');
    assert.ok(ironRecipe);
    assert.equal(ironRecipe.cookingTime, 200);
    assert.equal(ironRecipe.getResult().getType(), BlockRegistry.get('minecraft:iron_ingot').id);
    const extension = new SmeltingRecipe(rawIron.id, BlockRegistry.get('minecraft:iron_ingot').id);
    SmeltingRegistry.registerRecipe(extension);
    SmeltingRegistry.refreshVanillaRecipes();
    assert.ok(SmeltingRegistry.recipes.includes(extension));
});
