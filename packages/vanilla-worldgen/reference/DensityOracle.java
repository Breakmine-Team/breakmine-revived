import java.util.*;
import java.util.zip.ZipFile;
import com.google.gson.*;
import com.mojang.serialization.*;
import net.minecraft.SharedConstants;
import net.minecraft.core.*;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.*;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.biome.*;
import net.minecraft.world.level.levelgen.RandomState;
import net.minecraft.world.level.levelgen.NoiseRouter;
import net.minecraft.world.level.levelgen.Aquifer;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.levelgen.densityfunction.*;
import net.minecraft.world.level.levelgen.synth.*;

public class DensityOracle {
    static final String[] FIELDS = {"temperature", "vegetation", "continents", "erosion", "depth", "ridges"};

    static JsonElement expand(JsonElement value, Map<String, JsonElement> data) {
        if (value.isJsonPrimitive() && value.getAsJsonPrimitive().isString()) {
            String id = value.getAsString();
            if (!id.startsWith("minecraft:")) return value;
            JsonElement referenced = data.get("data/minecraft/worldgen/density_function/" + id.replace("minecraft:", "") + ".json");
            if (referenced != null) return expand(referenced, data);
        }
        if (value.isJsonObject()) {
            var result = new JsonObject();
            for (var entry : value.getAsJsonObject().entrySet()) {
                boolean reference = !Set.of("type", "noise", "axis", "tiling").contains(entry.getKey());
                result.add(entry.getKey(), reference ? expand(entry.getValue(), data) : entry.getValue());
            }
            return result;
        }
        if (value.isJsonArray()) {
            var result = new JsonArray();
            for (var child : value.getAsJsonArray()) result.add(expand(child, data));
            return result;
        }
        return value;
    }

