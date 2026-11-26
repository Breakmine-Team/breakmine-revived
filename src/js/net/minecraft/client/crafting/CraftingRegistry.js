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
            return recipeInstance;
        }
        return null;
    }

    static unregisterRecipe(recipeInstance) {
        const index = this.recipes.indexOf(recipeInstance);
        if (index === -1) return false;
        this.recipes.splice(index, 1);
        return true;
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
        this.registerShapedRecipe(BlockRegistry.SAPPHIRE_BLOCK.id, 1, 3, 3, [
            BlockRegistry.ITEM_SAPPHIRE.id, BlockRegistry.ITEM_SAPPHIRE.id, BlockRegistry.ITEM_SAPPHIRE.id,
            BlockRegistry.ITEM_SAPPHIRE.id, BlockRegistry.ITEM_SAPPHIRE.id, BlockRegistry.ITEM_SAPPHIRE.id,
            BlockRegistry.ITEM_SAPPHIRE.id, BlockRegistry.ITEM_SAPPHIRE.id, BlockRegistry.ITEM_SAPPHIRE.id
        ]);
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
        const woodToVerticalSlab = {
            [BlockRegistry.WOOD.id]: BlockRegistry.WOOD_VERTICAL_SLAB.id,
            [BlockRegistry.SPRUCE_PLANKS.id]: BlockRegistry.SPRUCE_VERTICAL_SLAB.id,
            [BlockRegistry.BIRCH_PLANKS.id]: BlockRegistry.BIRCH_VERTICAL_SLAB.id,
            [BlockRegistry.JUNGLE_PLANKS.id]: BlockRegistry.JUNGLE_VERTICAL_SLAB.id,
            [BlockRegistry.ACACIA_PLANKS.id]: BlockRegistry.ACACIA_VERTICAL_SLAB.id
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
            this.registerShapedRecipe(woodToVerticalSlab[woodBlockId], 6, 1, 3, [
                woodBlockId,
                woodBlockId,
                woodBlockId
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

    static registerWoodExtras() {
        const B = BlockRegistry;
        const S = B.ITEM_STICK.id;
        const variants = [
            { planks: B.WOOD.id, stairs: B.OAK_STAIRS.id, fence: B.FENCE.id, table: B.OAK_TABLE.id, chair: B.OAK_CHAIR.id, bench: B.OAK_BENCH.id },
            { planks: B.SPRUCE_PLANKS.id, stairs: B.SPRUCE_STAIRS.id, fence: B.SPRUCE_FENCE.id, table: B.SPRUCE_TABLE.id, chair: B.SPRUCE_CHAIR.id, bench: B.SPRUCE_BENCH.id },
            { planks: B.BIRCH_PLANKS.id, stairs: B.BIRCH_STAIRS.id, fence: B.BIRCH_FENCE.id, table: B.BIRCH_TABLE.id, chair: B.BIRCH_CHAIR.id, bench: B.BIRCH_BENCH.id },
            { planks: B.JUNGLE_PLANKS.id, stairs: B.JUNGLE_STAIRS.id, fence: B.JUNGLE_FENCE.id, table: B.JUNGLE_TABLE.id, chair: B.JUNGLE_CHAIR.id, bench: B.JUNGLE_BENCH.id },
            { planks: B.ACACIA_PLANKS.id, stairs: B.ACACIA_STAIRS.id, fence: B.ACACIA_FENCE.id, table: B.ACACIA_TABLE.id, chair: B.ACACIA_CHAIR.id, bench: B.ACACIA_BENCH.id }
        ];

        for (const v of variants) {
            this.registerShapedRecipe(v.stairs, 6, 3, 3, [
                v.planks, 0, 0,
                v.planks, v.planks, 0,
                v.planks, v.planks, v.planks
            ]);
            this.registerShapedRecipe(v.fence, 3, 3, 2, [
                v.planks, S, v.planks,
                v.planks, S, v.planks
            ]);
            this.registerShapedRecipe(v.table, 1, 3, 3, [
                v.planks, v.planks, v.planks,
                0, S, 0,
                0, S, 0
            ]);
            this.registerShapedRecipe(v.chair, 1, 2, 2, [
                v.planks, v.planks,
                v.planks, S
            ]);
            this.registerShapedRecipe(v.bench, 1, 3, 2, [
                v.planks, v.planks, v.planks,
                S, 0, S
            ]);
        }

        this.registerShapedRecipe(B.ITEM_OAK_DOOR_PLACER.id, 1, 3, 2, [
            B.WOOD.id, B.WOOD.id, B.WOOD.id,
            B.WOOD.id, B.WOOD.id, B.WOOD.id
        ]);
        this.registerShapedRecipe(B.ITEM_GLASS_DOOR_PLACER.id, 1, 3, 2, [
            B.GLASS.id, B.GLASS.id, B.GLASS.id,
            B.GLASS.id, B.ITEM_IRON.id, B.GLASS.id
        ]);
    }

    static registerBuildingRecipes() {
        const B = BlockRegistry;
        const P = B.WOOD.id;
        const S = B.ITEM_STICK.id;
        const IRON = B.ITEM_IRON.id;
        const DUST = B.BLUESTONE_DUST.id;
        const COBBLE = B.COBBLE_STONE.id;
        const STONE = B.STONE.id;

        this.registerShapedRecipe(B.COBBLESTONE_STAIRS.id, 6, 3, 3, [
            COBBLE, 0, 0,
            COBBLE, COBBLE, 0,
            COBBLE, COBBLE, COBBLE
        ]);
        this.registerShapedRecipe(B.MOSSY_COBBLESTONE_STAIRS.id, 6, 3, 3, [
            B.MOSSY_COBBLESTONE.id, 0, 0,
            B.MOSSY_COBBLESTONE.id, B.MOSSY_COBBLESTONE.id, 0,
            B.MOSSY_COBBLESTONE.id, B.MOSSY_COBBLESTONE.id, B.MOSSY_COBBLESTONE.id
        ]);
        this.registerShapedRecipe(B.BRICK_STAIRS.id, 6, 3, 3, [
            B.BRICK.id, 0, 0,
            B.BRICK.id, B.BRICK.id, 0,
            B.BRICK.id, B.BRICK.id, B.BRICK.id
        ]);

        this.registerShapedRecipe(B.STONEBRICK.id, 4, 2, 2, [
            STONE, STONE,
            STONE, STONE
        ]);
        this.registerShapelessRecipe(B.DARK_STONEBRICK.id, 4, [
            B.STONEBRICK.id, B.STONEBRICK.id, B.STONEBRICK.id, B.STONEBRICK.id,
            B.ITEM_COAL.id
        ]);
        this.registerShapedRecipe(B.BRICK.id, 1, 3, 3, [
            B.ITEM_CLAY_BALL.id, B.ITEM_CLAY_BALL.id, B.ITEM_CLAY_BALL.id,
            B.ITEM_CLAY_BALL.id, B.ITEM_COAL.id, B.ITEM_CLAY_BALL.id,
            B.ITEM_CLAY_BALL.id, B.ITEM_CLAY_BALL.id, B.ITEM_CLAY_BALL.id
        ]);

        this.registerShapedRecipe(B.BOOKSHELF.id, 1, 3, 3, [
            P, P, P,
            B.ITEM_WHEAT.id, B.ITEM_WHEAT.id, B.ITEM_WHEAT.id,
            P, P, P
        ]);
        this.registerShapedRecipe(B.WOOD_PANEL.id, 2, 2, 1, [P, P]);
        this.registerShapelessRecipe(B.BED.id, 1, [
            B.WHITE_WOOL.id, B.WHITE_WOOL.id, B.WHITE_WOOL.id,
            P, P, P
        ]);
        this.registerShapedRecipe(B.CLOCK.id, 1, 3, 3, [
            0, B.ITEM_GOLD.id, 0,
            B.ITEM_GOLD.id, B.ITEM_SAPPHIRE.id, B.ITEM_GOLD.id,
            0, B.ITEM_GOLD.id, 0
        ]);
        // A clock backed with a plank, like the other counter variants.
        this.registerShapelessRecipe(B.MOUNTABLE_CLOCK.id, 1, [B.CLOCK.id, P]);
        this.registerShapedRecipe(B.TNT.id, 1, 3, 3, [
            B.SAND.id, DUST, B.SAND.id,
            DUST, B.ITEM_COAL.id, DUST,
            B.SAND.id, DUST, B.SAND.id
        ]);
        this.registerShapedRecipe(B.SLIME.id, 1, 3, 3, [
            B.ITEM_SLIMEBALL.id, B.ITEM_SLIMEBALL.id, B.ITEM_SLIMEBALL.id,
            B.ITEM_SLIMEBALL.id, B.ITEM_SLIMEBALL.id, B.ITEM_SLIMEBALL.id,
            B.ITEM_SLIMEBALL.id, B.ITEM_SLIMEBALL.id, B.ITEM_SLIMEBALL.id
        ]);
        this.registerShapedRecipe(B.PAINTING_SALAD_PLATE.id, 1, 3, 3, [
            S, S, S,
            S, B.ITEM_GREEN_DYE.id, S,
            S, S, S
        ]);
        this.registerShapedRecipe(B.PAINTING_DEPTH.id, 1, 3, 3, [
            S, S, S,
            S, B.ITEM_BLUE_DYE.id, S,
            S, S, S
        ]);

        this.registerShapedRecipe(B.COUNTER.id, 1, 3, 2, [
            P, P, P,
            STONE, STONE, STONE
        ]);
        this.registerShapelessRecipe(B.DRAWER_COUNTER.id, 1, [B.COUNTER.id, B.CHEST.id]);
        this.registerShapelessRecipe(B.OVEN_COUNTER.id, 1, [B.COUNTER.id, B.FURNACE.id]);

        this.registerShapedRecipe(B.TRAFFIC_CONE.id, 1, 1, 3, [
            B.ITEM_ORANGE_DYE.id,
            B.ORANGE_CONCRETE.id,
            B.ORANGE_CONCRETE.id
        ]);
        this.registerShapedRecipe(B.TRAFFIC_BARRIER.id, 1, 3, 2, [
            B.WHITE_CONCRETE.id, B.ORANGE_CONCRETE.id, B.WHITE_CONCRETE.id,
            IRON, IRON, IRON
        ]);
        this.registerShapedRecipe(B.TRAFFIC_LIGHT.id, 1, 3, 3, [
            0, B.BLACK_CONCRETE.id, 0,
            B.RED_CONCRETE.id, B.YELLOW_CONCRETE.id, B.LIME_CONCRETE.id,
            0, IRON, 0
        ]);
        this.registerShapedRecipe(B.POLE.id, 2, 1, 2, [IRON, IRON]);

        this.registerShapedRecipe(B.PAVEMENT_BLACK.id, 4, 2, 2, [
            B.BLACK_CONCRETE.id, B.BLACK_CONCRETE.id,
            B.BLACK_CONCRETE.id, B.BLACK_CONCRETE.id
        ]);
        this.registerShapedRecipe(B.PAVEMENT_WHITE.id, 4, 2, 2, [
            B.WHITE_CONCRETE.id, B.WHITE_CONCRETE.id,
            B.WHITE_CONCRETE.id, B.WHITE_CONCRETE.id
        ]);
        this.registerShapelessRecipe(B.PAVEMENT_BLACK_SLOPE.id, 1, [B.PAVEMENT_BLACK.id]);
        this.registerShapelessRecipe(B.PAVEMENT_WHITE_SLOPE.id, 1, [B.PAVEMENT_WHITE.id]);

        this.registerShapedRecipe(B.SCAFFOLDING.id, 6, 3, 3, [
            S, S, S,
            S, P, S,
            S, 0, S
        ]);
        this.registerShapedRecipe(B.SNAIL_STATUE.id, 1, 3, 3, [
            STONE, STONE, STONE,
            STONE, B.ITEM_SLIMEBALL.id, STONE,
            STONE, STONE, STONE
        ]);
        this.registerShapelessRecipe(B.LOGIC.id, 1, [STONE, DUST]);
        this.registerShapedRecipe(B.CCTV_CAMERA.id, 1, 2, 2, [
            IRON, B.GLASS.id,
            B.GLASS.id, DUST
        ]);
        this.registerShapelessRecipe(B.FLINT_CARDOOR.id, 1, [
            B.FLINT.id, B.FLINT.id, B.FLINT.id, B.FLINT.id, IRON
        ]);

        this.registerShapedRecipe(B.BLUESTONE_TORCH.id, 4, 1, 2, [
            B.ITEM_BLUESTONE_DUST_PLACER.id,
            S
        ]);
        this.registerShapelessRecipe(B.ITEM_BLUESTONE_LEVER_PLACER.id, 1, [S, COBBLE]);
        this.registerShapedRecipe(B.BLUESTONE_ROD_PILLAR.id, 2, 1, 2, [
            B.BLUESTONE_ROD.id,
            B.BLUESTONE_ROD.id
        ]);

        this.registerShapelessRecipe(B.SHAFT.id, 2, [P, P, P]);
        this.registerShapedRecipe(B.GEAR.id, 1, 3, 3, [
            0, P, 0,
            P, B.SHAFT.id, P,
            0, P, 0
        ]);
        this.registerShapelessRecipe(B.GEARBOX.id, 1, [B.GEAR.id, P, P, P, P]);
        this.registerShapelessRecipe(B.VERTICAL_GEARBOX.id, 1, [B.GEARBOX.id, B.SHAFT.id]);
        this.registerShapedRecipe(B.LARGE_COG.id, 1, 3, 3, [
            P, P, P,
            P, B.GEAR.id, P,
            P, P, P
        ]);
        this.registerShapedRecipe(B.WATER_WHEEL.id, 1, 3, 3, [
            P, P, P,
            P, B.SHAFT.id, P,
            P, P, P
        ]);
        this.registerShapelessRecipe(B.TURNTABLE.id, 1, [B.GEAR.id, B.SHAFT.id, P, P]);
        this.registerShapelessRecipe(B.MECHANICAL_BEARING.id, 1, [B.GEAR.id, IRON, IRON, IRON, IRON]);
        this.registerShapelessRecipe(B.HORIZONTAL_BEARING.id, 1, [B.MECHANICAL_BEARING.id, IRON]);
        this.registerShapelessRecipe(B.GEARSHIFT.id, 1, [B.GEAR.id, COBBLE, DUST]);
        this.registerShapelessRecipe(B.CLUTCH.id, 1, [B.GEAR.id, COBBLE, B.ITEM_SLIMEBALL.id]);

        this.registerShapelessRecipe(B.GLASS.id, 1, [B.SAND.id, B.ITEM_COAL.id]);
        this.registerShapelessRecipe(B.TERRACOTTA.id, 1, [B.CLAY.id, B.ITEM_COAL.id]);
        this.registerShapedRecipe(B.BOB.id, 1, 3, 3, [
            STONE, STONE, STONE,
            STONE, B.ITEM_BROWN_DYE.id, STONE,
            STONE, STONE, STONE
        ]);

        this.registerShapedRecipe(B.WHITE_WOOL.id, 1, 2, 2, [
            B.ITEM_WHEAT.id, B.ITEM_WHEAT.id,
            B.ITEM_WHEAT.id, B.ITEM_WHEAT.id
        ]);
        const colours = ['orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
        for (const colour of colours) {
            const key = colour.toUpperCase();
            this.registerShapelessRecipe(B[`${key}_WOOL`].id, 1, [
                B.WHITE_WOOL.id, B[`ITEM_${key}_DYE`].id
            ]);
            this.registerShapelessRecipe(B[`${key}_CONCRETE`].id, 1, [B[`${key}_CONCRETE_POWDER`].id]);
            this.registerShapelessRecipe(B[`${key}_TERRACOTTA`].id, 8, [
                B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id,
                B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id,
                B[`ITEM_${key}_DYE`].id
            ]);
        }
        this.registerShapelessRecipe(B.TAN_WOOL.id, 1, [
            B.WHITE_WOOL.id, B.ITEM_ORANGE_DYE.id, B.ITEM_YELLOW_DYE.id
        ]);
        this.registerShapelessRecipe(B.WHITE_CONCRETE.id, 1, [B.WHITE_CONCRETE_POWDER.id]);
        this.registerShapelessRecipe(B.WHITE_TERRACOTTA.id, 8, [
            B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id,
            B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id, B.TERRACOTTA.id,
            B.ITEM_WHITE_DYE.id
        ]);
    }

    static registerAllRecipes() {
        this.registerShapelessRecipe(BlockRegistry.WOOD.id, 4, [BlockRegistry.LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.SPRUCE_PLANKS.id, 4, [BlockRegistry.SPRUCE_LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.BIRCH_PLANKS.id, 4, [BlockRegistry.BIRCH_LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.JUNGLE_PLANKS.id, 4, [BlockRegistry.JUNGLE_LOG.id]);
        this.registerShapelessRecipe(BlockRegistry.ACACIA_PLANKS.id, 4, [BlockRegistry.ACACIA_LOG.id]);
        this.registerShapedRecipe(BlockRegistry.TORCH.id, 4, 1, 2, [BlockRegistry.ITEM_COAL.id, BlockRegistry.ITEM_STICK.id]);
        this.registerShapedRecipe(BlockRegistry.ITEM_BREAD.id, 1, 3, 1, [
            BlockRegistry.ITEM_WHEAT.id, BlockRegistry.ITEM_WHEAT.id, BlockRegistry.ITEM_WHEAT.id
        ]);
        this.registerShapelessRecipe(BlockRegistry.ITEM_PUMPKIN_SLICE.id, 4, [BlockRegistry.PUMPKIN.id]);
        this.registerShapelessRecipe(BlockRegistry.ITEM_MELON_SLICE.id, 9, [BlockRegistry.MELON.id]);
        this.registerShapelessRecipe(BlockRegistry.ITEM_PUMPKIN_PIE.id, 1, [
            BlockRegistry.PUMPKIN.id, BlockRegistry.ITEM_WHEAT.id, BlockRegistry.ITEM_WHEAT.id
        ]);
        this.registerShapelessRecipe(BlockRegistry.ITEM_PUMPKIN_SOUP.id, 1, [
            BlockRegistry.ITEM_PUMPKIN_SLICE.id, BlockRegistry.ITEM_PUMPKIN_SLICE.id, BlockRegistry.ITEM_PUMPKIN_SLICE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.OAK_LADDER.id, 3, 3, 3, [
            BlockRegistry.ITEM_STICK.id, 0, BlockRegistry.ITEM_STICK.id,
            BlockRegistry.ITEM_STICK.id, 0, BlockRegistry.ITEM_STICK.id,
            BlockRegistry.ITEM_STICK.id, 0, BlockRegistry.ITEM_STICK.id
        ]);
        this.registerShapedRecipe(BlockRegistry.WARNING_CONCRETE.id, 4, 2, 2, [
            BlockRegistry.BLACK_CONCRETE.id, BlockRegistry.YELLOW_CONCRETE.id,
            BlockRegistry.YELLOW_CONCRETE.id, BlockRegistry.BLACK_CONCRETE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.ITEM_BUCKET_EMPTY.id, 1, 3, 2, [
            BlockRegistry.ITEM_IRON.id, 0, BlockRegistry.ITEM_IRON.id,
            0, BlockRegistry.ITEM_IRON.id, 0
        ]);
        this.registerShapedRecipe(BlockRegistry.ITEM_COMPASS.id, 1, 3, 3, [
            0, BlockRegistry.ITEM_IRON.id, 0,
            BlockRegistry.ITEM_IRON.id, BlockRegistry.ITEM_BLUESTONE_DUST_PLACER.id, BlockRegistry.ITEM_IRON.id,
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
        this.registerShapedRecipe(BlockRegistry.COBBLESTONE_WALL.id, 6, 3, 2, [
            BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id,
            BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id, BlockRegistry.COBBLE_STONE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.COBBLESTONE_VERTICAL_SLAB.id, 6, 1, 3, [
            BlockRegistry.COBBLE_STONE.id,
            BlockRegistry.COBBLE_STONE.id,
            BlockRegistry.COBBLE_STONE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.MOSSY_COBBLESTONE_SLAB.id, 6, 3, 1, [
            BlockRegistry.MOSSY_COBBLESTONE.id, BlockRegistry.MOSSY_COBBLESTONE.id, BlockRegistry.MOSSY_COBBLESTONE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.MOSSY_COBBLESTONE_VERTICAL_SLAB.id, 6, 1, 3, [
            BlockRegistry.MOSSY_COBBLESTONE.id,
            BlockRegistry.MOSSY_COBBLESTONE.id,
            BlockRegistry.MOSSY_COBBLESTONE.id
        ]);
        this.registerShapedRecipe(BlockRegistry.BRICK_SLAB.id, 6, 3, 1, [
            BlockRegistry.BRICK.id, BlockRegistry.BRICK.id, BlockRegistry.BRICK.id
        ]);
        this.registerShapedRecipe(BlockRegistry.BRICK_WALL.id, 6, 3, 2, [
            BlockRegistry.BRICK.id, BlockRegistry.BRICK.id, BlockRegistry.BRICK.id,
            BlockRegistry.BRICK.id, BlockRegistry.BRICK.id, BlockRegistry.BRICK.id
        ]);
        this.registerShapedRecipe(BlockRegistry.BRICK_VERTICAL_SLAB.id, 6, 1, 3, [
            BlockRegistry.BRICK.id,
            BlockRegistry.BRICK.id,
            BlockRegistry.BRICK.id
        ]);
        this.registerShapelessRecipe(BlockRegistry.CLAY.id, 1, [
            BlockRegistry.ITEM_CLAY_BALL.id, BlockRegistry.ITEM_CLAY_BALL.id,
            BlockRegistry.ITEM_CLAY_BALL.id, BlockRegistry.ITEM_CLAY_BALL.id
        ]);
        this.registerShapelessRecipe(BlockRegistry.FLINT_AND_STEEL.id, 1, [
            BlockRegistry.FLINT.id, BlockRegistry.ITEM_IRON.id,
        ]);
        this.registerShapedRecipe(BlockRegistry.POLISHED_URANIUM.id, 1, 3, 3, [
            BlockRegistry.ITEM_URANIUM.id, BlockRegistry.ITEM_URANIUM.id, BlockRegistry.ITEM_URANIUM.id,
            BlockRegistry.ITEM_URANIUM.id, BlockRegistry.ITEM_URANIUM.id, BlockRegistry.ITEM_URANIUM.id,
            BlockRegistry.ITEM_URANIUM.id, BlockRegistry.ITEM_URANIUM.id, BlockRegistry.ITEM_URANIUM.id
        ]);
        this.registerDyeRecipes();
        this.registerConcretePowderRecipes();
        this.registerColourBuildingRecipes();
        this.registerWoodRecipes();
        this.registerWoodExtras();
        this.registerOreRecipes();
        this.registerBluestoneRecipes();
        this.registerToolRecipes();
        this.registerBuildingRecipes();
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

    static registerColourBuildingRecipes() {
        const B = BlockRegistry;
        const colors = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black', 'tan'];
        for (const color of colors) {
            const key = color.toUpperCase();
            for (const family of ['CONCRETE', 'WOOL']) {
                const block = B[`${key}_${family}`];
                const stairs = B[`${key}_${family}_STAIRS`];
                const slab = B[`${key}_${family}_SLAB`];
                const wall = B[`${key}_${family}_WALL`];
                const verticalSlab = B[`${key}_${family}_VERTICAL_SLAB`];
                if (!block || !stairs || !slab) continue;
                if (wall) {
                    this.registerShapedRecipe(wall.id, 6, 3, 2, [
                        block.id, block.id, block.id,
                        block.id, block.id, block.id
                    ]);
                }
                if (verticalSlab) {
                    this.registerShapedRecipe(verticalSlab.id, 6, 1, 3, [
                        block.id,
                        block.id,
                        block.id
                    ]);
                }
                this.registerShapedRecipe(stairs.id, 4, 3, 3, [
                    block.id, 0,        0,
                    block.id, block.id, 0,
                    block.id, block.id, block.id
                ]);
                this.registerShapedRecipe(slab.id, 6, 3, 1, [
                    block.id, block.id, block.id
                ]);
            }
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

        this.registerShapedRecipe(BlockRegistry.BLUESTONE_CLOCK.id, 1, 3, 3, [
            0, BlockRegistry.ITEM_SAPPHIRE.id, 0,
            STONE, REPEATER, STONE,
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
        return this.registerRecipe(recipe);
    }

    static registerShapelessRecipe(resultTypeId, resultCount = 1, ingredients) {
        const normalizedIngredients = Array.isArray(ingredients) ? ingredients : [];
        const recipe = new ShapelessCraftingRecipe(resultTypeId, resultCount, normalizedIngredients);
        return this.registerRecipe(recipe);
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