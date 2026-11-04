import java.nio.file.*;
import java.util.*;
import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.core.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.*;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.util.RandomSource;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.boss.enderdragon.EndCrystal;
import net.minecraft.world.flag.*;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.block.entity.*;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.levelgen.feature.Feature;
import net.minecraft.world.level.storage.loot.LootTable;

final class StructureFeatureOracle {
    static void load(String path, Map<String, Feature> features) throws Exception {
        var ops = RegistryOps.create(JsonOps.INSTANCE, RegistryAccess.fromRegistryOfRegistries(BuiltInRegistries.REGISTRY));
        var entries = JsonParser.parseString(Files.readString(Path.of(path))).getAsJsonObject();
        for (var entry : entries.entrySet()) features.put(entry.getKey(), Feature.DIRECT_CODEC.parse(ops, entry.getValue()).getOrThrow());
    }
    static BlockPos origin(String mode) {
        if (mode.startsWith("fossil_")) return TemplateOracle.origin(mode);
        return new BlockPos(mode.equals("geode_shifted") ? -21 : mode.equals("end_spike_default") ? 32 : mode.equals("end_spike_far") ? 1000 : mode.equals("end_spike_negative") ? -1 : 0, 20, mode.equals("geode_shifted") ? 31 : 0);
    }
    static BlockState base(String mode, BlockPos pos) {
        if (mode.startsWith("fossil_")) return TemplateOracle.base(mode, pos);
        int x = pos.getX(), y = pos.getY(), z = pos.getZ();
        if (mode.startsWith("geode")) {
            if (mode.equals("geode_air")) return Blocks.AIR.defaultBlockState();
            if (mode.equals("geode_invalid")) return Blocks.LAVA.defaultBlockState();
            if (mode.equals("geode_water") || mode.equals("geode_flooded")) return Blocks.WATER.defaultBlockState();
            if (mode.equals("geode_lava") && y <= 20) return Blocks.LAVA.defaultBlockState();
            if (mode.equals("geode_protected") && (x + z) % 3 == 0) return Blocks.BEDROCK.defaultBlockState();
            return Blocks.STONE.defaultBlockState();
        }
        if (mode.startsWith("lichen_") || mode.startsWith("vein_")) {
            if (mode.equals("lichen_blocked")) return Blocks.STONE.defaultBlockState();
            if (mode.equals("lichen_ceiling")) return (y >= 21 ? Blocks.STONE : Blocks.AIR).defaultBlockState();
            if (mode.equals("lichen_wall")) return (x >= 1 ? Blocks.STONE : Blocks.AIR).defaultBlockState();
            if (mode.equals("lichen_search")) return (x >= 2 ? Blocks.STONE : Blocks.AIR).defaultBlockState();
            if (mode.equals("lichen_wrap") || mode.equals("vein_wrap")) return (x == 0 && z == 0 && y == 19 ? Blocks.STONE : Blocks.AIR).defaultBlockState();
            if (mode.equals("lichen_slab") && y < 20) return Blocks.STONE_SLAB.defaultBlockState();
            if (y < 20) return Blocks.STONE.defaultBlockState();
            if (mode.equals("vein_reject") && (x != 0 || z != 0)) return Blocks.SCULK.defaultBlockState();
            if (mode.equals("vein_replace") && (x != 0 || z != 0)) return Blocks.SHORT_GRASS.defaultBlockState();
            if (mode.equals("vein_fire") && (x != 0 || z != 0)) return Blocks.FIRE.defaultBlockState();
            if (mode.equals("lichen_water") || mode.equals("vein_water")) return Blocks.WATER.defaultBlockState();
            if (mode.equals("lichen_flowing")) return Blocks.WATER.defaultBlockState().setValue(LiquidBlock.LEVEL, 1);
            return Blocks.AIR.defaultBlockState();
        }
        if (mode.startsWith("bonus")) {
            if (mode.equals("bonus_blocked")) return Blocks.STONE.defaultBlockState();
            if (mode.equals("bonus_collision") && y == 32) return Blocks.SHORT_GRASS.defaultBlockState();
            int ground = mode.equals("bonus_uneven") ? 30 + Math.abs(x + z) % 4 : 32;
            if (mode.equals("bonus_torches") && y == 31 && (x + z) % 2 == 0) return Blocks.AIR.defaultBlockState();
            return (y < ground ? Blocks.STONE : Blocks.AIR).defaultBlockState();
        }
        if (mode.startsWith("room")) {
            if (mode.equals("room_floor") && y == 19 || mode.equals("room_ceiling") && y == 24) return Blocks.AIR.defaultBlockState();
            if (!mode.equals("room_no_doors") && (y == 20 || y == 21) && z == 0 && x >= 2) return Blocks.AIR.defaultBlockState();
            if (mode.equals("room_many_doors") && (y == 20 || y == 21)) return Blocks.AIR.defaultBlockState();
            if (mode.equals("room_existing") && y == 20 && x == 0 && z == 1) return Blocks.CHEST.defaultBlockState();
            if (mode.equals("room_existing") && y == 20 && x == 1 && z == 1) return Blocks.SPAWNER.defaultBlockState();
            if (mode.equals("room_protected") && (x + y + z) % 5 == 0) return Blocks.BEDROCK.defaultBlockState();
            return (mode.equals("room_glass") ? Blocks.GLASS : Blocks.STONE).defaultBlockState();
        }
        return Blocks.END_STONE.defaultBlockState();
    }
    static BlockEntity blockEntity(FeatureOracle.World world, BlockPos pos) {
        var state = world.read(pos);
        if (world.mode.equals("bonus_missing") || world.mode.equals("room_missing")) return null;
        if (state.is(Blocks.CHEST)) return new ChestBlockEntity(pos, state) {
            @Override public void setLootTable(ResourceKey<LootTable> table, long seed) {
                super.setLootTable(table, seed);
                world.effects.add(Map.of("kind", "loot", "x", pos.getX(), "y", pos.getY(), "z", pos.getZ(), "table", table.identifier().toString(), "seed", Long.toString(seed), "afterWrites", world.writes.size()));
            }
        };
        if (state.is(Blocks.SPAWNER)) return new SpawnerBlockEntity(pos, state) {
            @Override public void setEntityId(EntityType<?> entity, RandomSource random) {
                super.setEntityId(entity, random);
                world.effects.add(Map.of("kind", "spawner", "x", pos.getX(), "y", pos.getY(), "z", pos.getZ(), "entity", BuiltInRegistries.ENTITY_TYPE.getKey(entity).toString(), "afterWrites", world.writes.size()));
            }
        };
        return null;
    }

