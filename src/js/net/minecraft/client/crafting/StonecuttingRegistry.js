import CraftingRegistry from './CraftingRegistry.js';
import data from '../../../../../../packages/vanilla-gameplay/generated/recipes-26.3.json' with { type: 'json' };

export default class StonecuttingRegistry {
    static recipes = [];
    static renderedItems = undefined;

    static forInput(input) {
        if (this.renderedItems !== CraftingRegistry.vanillaRenderedItems) {
            this.renderedItems = CraftingRegistry.vanillaRenderedItems;
            this.recipes = [];
            for (const [id, recipe] of Object.entries(data.recipes ?? {})) {
                if (recipe.type !== 'minecraft:stonecutting') continue;
                const ingredient = CraftingRegistry.resolveIngredient(recipe.ingredient);
                const resultTypeId = CraftingRegistry.resolveItemId(recipe.result?.id);
                if (!ingredient || resultTypeId === null) continue;
                this.recipes.push({ id, ingredient, resultTypeId, count: recipe.result?.count ?? 1 });
            }
        }
        return input?.isEmpty() ? [] : this.recipes.filter(recipe => recipe.ingredient.matches(input));
    }
}