    @SuppressWarnings("unchecked")
    static Climate.ParameterList<String> biomeList(boolean nether) throws Exception {
        var preset = nether ? MultiNoiseBiomeSourceParameterList.Preset.NETHER : MultiNoiseBiomeSourceParameterList.Preset.OVERWORLD;
        Object provider = preset.provider();
        var method = provider.getClass().getDeclaredMethod("apply", java.util.function.Function.class);
        method.setAccessible(true);
        java.util.function.Function<ResourceKey<Biome>,String> names = key -> key.identifier().toString();
        return (Climate.ParameterList<String>)method.invoke(provider, names);
    }

    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        Map<String, JsonElement> data = new TreeMap<>();
        try (var jar = new ZipFile(args[0])) {
            for (var entry : jar.stream().filter(e -> e.getName().startsWith("data/minecraft/worldgen/") && e.getName().endsWith(".json")).toList()) {
                try (var reader = new java.io.InputStreamReader(jar.getInputStream(entry), java.nio.charset.StandardCharsets.UTF_8)) {
                    data.put(entry.getName(), JsonParser.parseReader(reader));
                }
            }
        }
        var noises = new MappedRegistry<NormalNoise>(Registries.NOISE, Lifecycle.stable());
        for (var entry : data.entrySet()) {
            if (!entry.getKey().startsWith("data/minecraft/worldgen/noise/")) continue;
            String id = "minecraft:" + entry.getKey().replace("data/minecraft/worldgen/noise/", "").replace(".json", "");
            Registry.register(noises, id, NormalNoise.DIRECT_CODEC.parse(JsonOps.INSTANCE, entry.getValue()).getOrThrow());
        }
        noises.freeze();
        var ops = RegistryOps.create(JsonOps.INSTANCE, HolderLookup.Provider.create(java.util.stream.Stream.of(noises)));
        var output = new JsonArray();
        var primitiveOutput = new JsonArray();
        var terrainOutput = new JsonArray();
        var volumeOutput = new JsonArray();
        var endChunkOutput = new JsonArray();
        var fixtures = JsonParser.parseString(java.nio.file.Files.readString(java.nio.file.Path.of(args[1]))).getAsJsonObject();
        var points = new ArrayList<int[]>();
        for (int x : new int[]{-30000000,-17,-16,-1,0,1,15,16,17,30000000}) {
            for (int y : new int[]{-80,-64,-1,0,63,64,319,320,400}) points.add(new int[]{x,y,-x});
        }
        for (int i=0; i<256; i++) points.add(new int[]{(i-128)*7919, -64+i%384, (i-71)*-104729});
        for (long seed : new long[]{0,1,-1,Long.MIN_VALUE,Long.MAX_VALUE,9007199254740993L,-1234567890123456789L}) {
            for (String settings : new String[]{"overworld","large_biomes","amplified","nether","end"}) {
                var router = data.get("data/minecraft/worldgen/noise_settings/" + settings + ".json").getAsJsonObject().getAsJsonObject("noise_router");
                var actualRouter = NoiseRouter.CODEC.parse(ops, expand(router, data)).getOrThrow();
                boolean legacy = data.get("data/minecraft/worldgen/noise_settings/" + settings + ".json").getAsJsonObject().get("legacy_random_source").getAsBoolean();
                var state = RandomState.create(noises, seed, legacy, Blocks.STONE.defaultBlockState(), 63, actualRouter);
                var terrainRoots = new JsonObject();
                terrainRoots.add("final_density", router.get("final_density"));
                String dimension = settings.equals("nether") || settings.equals("end") ? settings : "overworld";
                terrainRoots.addProperty("base", "minecraft:" + dimension + "/base_3d_noise");
                if (dimension.equals("overworld")) {
                    String prefix = settings.equals("overworld") ? "overworld" : "overworld_" + settings;
                    for (String name : new String[]{"sloped_cheese","factor","jaggedness"}) terrainRoots.addProperty(name, "minecraft:" + prefix + "/" + name);
                }
                var terrainSamplers = new ArrayList<DensitySampler.Bound>();
                for (var entry : terrainRoots.entrySet()) {
                    var function = DensityFunction.CODEC.parse(ops, expand(entry.getValue(), data)).getOrThrow();
                    terrainSamplers.add(state.getSampler(function).bind(SamplerContext.EMPTY_UNCACHED));
                }
                var terrainRow = new JsonObject(); terrainRow.addProperty("seed", Long.toString(seed)); terrainRow.addProperty("settings", settings);
                terrainRow.addProperty("legacy", legacy); terrainRow.add("roots", terrainRoots);
                var terrainSamples = new JsonArray();
                for (int[] p : points) {
                    var sample = new JsonObject(); sample.add("position", new Gson().toJsonTree(p));
                    var bits = new JsonArray();
                    for (var sampler : terrainSamplers) bits.add(Float.floatToRawIntBits(sampler.sampleValue(p[0],p[1],p[2])));
                    sample.add("bits", bits); terrainSamples.add(sample);
                }
                terrainRow.add("samples", terrainSamples); terrainOutput.add(terrainRow);
                if (!settings.equals("end") && (seed == 0 || seed == -1)) {
                    for (int[] origin : new int[][]{{0,-64,0},{-17,-61,15}}) {
                        var volume = new DensityVolume(16,384,16,origin[0],origin[1],origin[2]);
                        var buffer = DensityBuffer.createUnpooled(volume.size());
                        terrainSamplers.get(0).sampleVolume(buffer,volume);
                        var rowVolume = new JsonObject();
                        rowVolume.addProperty("seed",Long.toString(seed)); rowVolume.addProperty("settings",settings);
                        rowVolume.addProperty("legacy",legacy); rowVolume.add("root",router.get("final_density"));
                        rowVolume.add("origin",new Gson().toJsonTree(origin));
                        var volumeBits = new JsonArray();
                        for (int i=0;i<volume.size();i++) volumeBits.add(Float.floatToRawIntBits(buffer.get(i)));
                        rowVolume.add("bits",volumeBits); volumeOutput.add(rowVolume);
                        var settingData=data.get("data/minecraft/worldgen/noise_settings/"+settings+".json").getAsJsonObject();
                        int sea=settingData.get("sea_level").getAsInt();
                        var defaultFluid=settingData.get("default_fluid");
                        boolean lava=(defaultFluid.isJsonPrimitive() ? defaultFluid.getAsString() : defaultFluid.getAsJsonObject().get("Name").getAsString()).equals("minecraft:lava");
                        var lavaStatus=new Aquifer.FluidStatus(-54,Blocks.LAVA.defaultBlockState());
                        var seaStatus=new Aquifer.FluidStatus(sea,lava ? Blocks.LAVA.defaultBlockState() : Blocks.WATER.defaultBlockState());
                        Aquifer.FluidPicker picker=(x,y,z)->y<Math.min(-54,sea) ? lavaStatus : seaStatus;
                        var aqData=settingData.get("aquifers");
                        Aquifer aq;
                        if (aqData!=null && !aqData.isJsonNull()) {
                            var config=Aquifer.Config.CODEC.parse(ops,expand(aqData,data)).getOrThrow();
                            aq=config.create(state.samplersWithContext(SamplerContext.builder().enableCaches().build()),state.getOrCreateRandomFactory(Identifier.withDefaultNamespace("aquifer")),volume,picker);
                        } else { aq=Aquifer.createDisabled(picker); }
                        byte[] substances=new byte[volume.size()];
                        Aquifer carvingAquifer;
                        if (aqData!=null && !aqData.isJsonNull()) {
                            var config=Aquifer.Config.CODEC.parse(ops,expand(aqData,data)).getOrThrow();
                            carvingAquifer=config.create(state.samplersWithContext(SamplerContext.builder().enableCaches().build()),state.getOrCreateRandomFactory(Identifier.withDefaultNamespace("aquifer")),volume,picker);
                        } else { carvingAquifer=Aquifer.createDisabled(picker); }
                        byte[] carvingSubstances=new byte[volume.size()];
                        for (int z=0;z<16;z++) for (int x=0;x<16;x++) for (int y=0;y<384;y++) {
                            int i=volume.indexUnchecked(x,y,z);
                            BlockState block=aq.computeSubstance(volume.blockX(x),volume.blockY(y),volume.blockZ(z),buffer.get(i));
                            int kind=block==null ? 0 : block.isAir() ? 1 : block.is(Blocks.WATER) ? 2 : block.is(Blocks.LAVA) ? 3 : -1;
                            if (kind<0) throw new IllegalStateException("Unexpected aquifer block: "+block);
                            substances[i]=(byte)(kind | (aq.shouldScheduleFluidUpdate() ? 16 : 0));
                            BlockState carvingBlock=carvingAquifer.computeSubstance(volume.blockX(x),volume.blockY(y),volume.blockZ(z),0);
                            int carvingKind=carvingBlock==null ? 0 : carvingBlock.isAir() ? 1 : carvingBlock.is(Blocks.WATER) ? 2 : carvingBlock.is(Blocks.LAVA) ? 3 : -1;
                            if (carvingKind<0) throw new IllegalStateException("Unexpected carving aquifer block: "+carvingBlock);
                            carvingSubstances[i]=(byte)(carvingKind | (carvingAquifer.shouldScheduleFluidUpdate() ? 16 : 0));
                        }
                        rowVolume.add("aquifers",aqData==null ? JsonNull.INSTANCE : aqData);
                        rowVolume.addProperty("sea",sea); rowVolume.addProperty("fluid",lava ? 3 : 2);
                        rowVolume.addProperty("substances",Base64.getEncoder().encodeToString(substances));
                        rowVolume.addProperty("carvingSubstances",Base64.getEncoder().encodeToString(carvingSubstances));
                    }
                }
                if (settings.equals("end") && (seed == 0 || seed == -1)) {
                    for (int[] origin : new int[][]{{0,0,0},{-17,0,15}}) {
                        var volume = new DensityVolume(16,128,16,origin[0],origin[1],origin[2]);
                        var buffer = DensityBuffer.createUnpooled(volume.size());
                        terrainSamplers.get(0).sampleVolume(buffer,volume);
                        var row = new JsonObject();
                        row.addProperty("seed",Long.toString(seed)); row.add("origin",new Gson().toJsonTree(origin));
                        row.add("root",router.get("final_density"));
                        var bits = new JsonArray();
                        for (int i=0;i<volume.size();i++) bits.add(Float.floatToRawIntBits(buffer.get(i)));
                        row.add("bits",bits); endChunkOutput.add(row);
                    }
                }
                if (settings.equals("end")) continue;
                if (settings.equals("overworld")) {
                    for (var entry : fixtures.entrySet()) {
                        var function = DensityFunction.CODEC.parse(ops, expand(entry.getValue(), data)).getOrThrow();
                        var sampler = state.getSampler(function).bind(SamplerContext.EMPTY_UNCACHED);
                        var fixture = new JsonObject(); fixture.addProperty("seed", Long.toString(seed)); fixture.addProperty("name", entry.getKey());
                        var samples = new JsonArray();
                        for (int coordinate : new int[]{-30000000,-5,-4,-3,-2,-1,0,1,2,3,4,5,30000000}) {
                            var sample = new JsonObject();
                            int[] position = {coordinate,coordinate,-coordinate};
                            sample.add("position", new Gson().toJsonTree(position));
                            sample.addProperty("bits", Float.floatToRawIntBits(sampler.sampleValue(position[0],position[1],position[2])));
                            samples.add(sample);
                        }
                        fixture.add("samples", samples); primitiveOutput.add(fixture);
                    }
                }
                var samplers = new DensitySampler.Bound[6];
                for (int i=0; i<FIELDS.length; i++) {
                    var function = DensityFunction.CODEC.parse(ops, expand(router.get(FIELDS[i]), data)).getOrThrow();
                    samplers[i] = state.getSampler(function).bind(SamplerContext.EMPTY_UNCACHED);
                }
                var climate = state.createClimateSampler(SamplerContext.EMPTY_UNCACHED);
                var biomes = biomeList(settings.equals("nether"));
                var row = new JsonObject(); row.addProperty("seed", Long.toString(seed)); row.addProperty("settings", settings);
                var samples = new JsonArray();
                for (int[] p : points) {
                    var sample = new JsonObject(); sample.add("position", new Gson().toJsonTree(p));
                    var bits = new JsonArray();
                    for (var sampler : samplers) bits.add(Float.floatToRawIntBits(sampler.sampleValue(p[0],p[1],p[2])));
                    sample.add("bits", bits);
                    sample.addProperty("biome", biomes.findValue(climate.sample(p[0] >> 2,p[1] >> 2,p[2] >> 2)));
                    samples.add(sample);
                }
                row.add("samples", samples); output.add(row);
            }
        }
        Bootstrap.STDOUT.println("DENSITY:" + output);
        Bootstrap.STDOUT.println("DENSITY_OPS:" + primitiveOutput);
        Bootstrap.STDOUT.println("DENSITY_TERRAIN:" + terrainOutput);
        Bootstrap.STDOUT.println("DENSITY_VOLUMES:" + volumeOutput);
        Bootstrap.STDOUT.println("DENSITY_END_CHUNKS:" + endChunkOutput);
    }
}
