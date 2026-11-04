import SmeltingRecipe from "./SmeltingRecipe.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import CraftingRegistry from "../crafting/CraftingRegistry.js";
import vanillaRecipeData from "../../../../../../packages/vanilla-gameplay/generated/recipes-26.3.json" with { type: 'json' };

export default class SmeltingRegistry {
    static recipes = [];
    static fuelValues = {};

    static reset() {
        this.recipes = [];
        this.fuelValues = {};
        this.registerAllRecipes();
        this.registerAllFuels();
    }

    static refreshVanillaRecipes() {
        const extensions = this.recipes.filter(recipe => !recipe.vanilla && !recipe.breakmineCustom);
        this.recipes = [];
        this.fuelValues = {};
        this.registerAllRecipes();
        this.registerAllFuels();
        for (const recipe of extensions) this.registerRecipe(recipe);
    }

    static registerRecipe(recipe) {
        if (recipe && typeof recipe.matches === 'function') {
            this.recipes.push(recipe);
        }
    }

    static registerFuel(typeId, burnTicks) {
        this.fuelValues[typeId] = burnTicks;
    }

    static registerAllRecipes() {
        for (const [recipeId, data] of Object.entries(vanillaRecipeData.recipes ?? {})) {
            if (!['minecraft:smelting', 'minecraft:blasting', 'minecraft:smoking', 'minecraft:campfire_cooking'].includes(data.type)) continue;
            const resultTypeId = CraftingRegistry.resolveItemId(data.result?.id);
            const ingredient = CraftingRegistry.resolveIngredient(data.ingredient);
            if (resultTypeId === null || !ingredient) continue;
            const recipe = new SmeltingRecipe(ingredient, resultTypeId, data.result?.count ?? 1, {
                recipeId, type: data.type, cookingTime: data.cookingtime ?? 200, experience: data.experience ?? 0
            });
            recipe.vanilla = true;
            this.registerRecipe(recipe);
        }
        // BreakMine's non-vanilla component has its own conversion recipe.
        const bluestone = new SmeltingRecipe(BlockRegistry.BLUESTONE_ORE.id, BlockRegistry.BLUESTONE_DUST.id);
        bluestone.breakmineCustom = true;
        this.registerRecipe(bluestone);
    }

    static registerAllFuels() {
        this.registerFuel(BlockRegistry.ITEM_COAL.id, 1600);
        this.registerFuel(BlockRegistry.COAL_BLOCK.id, 16000);
    }

    static getSmeltingResult(inputTypeId) {
        return this.getCookingRecipe(inputTypeId, 'minecraft:smelting')?.getResult() ?? null;
    }

    static getCookingRecipe(inputTypeId, type = 'minecraft:smelting') {
        return this.recipes.find(recipe => recipe.type === type && recipe.matches(inputTypeId)) ?? null;
    }

    static getFuelValue(typeId) {
        return this.fuelValues[typeId] || 0;
    }

    static isFuel(typeId) {
        return this.getFuelValue(typeId) > 0;
    }
}
