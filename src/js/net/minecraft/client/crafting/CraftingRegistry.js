import ItemStack from "../item/ItemStack.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import Block from "../world/block/Block.js";
import ShapedCraftingRecipe from "./recipe/ShapedCraftingRecipe.js";
import ShapelessCraftingRecipe from "./recipe/ShapelessCraftingRecipe.js";
import VanillaIngredient from "./recipe/VanillaIngredient.js";
import RepairItemRecipe from "./recipe/RepairItemRecipe.js";
import vanillaRecipeData from "../../../../../../packages/vanilla-gameplay/generated/recipes-26.3.json" with { type: 'json' };
import ItemGeneric from "../world/block/type/ItemGeneric.js";
import ItemFood from '../world/block/type/ItemFood.js';
import gameplay from '../../../../../../packages/vanilla-gameplay/generated/gameplay.json' with { type: 'json' };
import { isExcludedVanillithContent } from '../../../../../../packages/vanilla-gameplay/content-policy.mjs';
import itemVisuals from '../../../../../../packages/vanilla-gameplay/generated/item-visuals.json' with { type: 'json' };
import EnumCreativeInventoryTab from '../gui/EnumCreativeInventoryTab.js';

export default class CraftingRegistry {
    static recipes = [];
    static vanillaRenderedItems = null;
    static jarRecipeStats = { source: 0, supportedCrafting: 0, unsupportedOutput: 0, unsupportedIngredient: 0, unsupportedType: 0 };

    static reset() {
        this.recipes = [];
        this.jarRecipeStats = this.registerVanillaRecipes();
        // BreakMine-only recipes are kept separate from the pinned vanilla
        // dataset and therefore cannot shadow native Minecraft recipes.
        this.registerBluestoneRecipes();
    }

    static refreshVanillaRecipes() {
        const extensions = this.recipes.filter(recipe => !recipe.vanilla && !recipe.breakmineCustom);
        this.recipes = [];
        this.jarRecipeStats = this.registerVanillaRecipes();
        this.registerBluestoneRecipes();
        for (const recipe of extensions) this.registerRecipe(recipe);
    }

    static setVanillaRenderedItems(items) {
        this.vanillaRenderedItems = items instanceof Map ? new Map(items) : null;
    }

    static resolveItemId(identifier) {
        if (isExcludedVanillithContent(identifier)) return null;
        if (typeof identifier !== 'string' || identifier.startsWith('#')) return null;
        const rendered = this.vanillaRenderedItems?.get(identifier);
        if (rendered && Number.isInteger(rendered.id)) return rendered.id;
        let block = BlockRegistry.get(identifier);
        const path = identifier.slice(identifier.indexOf(':') + 1);
        if (!block) {
            block = BlockRegistry.registry.get(path);
            if (block) BlockRegistry.registry.set(identifier, block);
        }
        // Material/food/tool items that the old BreakMine registry omitted
        // still need stable IDs so their JAR recipes and Creative inventory
        // entries work. Do not fabricate block items: placement needs the
        // actual native block/model mapping and must remain fail-closed.
        if (!block && vanillaRecipeData.blockNames?.includes(identifier)) return null;
        if (!block) {
            let id = BlockRegistry.hashString(`vanillith:item:${identifier}`);
            while (id === 0 || BlockRegistry.idMap.has(id) || Block.blocks.has(id)) id = (id + 1) >>> 0;
            const displayName = path.split('_').map(part => part ? part[0].toUpperCase() + part.slice(1) : '').join(' ');
            const stats = gameplay.items[identifier];
            block = stats?.nutrition > 0 && !stats.hasConsumeEffects
                ? new ItemFood(id, path, displayName, stats.nutrition, stats.saturation)
                : new ItemGeneric(id, path, displayName);
            const visual = itemVisuals.items[identifier];
            if (visual) {
                block.tex = visual.textures[0];
                block.itemDisplay = visual.display;
                block.getTextureLayers = () => visual.textures;
                block.getHeldTextureLayers = () => visual.heldTextures?.length ? visual.heldTextures : visual.textures;
            }
            block.vanillaItem = true;
            block.nativeItemId = identifier;
            block.inventoryTab = Object.values(EnumCreativeInventoryTab)
                .find(tab => tab?.id === this.getVanillaCreativeTab(path)) ?? EnumCreativeInventoryTab.MATERIALS;
            BlockRegistry.idMap.set(id, block);
            BlockRegistry.registry.set(identifier, block);
        }
        const stats = gameplay.items[identifier];
        if (stats && block?.isItem?.()) {
            block.nativeItemId = identifier;
            block.maxStackSize = stats.maxStackSize;
            block.durability = stats.durability;
            block.attackDamage = stats.attackDamage;
            block.attackSpeed = stats.attackSpeed;
            block.useDurationTicks = stats.useDurationTicks;
            block.canAlwaysEat = stats.canAlwaysEat;
            block.nativeTool = stats.tool;
            block.attackAnimation = stats.attackAnimation;
            block.attackDurabilityDamage = stats.attackDurabilityDamage;
            if (stats.tool) block.isTool = true;
        }
        return Number.isInteger(block?.id) && block.id > 0 ? block.id : null;
    }

