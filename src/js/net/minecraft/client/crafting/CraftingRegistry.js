import ItemStack from "../item/ItemStack.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";
import Block from "../world/block/Block.js";
import ShapedCraftingRecipe from "./recipe/ShapedCraftingRecipe.js";
import ShapelessCraftingRecipe from "./recipe/ShapelessCraftingRecipe.js";

export default class CraftingRegistry {
    static recipes = [];

    static reset() {
        this.recipes = [];
        this.registerAllRecipes();
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
        const DUST = BlockRegistry.BLUESTONE_DUST.id;
        const BLOCK = BlockRegistry.BLUESTONE_BLOCK.id;
        const LAMP = BlockRegistry.BLUESTONE_LAMP.id;
        const ADJUSTING_LAMP = BlockRegistry.BLUESTONE_ADJUSTING_LAMP.id;
        const BULB = BlockRegistry.BLUESTONE_BULB.id;
        const ROD = BlockRegistry.BLUESTONE_ROD.id;
        const PUSHER = BlockRegistry.BLUESTONE_PUSHER.id;
        const STICKY_PUSHER = BlockRegistry.BLUESTONE_STICKY_PUSHER.id;
        const REPEATER = BlockRegistry.BLUESTONE_REPEATER.id;
        const MEMORY_CELL = BlockRegistry.BLUESTONE_MEMORY_CELL.id;
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

        this.registerShapedRecipe(MEMORY_CELL, 1, 3, 3, [
            ROD, ROD, 0,
            STONE, DUST, STONE,
            STONE, STONE, STONE
        ]);

        this.registerShapedRecipe(OBSERVER, 1, 3, 3, [
            COBBLE, COBBLE, COBBLE,
            COBBLE, DUST, COBBLE,
            COBBLE, COBBLE, COBBLE
        ]);
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

        return recipe.matches(gridItems, width, height) ? recipe.getResult() : null;
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