    // Only the environment shell bypasses construction; JAR feature/entity code runs normally.
    static final class EntityLevel extends ServerLevel {
        boolean missing;
        long worldSeed;
        private EntityLevel() { super(null, null, null, null, null, null, false, 0, List.of(), false); }
        @Override public FeatureFlagSet enabledFeatures() { return missing ? FeatureFlagSet.of() : FeatureFlags.REGISTRY.allFlags(); }
        @Override public net.minecraft.world.Difficulty getDifficulty() { return net.minecraft.world.Difficulty.NORMAL; }
        @Override public int getNextEntityId() { return 1; }
        @Override public net.minecraft.server.MinecraftServer getServer() { return TemplateOracle.server; }
        @Override public long getSeed() { return worldSeed; }
    }
    static ServerLevel server(FeatureOracle.World world) throws Exception {
        var field = sun.misc.Unsafe.class.getDeclaredField("theUnsafe"); field.setAccessible(true);
        var unsafe = (sun.misc.Unsafe) field.get(null);
        var result = (EntityLevel) unsafe.allocateInstance(EntityLevel.class);
        result.missing = world.mode.equals("end_spike_missing");
        result.worldSeed = world.seed;
        return result;
    }
    static boolean addEntity(FeatureOracle.World world, Entity entity) {
        var crystal = (EndCrystal) entity;
        var effect = new LinkedHashMap<String, Object>();
        effect.put("kind", "crystal"); effect.put("x", crystal.getX()); effect.put("y", crystal.getY()); effect.put("z", crystal.getZ());
        effect.put("yaw", (double) crystal.getYRot()); effect.put("pitch", (double) crystal.getXRot());
        var target = crystal.getBeamTarget(); effect.put("beamTarget", target == null ? null : List.of(target.getX(), target.getY(), target.getZ()));
        effect.put("invulnerable", crystal.isPermanentlyInvulnerable()); effect.put("reason", "structure"); effect.put("afterWrites", world.writes.size());
        world.effects.add(effect); return true;
    }

    static void metadata(long seed) {
        var world = new FeatureOracle.World("end_spike_default", seed);
        var spikes = net.minecraft.world.level.levelgen.feature.EndSpikeFeature.getSpikesForLevel(world.level).stream().map(s ->
            Map.of("centerX", s.getCenterX(), "centerZ", s.getCenterZ(), "radius", s.getRadius(), "height", s.getHeight(), "guarded", s.isGuarded())).toList();
        var legacy = RandomSource.createThreadLocalInstance(seed);
        var draws = new ArrayList<Object>();
        for (int i = 0; i < 16; i++) draws.add(List.of(Long.toString(legacy.nextLong()), legacy.nextInt(3), legacy.nextInt(1073741825), (double) legacy.nextFloat(), legacy.nextDouble()));
        var samples = new ArrayList<Object>();
        double[][] points = {{0,0,0}, {3,24,-6}, {5,19,-2}, {-21,20,31}, {1000000,-64,-1000000}, {0.5,-0.25,3.75}, {33554432, 80, -33554432}};
        for (String definition : List.of("{\"base_octave\":-4,\"normalize\":\"legacy\"}",
                "{\"base_octave\":2,\"base_amplitude\":1.5,\"octave_count\":3,\"normalize\":true,\"amplitude_modifiers\":[1,0,0.5]}",
                "{\"base_octave\":-2,\"octave_count\":2,\"normalize\":false,\"amplitude_modifiers\":[0.25,1]}")) {
            var parameters = JsonParser.parseString(definition);
            var noise = net.minecraft.world.level.levelgen.synth.NormalNoise.DIRECT_CODEC.parse(JsonOps.INSTANCE, parameters).getOrThrow()
                .create(new net.minecraft.world.level.levelgen.WorldgenRandom(new net.minecraft.world.level.levelgen.LegacyRandomSource(seed)));
            var values = new ArrayList<Object>();
            for (var point : points) values.add(Map.of("position", point, "bits", Float.floatToRawIntBits(noise.get(point[0], point[1], point[2]))));
            samples.add(Map.of("parameters", parameters, "values", values));
        }
        net.minecraft.server.Bootstrap.realStdoutPrintln("STRUCTURE," + FeatureOracle.JSON.toJson(Map.of("seed", Long.toString(seed), "spikes", spikes, "draws", draws, "noise", samples)));
    }
}