    static getVanillaCreativeTab(name) {
        if (/(sword|helmet|chestplate|leggings|boots|shield|bow|crossbow|trident|arrow|spear|harness|horse_armor)$/.test(name)) return 6;
        if (/(pickaxe|shovel|axe|hoe|fishing_rod|shears|flint_and_steel|compass|clock|spyglass|brush|bucket|lead|saddle|carrot_on_a_stick|warped_fungus_on_a_stick|elytra|mace)$/.test(name)) return 5;
        if (/(apple|bread|beef|porkchop|chicken|mutton|rabbit|cod|salmon|tropical_fish|potato|carrot|beetroot|melon_slice|cookie|cake|pie|stew|soup|berries|chorus_fruit|honey_bottle|rotten_flesh|spider_eye|pufferfish|dried_kelp)$/.test(name)) return 4;
        return 7;
    }

    static expandItemTag(tag, visiting = new Set()) {
        if (visiting.has(tag)) return [];
        const definition = vanillaRecipeData.itemTags?.[tag];
        if (!definition || !Array.isArray(definition.values)) return [];
        const next = new Set(visiting);
        next.add(tag);
        const ids = [];
        for (const value of definition.values) {
            const identifier = typeof value === 'string' ? value : value?.id;
            if (typeof identifier !== 'string') continue;
            if (identifier.startsWith('#')) ids.push(...this.expandItemTag(identifier.slice(1), next));
            else {
                const id = this.resolveItemId(identifier);
                if (id !== null) ids.push(id);
            }
        }
        return [...new Set(ids)];
    }

    static resolveIngredient(raw) {
        const candidates = Array.isArray(raw) ? raw : [raw];
        const ids = [];
        const add = value => {
            if (typeof value === 'string') {
                if (value.startsWith('#')) ids.push(...this.expandItemTag(value.slice(1)));
                else {
                    const id = this.resolveItemId(value);
                    if (id !== null) ids.push(id);
                }
            } else if (value && typeof value === 'object') {
                if (typeof value.item === 'string') add(value.item);
                else if (typeof value.tag === 'string') add(`#${value.tag.replace(/^#/, '')}`);
                else if (Array.isArray(value.items)) value.items.forEach(add);
                else if (typeof value.id === 'string') add(value.id);
            }
        };
        candidates.forEach(add);
        const unique = [...new Set(ids)];
        return unique.length ? new VanillaIngredient(unique, raw) : null;
    }

