import SmeltingRecipe from "./SmeltingRecipe.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";

export default class SmeltingRegistry {
    static recipes = [];
    static fuelValues = {};

    static reset() {
        this.recipes = [];
        this.fuelValues = {};
        this.registerAllRecipes();
        this.registerAllFuels();
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
        this.registerRecipe(new SmeltingRecipe(BlockRegistry.IRON_ORE.id, BlockRegistry.ITEM_IRON.id));
        this.registerRecipe(new SmeltingRecipe(BlockRegistry.GOLD_ORE.id, BlockRegistry.ITEM_GOLD.id));
        this.registerRecipe(new SmeltingRecipe(BlockRegistry.SAND.id, BlockRegistry.GLASS.id));
        this.registerRecipe(new SmeltingRecipe(BlockRegistry.COBBLE_STONE.id, BlockRegistry.STONE.id));
        this.registerRecipe(new SmeltingRecipe(BlockRegistry.BLUESTONE_ORE.id, BlockRegistry.BLUESTONE_DUST.id));
        this.registerRecipe(new SmeltingRecipe(BlockRegistry.CLAY.id, BlockRegistry.TERRACOTTA.id));
    }

    static registerAllFuels() {
        this.registerFuel(BlockRegistry.ITEM_COAL.id, 1600);
        this.registerFuel(BlockRegistry.COAL_BLOCK.id, 16000);
    }

    static getSmeltingResult(inputTypeId) {
        for (const recipe of this.recipes) {
            if (recipe.matches(inputTypeId)) {
                return recipe.getResult();
            }
        }
        return null;
    }

    static getFuelValue(typeId) {
        return this.fuelValues[typeId] || 0;
    }

    static isFuel(typeId) {
        return this.getFuelValue(typeId) > 0;
    }
}
