import com.google.gson.Gson;
import java.lang.reflect.InvocationHandler;
import java.lang.reflect.Proxy;
import java.util.*;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.*;
import net.minecraft.world.level.biome.*;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.entity.BeehiveBlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.chunk.*;
import net.minecraft.world.level.levelgen.XoroshiroRandomSource;
import net.minecraft.world.level.levelgen.feature.*;
import net.minecraft.world.level.levelgen.blockpredicates.BlockPredicate;
import net.minecraft.world.level.levelgen.feature.stateproviders.*;
import net.minecraft.world.level.levelgen.structure.templatesystem.BlockMatchTest;
import net.minecraft.util.valueproviders.*;

public final class FeatureOracle {
    static final Gson JSON = new com.google.gson.GsonBuilder().serializeNulls().create();
    static final Map<String, Feature> expandedFeatures = new LinkedHashMap<>();
    static PalettedContainerFactory factory;
    static Holder<Biome> oracleBiome;
    static Map<String, Object> write(BlockPos pos, BlockState state, int flags) {
        var properties = new TreeMap<String, String>();
        state.getValues().forEach(value -> properties.put(value.property().getName(), value.valueName()));
        return Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ(), "name", BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString(), "properties", properties, "flags", flags);
    }
    static final class World {
        final String mode;
        final Map<BlockPos, BlockState> blocks = new HashMap<>();
        final Map<Long, ProtoChunk> chunks = new HashMap<>();
        final List<Map<String, Object>> writes = new ArrayList<>();
        final List<List<Integer>> marks = new ArrayList<>();
        final List<Map<String, Object>> ticks = new ArrayList<>();
        final List<Map<String, Object>> destroyed = new ArrayList<>();
        final List<Map<String, Object>> gatewayExits = new ArrayList<>();
        final List<Map<String, Object>> effects = new ArrayList<>();
        final long seed;
        final RandomSource worldRandom;
        final WorldGenLevel level;
        World(String mode, long seed) {
            this.mode = mode;
            this.seed = seed;
            this.worldRandom = RandomSource.create(seed);
            level = (WorldGenLevel) Proxy.newProxyInstance(FeatureOracle.class.getClassLoader(), new Class<?>[] {WorldGenLevel.class}, (proxy, method, args) -> {
                switch (method.getName()) {
                    case "getSeed": return seed;
                    case "getRandom": return worldRandom;
                    case "registryAccess": return RegistryAccess.fromRegistryOfRegistries(BuiltInRegistries.REGISTRY);
                    case "updateNeighborsAt": return null;
                    case "environmentAttributes": return net.minecraft.world.attribute.EnvironmentAttributeReader.EMPTY;
                    case "getLevel": return StructureFeatureOracle.server(this);
                    case "addFreshEntity": return StructureFeatureOracle.addEntity(this, (net.minecraft.world.entity.Entity) args[0]);
                    case "getMinY": return 0;
                    case "getMaxY": return mode.equals("fossil_clip") ? 15 : 63;
                    case "getHeight": return args == null || args.length == 0 ? 64 : mode.startsWith("tree_") ? 20 : mode.equals("fossil_uneven") ? 31 + Math.abs((int) args[1] + (int) args[2]) % 5 : mode.equals("bonus_uneven") ? 30 + Math.abs((int) args[1] + (int) args[2]) % 4 : mode.startsWith("bamboo") ? 20 : mode.equals("root_height") ? 22 : mode.equals("large_heightgate") ? 11 : 32;
                    case "getSeaLevel": return 32;
                    case "getBiome": return oracleBiome;
                    case "getBrightness": return 0;
                    case "getBlockState": return read((BlockPos) args[0]);
                    case "getBlockEntity": {
                        var pos = ((BlockPos) args[0]).immutable();
                        if (args.length > 1 && args[1] instanceof BlockEntityType<?> type) {
                            return type.isValid(read(pos)) ? Optional.of(type.create(pos, read(pos))) : Optional.empty();
                        }
                        if (expandedFeatures.containsKey(mode)) return StructureFeatureOracle.blockEntity(this, pos);
                        if (mode.equals("gateway_missing")) return null;
                        if (mode.equals("gateway_wrong")) return new net.minecraft.world.level.block.entity.TheEndPortalBlockEntity(pos, Blocks.END_PORTAL.defaultBlockState());
                        if (!read(pos).is(Blocks.END_GATEWAY)) return null;
                        return new net.minecraft.world.level.block.entity.TheEndGatewayBlockEntity(pos, read(pos)) {
                            @Override public void setExitPosition(BlockPos exit, boolean exact) {
                                gatewayExits.add(Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ(),
                                    "exit", List.of(exit.getX(), exit.getY(), exit.getZ()), "exact", exact, "afterWrites", writes.size()));
                            }
                        };
                    }
                    case "getFluidState": return read((BlockPos) args[0]).getFluidState();
                    case "isFluidAtPosition": return ((java.util.function.Predicate<net.minecraft.world.level.material.FluidState>) args[1]).test(read((BlockPos) args[0]).getFluidState());
                    case "isEmptyBlock": return read((BlockPos) args[0]).isAir();
                    case "isStateAtPosition": return ((java.util.function.Predicate<BlockState>) args[1]).test(read((BlockPos) args[0]));
                    case "destroyBlock": {
                        var pos = ((BlockPos) args[0]).immutable();
                        destroyed.add(Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ(), "drop", args[1]));
                        if (read(pos).isAir()) return false;
                        blocks.put(pos, Blocks.AIR.defaultBlockState()); writes.add(write(pos, Blocks.AIR.defaultBlockState(), 3)); return true;
                    }
                    case "setBlock": case "setBlockAndUpdate": {
                        var pos = ((BlockPos) args[0]).immutable(); var state = (BlockState) args[1];
                        int flags = args.length > 2 ? (int) args[2] : 3;
                        blocks.put(pos, state); writes.add(write(pos, state, flags)); return true;
                    }
                    case "getChunk": return args[0] instanceof BlockPos pos ? chunk(pos.getX() >> 4, pos.getZ() >> 4) : chunk((int) args[0], (int) args[1]);
                    case "ensureCanWrite": return !mode.equals("ore_blocked") || ((BlockPos) args[0]).getX() >= 0;
                    case "markPosForPostProcessing": {
                        var pos = (BlockPos) args[0]; marks.add(List.of(pos.getX(), pos.getY(), pos.getZ())); return null;
                    }
                    case "scheduleTick": {
                        var pos = (BlockPos) args[0]; boolean block = args[1] instanceof Block;
                        String name = block ? BuiltInRegistries.BLOCK.getKey((Block) args[1]).toString()
                            : BuiltInRegistries.FLUID.getKey((net.minecraft.world.level.material.Fluid) args[1]).toString();
                        ticks.add(Map.of("x", pos.getX(), "y", pos.getY(), "z", pos.getZ(), "type", block ? "block" : "fluid", "name", name, "delay", args[2])); return null;
                    }
                }
                if (method.isDefault()) return InvocationHandler.invokeDefault(proxy, method, args);
                throw new UnsupportedOperationException(mode + ": " + method);
            });
        }
        BlockState base(BlockPos pos) {
            if (expandedFeatures.containsKey(mode) && !mode.startsWith("tree_")) return StructureFeatureOracle.base(mode, pos);
            int y = pos.getY();
            if (mode.startsWith("tree_")) return y >= 20 ? Blocks.AIR.defaultBlockState() : y == 19 ? Blocks.GRASS_BLOCK.defaultBlockState() : y >= 16 ? Blocks.DIRT.defaultBlockState() : Blocks.STONE.defaultBlockState();
            return switch (mode) {
                case "iceberg_packed", "iceberg_blue" -> y < 32 ? Blocks.WATER.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "iceberg_blocked", "podium_stone", "fill_blocked" -> Blocks.STONE.defaultBlockState();
                case "iceberg_frozen" -> y == 32 ? Blocks.ICE.defaultBlockState() : y < 32 ? Blocks.WATER.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "iceberg_snow_layers" -> y == 33 ? Blocks.SNOW.defaultBlockState().setValue(SnowLayerBlock.LAYERS, 2) : y == 32 ? Blocks.PACKED_ICE.defaultBlockState() : y < 32 ? Blocks.WATER.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "iceberg_holes" -> y < 32 && (pos.getX() * pos.getX() + pos.getZ() * pos.getZ()) % 3 != 0 ? Blocks.WATER.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "iceberg_cave_air" -> y < 32 ? Blocks.WATER.defaultBlockState() : Blocks.CAVE_AIR.defaultBlockState();
                case "iceberg_dry", "podium_air", "gateway_delayed", "gateway_return", "gateway_search", "gateway_missing", "gateway_wrong", "fill_air" -> Blocks.AIR.defaultBlockState();
                case "fill_mixed" -> (pos.getX() + pos.getZ()) % 3 == 0 ? Blocks.DIRT.defaultBlockState() : Blocks.CAVE_AIR.defaultBlockState();
                case "podium_active", "podium_inactive" -> y < 20 ? Blocks.END_STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "podium_water" -> Blocks.WATER.defaultBlockState();
                case "podium_preexisting" -> y == 20 && pos.getX() * pos.getX() + pos.getZ() * pos.getZ() < 2.5 * 2.5 ? Blocks.END_PORTAL.defaultBlockState() : y < 20 ? Blocks.END_STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pointed_floor", "pointed_sulfur", "pointed_spread" -> y < 20 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pointed_ceiling" -> y > 20 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pointed_both" -> y != 20 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pointed_water" -> y < 20 ? Blocks.STONE.defaultBlockState() : Blocks.WATER.defaultBlockState();
                case "pointed_blocked", "cluster_line" -> Blocks.AIR.defaultBlockState();
                case "cluster", "cluster_wet", "cluster_sulfur" -> y <= 17 || y >= 27 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "cluster_merge" -> y <= 19 || y >= 22 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "cluster_water" -> y <= 17 || y >= 27 ? Blocks.STONE.defaultBlockState() : Blocks.WATER.defaultBlockState();
                case "cluster_lava" -> y <= 17 ? Blocks.LAVA.defaultBlockState() : y >= 27 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "cluster_floor" -> y <= 17 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "cluster_ceiling" -> y >= 27 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "cluster_blocked", "large_blocked" -> Blocks.STONE.defaultBlockState();
                case "large", "large_wind", "large_radius1", "large_heightgate" -> y <= 10 || y >= 35 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "large_shrink" -> (y <= 10 || y >= 35) && Math.abs(pos.getX()) <= 3 && Math.abs(pos.getZ()) <= 3 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "large_water" -> y <= 10 || y >= 35 ? Blocks.STONE.defaultBlockState() : Blocks.WATER.defaultBlockState();
                case "large_lava" -> y <= 10 ? Blocks.LAVA.defaultBlockState() : y >= 35 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "large_open" -> y <= 10 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "large_short" -> y <= 19 || y >= 23 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pillar", "pillar_cap", "pillar_down", "stepped", "stepped_blocked", "random_block" -> y < 20 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pillar_blocked", "coral_tree_blocked", "coral_claw_blocked" -> Blocks.STONE.defaultBlockState();
                case "stepped_raised" -> y < 20 || pos.getX() > 0 && y < 22 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "patch", "patch_empty", "patch_zero" -> y < 18 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "coral_tree", "coral_claw", "cuboid", "cuboid_faces", "cuboid_shell", "cuboid_random", "random_chance", "random_selected", "height_biased", "height_biased_empty" -> Blocks.AIR.defaultBlockState();
                case "fungus_crimson", "fungus_planted", "fungus_warped", "fungus_height", "fungus_blocked" -> y < (mode.equals("fungus_height") ? 60 : 20) ?
                    (mode.equals("fungus_blocked") ? Blocks.STONE : mode.equals("fungus_warped") ? Blocks.WARPED_NYLIUM : Blocks.CRIMSON_NYLIUM).defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "chorus", "chorus_blocked", "chorus_wall" -> y < 20 ? (mode.equals("chorus_blocked") ? Blocks.STONE : Blocks.END_STONE).defaultBlockState()
                    : mode.equals("chorus_wall") && pos.getX() == 1 && y >= 23 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "column", "column_tip" -> y < 20 || y >= 24 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "pile" -> y < 20 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "blob" -> y < 20 ? Blocks.DIRT.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "replace" -> y <= 20 ? Blocks.NETHERRACK.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "spread" -> y == 21 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "disk" -> y <= 21 ? Blocks.DIRT.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "spring" -> pos.equals(new BlockPos(1, 20, 0)) ? Blocks.AIR.defaultBlockState() : Blocks.STONE.defaultBlockState();
                case "bamboo", "bamboo_blocked" -> y < 20 ? Blocks.BAMBOO.defaultBlockState() : mode.equals("bamboo_blocked") && y == 24 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "blue_ice" -> pos.equals(new BlockPos(1, 20, 0)) ? Blocks.PACKED_ICE.defaultBlockState() : y <= 20 ? Blocks.WATER.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "delta" -> y <= 20 ? Blocks.NETHERRACK.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "magma" -> y <= 18 ? Blocks.STONE.defaultBlockState() : Blocks.WATER.defaultBlockState();
                case "brown", "red" -> y < 20 ? Blocks.DIRT.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "spike", "spike_high" -> y < (mode.equals("spike_high") ? 60 : 20) ? Blocks.SNOW_BLOCK.defaultBlockState() : Blocks.AIR.defaultBlockState();
                case "lake", "lake_rejected", "lake_protected", "lake_air_barrier", "lake_water" -> Blocks.STONE.defaultBlockState();
                case "root", "root_level", "root_water", "root_blocked", "root_height", "root_water_blocked" -> {
                    if (pos.equals(new BlockPos(0, 20, 0))) yield Blocks.AIR.defaultBlockState();
                    if (mode.startsWith("root_water") && y == 24 || mode.equals("root_water_blocked") && y == 25) yield Blocks.WATER.defaultBlockState();
                    yield y <= 22 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                }
                case "fallen_blocked" -> Blocks.STONE.defaultBlockState();
                case "fallen_gap" -> y == 19 && Math.max(Math.abs(pos.getX()), Math.abs(pos.getZ())) >= 4 || y >= 20 ? Blocks.AIR.defaultBlockState() : Blocks.STONE.defaultBlockState();
                case "fallen", "fallen_birch", "fallen_mushrooms", "fallen_poplar" -> y < 20 ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
                default -> y < 32 && !(pos.getX() == 2 && pos.getZ() == 1) ? Blocks.STONE.defaultBlockState() : Blocks.AIR.defaultBlockState();
            };
        }
        BlockState read(BlockPos pos) {
            if (mode.startsWith("ore") || expandedFeatures.containsKey(mode) && !mode.startsWith("tree_")) return chunk(pos.getX() >> 4, pos.getZ() >> 4).getBlockState(pos);
            return blocks.getOrDefault(pos, base(pos));
        }
        ProtoChunk chunk(int x, int z) {
            return chunks.computeIfAbsent(ChunkPos.pack(x, z), key -> {
                var sections = new LevelChunkSection[4];
                for (int sy = 0; sy < 4; sy++) {
                    final int sectionY = sy;
                    sections[sy] = new LevelChunkSection(factory) {
                        boolean tracking;
                        {
                            for (int bx = 0; bx < 16; bx++) for (int by = 0; by < 16; by++) for (int bz = 0; bz < 16; bz++)
                                super.setBlockState(bx, by, bz, base(new BlockPos(x * 16 + bx, sectionY * 16 + by, z * 16 + bz)), false);
                            tracking = true;
                        }
                        @Override public BlockState setBlockState(int bx, int by, int bz, BlockState state, boolean acquire) {
                            if (tracking) writes.add(FeatureOracle.write(new BlockPos(x * 16 + bx, sectionY * 16 + by, z * 16 + bz), state, 0));
                            return super.setBlockState(bx, by, bz, state, acquire);
                        }
                    };
                }
                return new ProtoChunk(new ChunkPos(x, z), UpgradeData.EMPTY, sections,
                    new net.minecraft.world.ticks.ProtoChunkTicks<>(), new net.minecraft.world.ticks.ProtoChunkTicks<>(), level, factory, null) {
                    @Override public void markPosForPostProcessing(BlockPos pos) {
                        marks.add(List.of(pos.getX(), pos.getY(), pos.getZ()));
                    }
                };
            });
        }
    }
    static Holder<net.minecraft.world.level.levelgen.placement.PlacedFeature> unit(BlockStateProvider provider, net.minecraft.world.level.levelgen.placement.PlacementModifier... modifiers) {
        return Holder.direct(new net.minecraft.world.level.levelgen.placement.PlacedFeature(Holder.direct(new BlockColumnFeature(
            List.of(BlockColumnFeature.layer(ConstantInt.of(1), provider)), Direction.UP, BlockPredicate.matchesBlocks(Blocks.AIR), false)), List.of(modifiers)));
    }
    static Feature feature(String mode) {
        if (expandedFeatures.containsKey(mode)) return expandedFeatures.get(mode);
        var stone = new BlockMatchTest(Blocks.STONE);
        var ore = List.of(new BlockReplacement(stone, Blocks.DIAMOND_ORE.defaultBlockState()));
        return switch (mode) {
            case "iceberg_packed", "iceberg_blue", "iceberg_blocked", "iceberg_frozen", "iceberg_snow_layers", "iceberg_dry", "iceberg_holes", "iceberg_cave_air" -> new IcebergFeature((mode.equals("iceberg_blue") ? Blocks.BLUE_ICE : Blocks.PACKED_ICE).defaultBlockState());
            case "podium_active", "podium_inactive", "podium_air", "podium_preexisting", "podium_stone", "podium_water" -> new EndPodiumFeature(!mode.equals("podium_inactive"));
            case "gateway_delayed", "gateway_return", "gateway_search", "gateway_missing", "gateway_wrong" -> new EndGatewayFeature(mode.equals("gateway_delayed") ? Optional.empty() : Optional.of(new BlockPos(100, 50, -8)), !mode.equals("gateway_search") && !mode.equals("gateway_delayed"));
            case "fill_air", "fill_mixed", "fill_blocked" -> new FillLayerFeature(4, Blocks.BASALT.defaultBlockState());
            case "pointed_floor", "pointed_ceiling", "pointed_both", "pointed_water", "pointed_blocked", "pointed_sulfur", "pointed_spread" -> new SpeleothemFeature(
                (mode.equals("pointed_sulfur") ? Blocks.SULFUR : Blocks.DRIPSTONE_BLOCK).defaultBlockState(),
                (mode.equals("pointed_sulfur") ? Blocks.SULFUR_SPIKE : Blocks.POINTED_DRIPSTONE).defaultBlockState(), HolderSet.direct(Blocks.STONE.builtInRegistryHolder()),
                mode.equals("pointed_spread") ? 1 : 0.2f, mode.equals("pointed_spread") ? 1 : 0.7f, mode.equals("pointed_spread") ? 1 : 0.5f, mode.equals("pointed_spread") ? 1 : 0.5f);
            case "cluster", "cluster_wet", "cluster_water", "cluster_lava", "cluster_floor", "cluster_ceiling", "cluster_line", "cluster_blocked", "cluster_sulfur", "cluster_merge" -> new SpeleothemClusterFeature(
                (mode.equals("cluster_sulfur") ? Blocks.SULFUR : Blocks.DRIPSTONE_BLOCK).defaultBlockState(),
                (mode.equals("cluster_sulfur") ? Blocks.SULFUR_SPIKE : Blocks.POINTED_DRIPSTONE).defaultBlockState(), HolderSet.direct(Blocks.STONE.builtInRegistryHolder()),
                12, mode.equals("cluster_merge") ? ConstantInt.of(8) : UniformInt.of(3, 6), UniformInt.of(2, 4), 1, 3, UniformInt.of(2, 4),
                mode.equals("cluster_merge") ? ConstantFloat.of(1) : new UniformFloat(0.3f, 0.7f),
                mode.equals("cluster_wet") ? ConstantFloat.of(1) : mode.equals("cluster_sulfur") || mode.equals("cluster_merge") ? ConstantFloat.ZERO : ClampedNormalFloat.of(0.1f, 0.3f, 0.1f, 0.9f),
                mode.equals("cluster_merge") ? 1 : 0.1f, 3, 8);
            case "large", "large_wind", "large_shrink", "large_lava", "large_water", "large_open", "large_short", "large_blocked", "large_radius1", "large_heightgate" -> new LargeDripstoneFeature(
                HolderSet.direct(Blocks.STONE.builtInRegistryHolder()), 30,
                mode.equals("large_radius1") ? ConstantInt.of(1) : mode.equals("large_shrink") ? ConstantInt.of(8) : mode.equals("large_wind") ? ConstantInt.of(6) : ClampedInt.of(UniformInt.of(3, 19), 3, 16),
                new UniformFloat(0.4f, 2), 0.33f, new UniformFloat(0.3f, 0.9f), new UniformFloat(0.4f, 1), new UniformFloat(0, 0.3f),
                mode.equals("large_wind") ? 0 : 4, mode.equals("large_wind") ? 0 : mode.equals("large_shrink") ? 5 : 0.6f);
            case "pillar", "pillar_cap", "pillar_blocked", "pillar_down" -> new SingleBlockPillarFeature(BlockStateProvider.holderOf(Blocks.BASALT),
                BlockPredicate.matchesBlocks(Blocks.AIR), mode.equals("pillar_down") ? Direction.DOWN : Direction.UP, 0.75f,
                mode.equals("pillar") || mode.equals("pillar_down") ? Optional.empty() : Optional.of(unit(BlockStateProvider.of(Blocks.GLOWSTONE))));
            case "patch", "patch_empty", "patch_zero" -> new ProjectedRandomPatchySquare(
                mode.equals("patch_empty") ? Holder.direct(new RandomBlockProvider(HolderSet.direct(List.of()))) : BlockStateProvider.holderOf(Blocks.MOSS_BLOCK),
                BlockPredicate.matchesBlocks(Blocks.AIR), UniformInt.of(1, 3), mode.equals("patch_zero") ? 0 : 5);
            case "stepped", "stepped_blocked", "stepped_raised" -> new SteppedColumnClusterFeature(BlockStateProvider.holderOf(Blocks.BASALT),
                BlockPredicate.matchesBlocks(Blocks.BASALT), BlockPredicate.matchesBlocks(Blocks.AIR),
                HolderSet.direct((mode.equals("stepped_blocked") ? Blocks.STONE : Blocks.BEDROCK).builtInRegistryHolder()), UniformInt.of(1, 2), UniformInt.of(3, 5), UniformInt.of(1, 3), UniformInt.of(3, 7));
            case "coral_tree", "coral_tree_blocked" -> new CoralTreeFeature(unit(BlockStateProvider.of(Blocks.FIRE_CORAL_BLOCK),
                net.minecraft.world.level.levelgen.placement.BlockPredicateFilter.forPredicate(BlockPredicate.matchesBlocks(Blocks.AIR))));
            case "coral_claw", "coral_claw_blocked" -> new CoralClawFeature(unit(BlockStateProvider.of(Blocks.FIRE_CORAL_BLOCK),
                net.minecraft.world.level.levelgen.placement.BlockPredicateFilter.forPredicate(BlockPredicate.matchesBlocks(Blocks.AIR))));
            case "fungus_crimson", "fungus_planted", "fungus_warped", "fungus_height", "fungus_blocked" -> new HugeFungusFeature(
                (mode.equals("fungus_warped") ? Blocks.WARPED_NYLIUM : Blocks.CRIMSON_NYLIUM).defaultBlockState(),
                (mode.equals("fungus_warped") ? Blocks.WARPED_STEM : Blocks.CRIMSON_STEM).defaultBlockState(),
                (mode.equals("fungus_warped") ? Blocks.WARPED_WART_BLOCK : Blocks.NETHER_WART_BLOCK).defaultBlockState(), Blocks.SHROOMLIGHT.defaultBlockState(),
                BlockPredicate.matchesBlocks(Blocks.AIR), mode.equals("fungus_planted"));
            case "chorus", "chorus_blocked", "chorus_wall" -> new ChorusPlantFeature();
            case "random_block" -> new BlockColumnFeature(List.of(BlockColumnFeature.layer(ConstantInt.of(5), new RandomBlockProvider(
                HolderSet.direct(Blocks.BASALT.builtInRegistryHolder(), Blocks.STONE.builtInRegistryHolder())))), Direction.UP, BlockPredicate.matchesBlocks(Blocks.AIR), false);
            case "cuboid", "cuboid_faces", "cuboid_shell", "cuboid_random", "random_chance", "random_selected", "height_biased", "height_biased_empty" -> {
                net.minecraft.world.level.levelgen.placement.PlacementModifier modifier;
                if (mode.startsWith("height_biased")) modifier = new net.minecraft.world.level.levelgen.placement.HeightRangePlacement(
                    net.minecraft.world.level.levelgen.heightproviders.BiasedToBottomHeight.of(net.minecraft.world.level.levelgen.VerticalAnchor.aboveBottom(mode.equals("height_biased_empty") ? 50 : 2),
                        net.minecraft.world.level.levelgen.VerticalAnchor.absolute(mode.equals("height_biased_empty") ? 51 : 50), 3));
                else if (mode.equals("random_chance")) modifier = new net.minecraft.world.level.levelgen.placement.RandomChancePlacement(0.35f);
                else if (mode.equals("random_selected")) modifier = new net.minecraft.world.level.levelgen.placement.RandomlySelectedPlacement(
                    new net.minecraft.world.level.levelgen.placement.RandomChancePlacement(0.35f), new CuboidPlacement(ConstantInt.of(2), ConstantInt.of(1), true, true));
                else modifier = new CuboidPlacement(mode.equals("cuboid_random") ? UniformInt.of(1, 3) : ConstantInt.of(3),
                    mode.equals("cuboid_random") ? UniformInt.of(1, 3) : ConstantInt.of(3), !mode.equals("cuboid_faces"), !mode.equals("cuboid_faces") && !mode.equals("cuboid_shell"));
                yield new SequenceFeature(HolderSet.direct(unit(BlockStateProvider.of(Blocks.STONE), modifier)));
            }
            case "column", "column_tip" -> new BlockColumnFeature(List.of(
                BlockColumnFeature.layer(UniformInt.of(2, 5), BlockStateProvider.of(Blocks.CACTUS)),
                BlockColumnFeature.layer(ConstantInt.of(1), BlockStateProvider.of(Blocks.CACTUS_FLOWER))),
                Direction.UP, BlockPredicate.matchesBlocks(Blocks.AIR), mode.equals("column_tip"));
            case "pile" -> new BlockPileFeature(Holder.direct(new RotatedBlockProvider(BlockStateProvider.of(Blocks.HAY_BLOCK))));
            case "blob" -> new BlockBlobFeature(Blocks.MOSSY_COBBLESTONE.defaultBlockState(), BlockPredicate.matchesBlocks(Blocks.DIRT));
            case "replace" -> new ReplaceBlobsFeature(Blocks.NETHERRACK.defaultBlockState(), Blocks.MAGMA_BLOCK.defaultBlockState(), UniformInt.of(1, 3));
            case "spread" -> new RandomNeighborSpreadFeature(BlockStateProvider.holderOf(Blocks.GLOWSTONE), HolderSet.direct(Blocks.GLOWSTONE.builtInRegistryHolder()),
                BlockPredicate.matchesBlocks(Blocks.AIR), ConstantInt.of(80), UniformInt.of(-2, 2), UniformInt.of(-3, 0));
            case "disk" -> new DiskFeature(Holder.direct(new RuleBasedStateProvider(BlockStateProvider.holderOf(Blocks.SAND), List.of(
                new RuleBasedStateProvider.Rule(BlockPredicate.matchesBlocks(Direction.DOWN, Blocks.AIR), BlockStateProvider.holderOf(Blocks.SANDSTONE))))),
                BlockPredicate.matchesBlocks(Blocks.DIRT), UniformInt.of(2, 4), 2);
            case "spring" -> new SpringFeature(net.minecraft.world.level.material.Fluids.WATER.defaultFluidState(), true, 4, 1, HolderSet.direct(Blocks.STONE.builtInRegistryHolder()));
            case "scattered" -> new ScatteredOreFeature(ore, 9, 1);
            case "ore", "ore_blocked" -> new OreFeature(ore, 33, 0.5f);
            case "end_island" -> new EndIslandFeature();
            case "single" -> new ReplaceBlockFeature(ore);
            case "bamboo", "bamboo_blocked" -> new BambooFeature(1);
            case "blue_ice" -> new BlueIceFeature();
            case "delta" -> new DeltaFeature(Blocks.LAVA.defaultBlockState(), Blocks.MAGMA_BLOCK.defaultBlockState(), UniformInt.of(3, 7), UniformInt.of(0, 2));
            case "magma" -> new UnderwaterMagmaFeature(5, 1, 0.5f);
            case "brown", "red" -> {
                var cap = BlockStateProvider.holderOf((mode.equals("brown") ? Blocks.BROWN_MUSHROOM_BLOCK : Blocks.RED_MUSHROOM_BLOCK).defaultBlockState().setValue(HugeMushroomBlock.DOWN, false));
                var stem = BlockStateProvider.holderOf(Blocks.MUSHROOM_STEM.defaultBlockState().setValue(HugeMushroomBlock.DOWN, false).setValue(HugeMushroomBlock.UP, false));
                yield mode.equals("brown") ? new HugeBrownMushroomFeature(cap, stem, 3, BlockPredicate.matchesBlocks(Blocks.DIRT))
                    : new HugeRedMushroomFeature(cap, stem, 2, BlockPredicate.matchesBlocks(Blocks.DIRT));
            }
            case "spike", "spike_high" -> new SpikeFeature(Blocks.PACKED_ICE.defaultBlockState(), BlockPredicate.matchesBlocks(Blocks.SNOW_BLOCK), BlockPredicate.matchesBlocks(Blocks.SNOW_BLOCK, Blocks.PACKED_ICE, Blocks.ICE));
            case "lake", "lake_rejected", "lake_protected", "lake_air_barrier", "lake_water" -> new LakeFeature(BlockStateProvider.holderOf(mode.equals("lake_water") ? Blocks.WATER : Blocks.LAVA),
                BlockStateProvider.holderOf(mode.equals("lake_air_barrier") ? Blocks.AIR : Blocks.BASALT),
                mode.equals("lake_rejected") ? BlockPredicate.not(BlockPredicate.alwaysTrue()) : BlockPredicate.alwaysTrue(),
                mode.equals("lake_protected") ? BlockPredicate.not(BlockPredicate.matchesBlocks(Blocks.STONE)) : BlockPredicate.alwaysTrue(), BlockPredicate.alwaysTrue());
            case "end_platform" -> new EndPlatformFeature();
            case "void_platform", "void_far" -> new VoidStartPlatformFeature();
            case "root", "root_level", "root_water", "root_blocked", "root_height", "root_water_blocked" -> new RootSystemFeature(
                Holder.direct(new net.minecraft.world.level.levelgen.placement.PlacedFeature(Holder.direct(new BlockColumnFeature(
                    List.of(BlockColumnFeature.layer(ConstantInt.of(1), BlockStateProvider.of(Blocks.OAK_LOG))), Direction.UP, BlockPredicate.matchesBlocks(Blocks.AIR), false)), List.of())),
                3, mode.equals("root_level") ? 1 : 0, 1, 3, HolderSet.direct(Blocks.STONE.builtInRegistryHolder()), BlockStateProvider.holderOf(Blocks.ROOTED_DIRT),
                20, 8, 3, 2, BlockStateProvider.holderOf(Blocks.HANGING_ROOTS), 20, 2,
                mode.equals("root_blocked") ? BlockPredicate.not(BlockPredicate.alwaysTrue()) : BlockPredicate.matchesBlocks(Blocks.AIR));
            case "fallen", "fallen_birch", "fallen_mushrooms", "fallen_poplar", "fallen_blocked", "fallen_gap" -> {
                var mushroom = mode.equals("fallen_poplar") ? BlockStateProvider.holderOf(Blocks.BROWN_MUSHROOM)
                    : Holder.<BlockStateProvider>direct(new WeightedStateProvider(net.minecraft.util.random.WeightedList.<BlockState>builder()
                        .add(Blocks.RED_MUSHROOM.defaultBlockState(), 2).add(Blocks.BROWN_MUSHROOM.defaultBlockState(), 1)));
                var attached = new net.minecraft.world.level.levelgen.feature.treedecorators.AttachedToLogsDecorator(mode.equals("fallen_mushrooms") ? 1 : 0.1f, mushroom, List.of(Direction.UP));
                yield new FallenTreeFeature(BlockStateProvider.holderOf(mode.equals("fallen_poplar") ? Blocks.POPLAR_LOG : mode.equals("fallen_birch") ? Blocks.BIRCH_LOG : Blocks.OAK_LOG),
                    UniformInt.of(mode.equals("fallen_birch") ? 5 : 4, mode.equals("fallen_birch") ? 15 : 7),
                    mode.equals("fallen_birch") || mode.equals("fallen_poplar") ? List.of() : List.of(net.minecraft.world.level.levelgen.feature.treedecorators.TrunkVineDecorator.INSTANCE),
                    mode.equals("fallen_poplar") ? List.of(attached, new net.minecraft.world.level.levelgen.feature.treedecorators.ShelfMushroomDecorator(0.8f)) : List.of(attached));
            }
            default -> throw new IllegalArgumentException(mode);
        };
    }
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion(); Bootstrap.bootStrap();
        BuiltInRegistries.BLOCK.prepareTagReload(new net.minecraft.tags.TagLoader.LoadResult<>(
            net.minecraft.core.registries.Registries.BLOCK,
            Map.of(net.minecraft.tags.BlockTags.BASE_STONE_OVERWORLD, List.<Holder<Block>>of(Blocks.STONE.builtInRegistryHolder()),
                net.minecraft.tags.BlockTags.SUPPORTS_BAMBOO, List.<Holder<Block>>of(Blocks.BAMBOO.builtInRegistryHolder()),
                net.minecraft.tags.BlockTags.SUPPORTS_CHORUS_PLANT, List.<Holder<Block>>of(Blocks.END_STONE.builtInRegistryHolder()),
                net.minecraft.tags.BlockTags.FEATURES_CANNOT_REPLACE, List.<Holder<Block>>of(Blocks.BEDROCK.builtInRegistryHolder()),
                net.minecraft.tags.BlockTags.MANGROVE_ROOTS_CAN_GROW_THROUGH, List.<Holder<Block>>of(Blocks.MUD.builtInRegistryHolder(), Blocks.MUDDY_MANGROVE_ROOTS.builtInRegistryHolder(), Blocks.MANGROVE_ROOTS.builtInRegistryHolder(), Blocks.MOSS_CARPET.builtInRegistryHolder(), Blocks.VINE.builtInRegistryHolder(), Blocks.MANGROVE_PROPAGULE.builtInRegistryHolder(), Blocks.SNOW.builtInRegistryHolder()),
                net.minecraft.tags.BlockTags.MANGROVE_LOGS_CAN_GROW_THROUGH, List.<Holder<Block>>of(Blocks.MUD.builtInRegistryHolder(), Blocks.MUDDY_MANGROVE_ROOTS.builtInRegistryHolder(), Blocks.MANGROVE_ROOTS.builtInRegistryHolder(), Blocks.MANGROVE_LEAVES.builtInRegistryHolder(), Blocks.MANGROVE_LOG.builtInRegistryHolder(), Blocks.MANGROVE_PROPAGULE.builtInRegistryHolder(), Blocks.MOSS_CARPET.builtInRegistryHolder(), Blocks.VINE.builtInRegistryHolder()),
                net.minecraft.tags.BlockTags.FIRE, List.<Holder<Block>>of(Blocks.FIRE.builtInRegistryHolder())))).apply();
        BuiltInRegistries.FLUID.prepareTagReload(new net.minecraft.tags.TagLoader.LoadResult<>(
            net.minecraft.core.registries.Registries.FLUID,
            Map.of(net.minecraft.tags.FluidTags.WATER, List.<Holder<net.minecraft.world.level.material.Fluid>>of(net.minecraft.world.level.material.Fluids.WATER.builtInRegistryHolder()),
                net.minecraft.tags.FluidTags.LAVA, List.<Holder<net.minecraft.world.level.material.Fluid>>of(net.minecraft.world.level.material.Fluids.LAVA.builtInRegistryHolder())))).apply();
        var biome = Holder.direct(new Biome.BiomeBuilder().hasPrecipitation(false).temperature(0.5f).downfall(0)
            .specialEffects(new BiomeSpecialEffects.Builder().waterColor(0).build())
            .mobSpawnSettings(MobSpawnSettings.EMPTY).generationSettings(BiomeGenerationSettings.EMPTY).build());
        oracleBiome = biome;
        var biomes = new IdMapper<Holder<Biome>>(); biomes.add(biome);
        factory = new PalettedContainerFactory(Strategy.createForBlockStates(Block.BLOCK_STATE_REGISTRY), Blocks.AIR.defaultBlockState(), null,
            Strategy.createForBiomes(biomes), biome, null);
        var generator = new net.minecraft.world.level.levelgen.FlatLevelSource(new net.minecraft.world.level.levelgen.flat.FlatLevelGeneratorSettings(Optional.empty(), biome, List.of())) {
            @Override public int getGenDepth() { return 64; }
            @Override public int getMinY() { return 0; }
            @Override public int getSeaLevel() { return 32; }
        };
        StructureFeatureOracle.load(args[0], expandedFeatures);
        TemplateOracle.initialize();
        TemplateOracle.beardifier();
        TemplateOracle.templates(args[1]);
        for (long seed : new long[] {0, 1, -91, 912337, Long.MAX_VALUE, 8}) StructureFeatureOracle.metadata(seed);
        var modes = new ArrayList<>(List.of("column", "column_tip", "pile", "blob", "replace", "spread", "disk", "spring", "scattered", "ore", "ore_blocked", "end_island", "single",
                "bamboo", "bamboo_blocked", "blue_ice", "delta", "magma", "brown", "red", "spike", "spike_high", "lake", "lake_rejected", "lake_protected", "lake_air_barrier", "lake_water", "end_platform", "void_platform", "void_far",
                "root", "root_level", "root_water", "root_blocked", "root_height", "root_water_blocked",
                "fallen", "fallen_birch", "fallen_mushrooms", "fallen_poplar", "fallen_blocked", "fallen_gap",
                "pillar", "pillar_cap", "pillar_blocked", "pillar_down", "patch", "patch_empty", "patch_zero", "stepped", "stepped_blocked", "stepped_raised",
                "coral_tree", "coral_tree_blocked", "coral_claw", "coral_claw_blocked", "fungus_crimson", "fungus_planted", "fungus_warped", "fungus_height", "fungus_blocked",
                "chorus", "chorus_blocked", "chorus_wall", "random_block", "cuboid", "cuboid_faces", "cuboid_shell", "cuboid_random", "random_chance", "random_selected",
                "height_biased", "height_biased_empty",
                "pointed_floor", "pointed_ceiling", "pointed_both", "pointed_water", "pointed_blocked", "pointed_sulfur", "pointed_spread",
                "cluster", "cluster_wet", "cluster_water", "cluster_lava", "cluster_floor", "cluster_ceiling", "cluster_line", "cluster_blocked", "cluster_sulfur", "cluster_merge",
                "large", "large_wind", "large_shrink", "large_lava", "large_water", "large_open", "large_short", "large_blocked", "large_radius1", "large_heightgate",
                "iceberg_packed", "iceberg_blue", "iceberg_blocked", "iceberg_frozen", "iceberg_snow_layers", "iceberg_dry", "iceberg_holes", "iceberg_cave_air",
                "podium_active", "podium_inactive", "podium_air", "podium_preexisting", "podium_stone", "podium_water",
                "gateway_delayed", "gateway_return", "gateway_search", "gateway_missing", "gateway_wrong", "fill_air", "fill_mixed", "fill_blocked"));
        modes.addAll(expandedFeatures.keySet());
        if (args.length > 2 && args[2].equals("tree-only")) modes.removeIf(mode -> !mode.startsWith("tree_"));
        for (String mode : modes) {
            long[] seeds = mode.startsWith("iceberg_") ? new long[] {0, 1, -91, 912337, Long.MAX_VALUE, 8, 11, 20} : new long[] {0, 1, -91, 912337, Long.MAX_VALUE, 8};
            if (args.length > 3 && args[2].equals("tree-only")) seeds = Arrays.stream(args[3].split(",")).mapToLong(Long::parseLong).toArray();
            for (long seed : seeds) {
                var world = new World(mode, seed); var random = new XoroshiroRandomSource(seed);
                boolean result;
                try { result = feature(mode).place(world.level, generator, random, expandedFeatures.containsKey(mode) ? StructureFeatureOracle.origin(mode) : new BlockPos(mode.equals("void_far") ? 48 : 0, mode.equals("spike_high") || mode.equals("fungus_height") ? 60 : 20, 0)); }
                catch (Throwable error) { Bootstrap.realStdoutPrintln("ERROR," + mode + "," + error + "," + Arrays.toString(error.getStackTrace())); throw error; }
                Bootstrap.realStdoutPrintln("FEATURE," + JSON.toJson(Map.of("mode", mode, "seed", Long.toString(seed), "succeeded", result,
                    "writes", world.writes, "marks", world.marks, "ticks", world.ticks, "destroyed", world.destroyed, "gatewayExits", world.gatewayExits, "effects", world.effects, "nextLong", Long.toString(random.nextLong()))));
            }
        }
    }
}