    static registerVanillaRecipes() {
        // Inventory/holding should not depend on whether an item happens to
        // be referenced by a currently supported crafting recipe.
        for (const name of Object.keys(itemVisuals.items)) this.resolveItemId(name);
        const stats = { source: Object.keys(vanillaRecipeData.recipes ?? {}).length, supportedCrafting: 0, unsupportedOutput: 0, unsupportedIngredient: 0, unsupportedType: 0 };
        for (const [recipeId, data] of Object.entries(vanillaRecipeData.recipes ?? {})) {
            if (data.type === 'minecraft:crafting_special_repairitem') {
                const recipe = new RepairItemRecipe();
                recipe.recipeId = recipeId;
                recipe.vanilla = true;
                this.registerRecipe(recipe);
                stats.supportedCrafting++;
                continue;
            }
            if (!['minecraft:crafting_shaped', 'minecraft:crafting_shapeless', 'minecraft:crafting_transmute'].includes(data.type)) {
                stats.unsupportedType++;
                continue;
            }
            const resultId = this.resolveItemId(data.result?.id);
            if (resultId === null) {
                stats.unsupportedOutput++;
                continue;
            }
            let recipe;
            if (data.type === 'minecraft:crafting_shaped') {
                let pattern = data.pattern;
                if (!Array.isArray(pattern) || pattern.length < 1 || pattern.length > 3 || pattern.some(row => typeof row !== 'string')) {
                    stats.unsupportedIngredient++;
                    continue;
                }
                pattern = [...pattern];
                while (pattern.length && pattern[0].trim() === '') pattern.shift();
                while (pattern.length && pattern.at(-1).trim() === '') pattern.pop();
                while (pattern.length && pattern.every(row => row[0] === ' ')) pattern = pattern.map(row => row.slice(1));
                while (pattern.length && pattern.every(row => row.at(-1) === ' ')) pattern = pattern.map(row => row.slice(0, -1));
                if (!pattern.length) {
                    stats.unsupportedIngredient++;
                    continue;
                }
                const width = Math.max(...pattern.map(row => row.length));
                if (width < 1 || width > 3) {
                    stats.unsupportedIngredient++;
                    continue;
                }
                const ingredients = [];
                let valid = true;
                for (const row of pattern) {
                    for (let x = 0; x < width; x++) {
                        const symbol = row[x] ?? ' ';
                        if (symbol === ' ') {
                            ingredients.push(0);
                            continue;
                        }
                        const ingredient = this.resolveIngredient(data.key?.[symbol]);
                        if (!ingredient) valid = false;
                        ingredients.push(ingredient);
                    }
                }
                if (!valid) {
                    stats.unsupportedIngredient++;
                    continue;
                }
                recipe = new ShapedCraftingRecipe(resultId, data.result?.count ?? 1, width, pattern.length, ingredients);
            } else {
                const sourceIngredients = data.type === 'minecraft:crafting_transmute'
                    ? [data.input, data.material]
                    : data.ingredients;
                if (!Array.isArray(sourceIngredients) || sourceIngredients.length < 1 || sourceIngredients.length > 9) {
                    stats.unsupportedIngredient++;
                    continue;
                }
                const ingredients = sourceIngredients.map(ingredient => this.resolveIngredient(ingredient));
                if (ingredients.some(ingredient => !ingredient)) {
                    stats.unsupportedIngredient++;
                    continue;
                }
                recipe = new ShapelessCraftingRecipe(resultId, data.result?.count ?? 1, ingredients);
            }
            recipe.recipeId = recipeId;
            recipe.category = data.category ?? 'misc';
            recipe.group = data.group ?? '';
            recipe.vanilla = true;
            this.registerRecipe(recipe);
            stats.supportedCrafting++;
        }
        return stats;
    }

    static registerRecipe(recipeInstance) {
        if (recipeInstance && typeof recipeInstance.matches === 'function') {
            this.recipes.push(recipeInstance);
        }
    }

    static registerOreRecipes() {
        const oreBlocks = ['coal', 'iron', 'gold', 'diamond', 'emerald'];
        for (const ore of oreBlocks) {
            this.registerShapedRecipe(BlockRegistry[ore.toUpperCase() + '_BLOCK'].id, 1, 3, 3, [
                BlockRegistry['ITEM_' + ore.toUpperCase()].id, BlockRegistry['ITEM_' + ore.toUpperCase()].id, BlockRegistry['ITEM_' + ore.toUpperCase()].id,
                BlockRegistry['ITEM_' + ore.toUpperCase()].id, BlockRegistry['ITEM_' + ore.toUpperCase()].id, BlockRegistry['ITEM_' + ore.toUpperCase()].id,
                BlockRegistry['ITEM_' + ore.toUpperCase()].id, BlockRegistry['ITEM_' + ore.toUpperCase()].id, BlockRegistry['ITEM_' + ore.toUpperCase()].id
            ]);
            this.registerShapelessRecipe(BlockRegistry['ITEM_' + ore.toUpperCase()].id, 9, [BlockRegistry[ore.toUpperCase() + '_BLOCK'].id]);
        }
    }

    static registerWoodRecipes() {
        const woodBlockIds = [
            BlockRegistry.WOOD.id,
            BlockRegistry.SPRUCE_PLANKS.id,
            BlockRegistry.BIRCH_PLANKS.id,
            BlockRegistry.JUNGLE_PLANKS.id,
            BlockRegistry.ACACIA_PLANKS.id
        ];
        const woodToSlab = {
            [BlockRegistry.WOOD.id]: BlockRegistry.WOOD_SLAB.id,
            [BlockRegistry.SPRUCE_PLANKS.id]: BlockRegistry.SPRUCE_SLAB.id,
            [BlockRegistry.BIRCH_PLANKS.id]: BlockRegistry.BIRCH_SLAB.id,
            [BlockRegistry.JUNGLE_PLANKS.id]: BlockRegistry.JUNGLE_SLAB.id,
            [BlockRegistry.ACACIA_PLANKS.id]: BlockRegistry.ACACIA_SLAB.id
        };
        for (const woodBlockId of woodBlockIds) {
            this.registerShapedRecipe(BlockRegistry.CHEST.id, 1, 3, 3, [
                woodBlockId, woodBlockId, woodBlockId,
                woodBlockId, 0          , woodBlockId,
                woodBlockId, woodBlockId, woodBlockId
            ]);
            this.registerShapedRecipe(BlockRegistry.CRAFTING_TABLE.id, 1, 2, 2, [
                woodBlockId, woodBlockId,
                woodBlockId, woodBlockId
            ]);
            this.registerShapedRecipe(woodToSlab[woodBlockId], 6, 3, 1, [
                woodBlockId, woodBlockId, woodBlockId
            ]);
            this.registerShapedRecipe(BlockRegistry.ITEM_STICK.id, 4, 1, 2, [
                woodBlockId,
                woodBlockId
            ]);
            this.registerShapedRecipe(BlockRegistry.SIGN.id, 3, 3, 2, [
                woodBlockId, woodBlockId, woodBlockId,
                0, BlockRegistry.ITEM_STICK.id, 0
            ]);
        }
    }

    static registerAllRecipes() {
        this.registerShapelessRecipe(BlockRegistry.WOOD.id, 4, [BlockRegistry.LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.SPRUCE_PLANKS.id, 4, [BlockRegistry.SPRUCE_LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.BIRCH_PLANKS.id, 4, [BlockRegistry.BIRCH_LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.JUNGLE_PLANKS.id, 4, [BlockRegistry.JUNGLE_LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.ACACIA_PLANKS.id, 4, [BlockRegistry.ACACIA_LOG.id]);
        this.registerShapedRecipe(BlockRegistry.TORCH.id, 4, 1, 2, [BlockRegistry.ITEM_COAL.id, BlockRegistry.ITEM_STICK.id]);
        this.registerShapedRecipe(BlockRegistry.ITEM_BUCKET_EMPTY.id, 1, 3, 2, [
            BlockRegistry.ITEM_IRON.id, 0, BlockRegistry.ITEM_IRON.id,
            0, BlockRegistry.ITEM_IRON.id, 0
        ]);
        this.registerShapedRecipe(BlockRegistry.FURNACE.id, 1, 3, 3, [
            BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id,
            BlockRegistry.COBBLE_STONE.id, 0,                            BlockRegistry.COBBLE_STONE.id,
            BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id,
        ]);

        this.registerShapedRecipe(BlockRegistry.COBBLESTONE_SLAB.id, 6, 3, 1, [
            BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.MOSSY_COBBLESTONE_SLAB.id, 6, 3, 1, [
            BlockRegistry.MOSSY_COBBLESTONE.id, BlockRegistry.MOSSY_COBBLESTONE.id, BlockRegistry.MOSSY_COBBLESTONE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.BRICK_SLAB.id, 6, 3, 1, [
            BlockRegistry.BRICK.id, BlockRegistry.BRICK.id, BlockRegistry.BRICK.id
        ])
        this.registerShapelessRecipe(BlockRegistry.CLAY.id, 1, [
            BlockRegistry.ITEM_CLAY_BALL.id, BlockRegistry.ITEM_CLAY_BALL.id,
            BlockRegistry.ITEM_CLAY_BALL.id, BlockRegistry.ITEM_CLAY_BALL.id
        ]);
        this.registerShapelessRecipe(BlockRegistry.FLINT_AND_STEEL.id, 1, [
            BlockRegistry.FLINT.id, BlockRegistry.ITEM_IRON.id,
        ]);
        this.registerDyeRecipes();
        this.registerConcretePowderRecipes();
        this.registerWoodRecipes();
        this.registerOreRecipes();
        this.registerBluestoneRecipes();
        this.registerToolRecipes();
    }

    static registerDyeRecipes() {
        const B = BlockRegistry;
        const recipes = [
            [B.FLOWER_ROSE, 'ITEM_RED_DYE'],
            [B.FLOWER_DANDELION, 'ITEM_YELLOW_DYE'],
            [B.FLOWER_BLUE_ORCHID, 'ITEM_LIGHT_BLUE_DYE'],
            [B.FLOWER_ALLIUM, 'ITEM_MAGENTA_DYE'],
            [B.FLOWER_AZURE_BLUET, 'ITEM_LIGHT_GRAY_DYE'],
            [B.FLOWER_RED_TULIP, 'ITEM_RED_DYE'],
            [B.FLOWER_ORANGE_TULIP, 'ITEM_ORANGE_DYE'],
            [B.FLOWER_WHITE_TULIP, 'ITEM_LIGHT_GRAY_DYE'],
            [B.FLOWER_PINK_TULIP, 'ITEM_PINK_DYE'],
            [B.FLOWER_OXEYE_DAISY, 'ITEM_LIGHT_GRAY_DYE'],
            [B.FLOWER_CORNFLOWER, 'ITEM_BLUE_DYE'],
            [B.FLOWER_WITHER_ROSE, 'ITEM_BLACK_DYE'],
            [B.GRASS_PLANT, 'ITEM_GREEN_DYE'],
        ];
        for (const [plant, dye] of recipes) {
            this.registerShapelessRecipe(B[dye].id, 1, [plant.id]);
        }
    }

    static registerConcretePowderRecipes() {
        const B = BlockRegistry;
        const SAND = B.SAND.id;
        const GRAVEL = B.GRAVEL.id;
        const colors = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
        for (const color of colors) {
            const key = color.toUpperCase().replace(/-/g, '_');
            this.registerShapelessRecipe(B[`${key}_CONCRETE_POWDER`].id, 1, [
                SAND, SAND, SAND, SAND,
                GRAVEL, GRAVEL, GRAVEL, GRAVEL,
                B[`ITEM_${key}_DYE`].id,
            ]);
        }
    }

    static registerToolRecipes() {
        const S = BlockRegistry.ITEM_STICK.id;
        const toolTypes = ['pickaxe', 'sword', 'shovel', 'axe', 'hoe'];
        const materials = {
            wood: BlockRegistry.WOOD.id,
            spruce: BlockRegistry.SPRUCE_PLANKS.id,
            birch: BlockRegistry.BIRCH_PLANKS.id,
            jungle: BlockRegistry.JUNGLE_PLANKS.id,
            acacia: BlockRegistry.ACACIA_PLANKS.id,
            stone: BlockRegistry.COBBLE_STONE.id,
            iron: BlockRegistry.ITEM_IRON.id,
            diamond: BlockRegistry.ITEM_DIAMOND.id,
            gold: BlockRegistry.ITEM_GOLD.id
        };
        const materialToToolType = {
            wood: 'WOOD',
            spruce: 'WOOD',
            birch: 'WOOD',
            jungle: 'WOOD',
            acacia: 'WOOD',
            stone: 'STONE',
            iron: 'IRON',
            diamond: 'DIAMOND',
            gold: 'GOLD'
        };
        const patterns = {
            pickaxe: { width: 3, height: 3, shape: [1, 1, 1, 0, 2, 0, 0, 2, 0] },
            sword: { width: 1, height: 3, shape: [1, 1, 2] },
            shovel: { width: 1, height: 3, shape: [1, 2, 2] },
            axe: { width: 2, height: 3, shape: [1, 1, 1, 2, 0, 2] },
            hoe: { width: 2, height: 3, shape: [1, 1, 0, 2, 0, 2] }
        };

        for (const [mat, matId] of Object.entries(materials)) {
            for (const type of toolTypes) {
                const toolType = materialToToolType[mat];
                const key = `${toolType}_${type.toUpperCase()}`;
                const resultId = BlockRegistry[key]?.id;
                if (!resultId) continue;
                const pattern = patterns[type];
                const shape = pattern.shape.map(i => i === 0 ? 0 : i === 1 ? matId : S);
                this.registerShapedRecipe(resultId, 1, pattern.width, pattern.height, shape);
            }
        }
    }

    static registerBluestoneRecipes() {
        const firstCustomRecipe = this.recipes.length;
        const DUST = BlockRegistry.ITEM_BLUESTONE_DUST_PLACER.id;
        const BLOCK = BlockRegistry.BLUESTONE_BLOCK.id;
        const LAMP = BlockRegistry.BLUESTONE_LAMP.id;
        const ADJUSTING_LAMP = BlockRegistry.BLUESTONE_ADJUSTING_LAMP.id;
        const BULB = BlockRegistry.BLUESTONE_BULB.id;
        const ROD = BlockRegistry.BLUESTONE_ROD.id;
        const PUSHER = BlockRegistry.BLUESTONE_PUSHER.id;
        const STICKY_PUSHER = BlockRegistry.BLUESTONE_STICKY_PUSHER.id;
        const REPEATER = BlockRegistry.BLUESTONE_REPEATER.id;
        const OBSERVER = BlockRegistry.BLUESTONE_OBSERVER.id;
        const ORE = BlockRegistry.BLUESTONE_ORE.id;
        const GLASS = BlockRegistry.GLASS.id;
        const WOOD = BlockRegistry.WOOD.id;
        const COBBLE = BlockRegistry.COBBLE_STONE.id;
        const STONE = BlockRegistry.STONE.id;
        const IRON = BlockRegistry.ITEM_IRON.id;
        const SLIME = BlockRegistry.SLIME.id;

        this.registerShapelessRecipe(DUST, 6, [ORE]);

        this.registerShapedRecipe(BLOCK, 1, 3, 3, [
            DUST, DUST, DUST,
            DUST, DUST, DUST,
            DUST, DUST, DUST
        ]);
        this.registerShapelessRecipe(DUST, 9, [BLOCK]);

        this.registerShapedRecipe(LAMP, 1, 3, 3, [
            0, GLASS, 0,
            GLASS, DUST, GLASS,
            0, GLASS, 0
        ]);

        this.registerShapelessRecipe(ADJUSTING_LAMP, 1, [LAMP, REPEATER]);

        this.registerShapedRecipe(BULB, 1, 3, 3, [
            GLASS, GLASS, GLASS,
            GLASS, DUST, GLASS,
            GLASS, GLASS, GLASS
        ]);

        this.registerShapedRecipe(ROD, 4, 1, 2, [DUST, DUST]);

        this.registerShapedRecipe(PUSHER, 1, 3, 3, [
            WOOD, WOOD, WOOD,
            COBBLE, DUST, COBBLE,
            COBBLE, IRON, COBBLE
        ]);

        this.registerShapelessRecipe(STICKY_PUSHER, 1, [PUSHER, SLIME]);

        this.registerShapedRecipe(REPEATER, 1, 3, 3, [
            0, ROD, 0,
            STONE, DUST, STONE,
            STONE, STONE, STONE
        ]);

        this.registerShapedRecipe(OBSERVER, 1, 3, 3, [
            COBBLE, COBBLE, COBBLE,
            COBBLE, DUST, COBBLE,
            COBBLE, COBBLE, COBBLE
        ]);
        for (const recipe of this.recipes.slice(firstCustomRecipe)) recipe.breakmineCustom = true;
    }

    static registerShapedRecipe(resultTypeId, resultCount = 1, width, height, shape) {
        const normalizedIngredients = [];
        for (const row of shape) {
            if (Array.isArray(row)) {
                normalizedIngredients.push(...row);
            } else {
                normalizedIngredients.push(row);
            }
        }

        const recipe = new ShapedCraftingRecipe(resultTypeId, resultCount, width, height, normalizedIngredients);
        this.registerRecipe(recipe);
    }

    static registerShapelessRecipe(resultTypeId, resultCount = 1, ingredients) {
        const normalizedIngredients = Array.isArray(ingredients) ? ingredients : [];
        const recipe = new ShapelessCraftingRecipe(resultTypeId, resultCount, normalizedIngredients);
        this.registerRecipe(recipe);
    }

    static getCraftResult(gridItems, width, height) {
        const slots = Array.isArray(gridItems) ? gridItems : [];
        const recipe = this.findRecipe(slots, width, height);
        
        if (!recipe) {
            return null;
        }

        return recipe.matches(gridItems, width, height) ? recipe.getResult(slots) : null;
    }

    static findRecipe(gridItems, width, height) {
        for (const recipe of this.recipes) {
            if (recipe.matches(gridItems, width, height)) {
                return recipe;
            }
        }
        return null;
    }
}
