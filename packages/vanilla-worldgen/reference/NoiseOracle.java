import java.util.zip.ZipFile;
import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.world.level.levelgen.XoroshiroRandomSource;
import net.minecraft.world.level.levelgen.synth.NormalNoise;

public class NoiseOracle {
    public static void main(String[] args) throws Exception {
        long[] seeds = {0, 1, -1, Long.MIN_VALUE, Long.MAX_VALUE, 9007199254740993L, -1234567890123456789L};
        var points = new java.util.ArrayList<double[]>();
        for (double[] p : new double[][]{{0,0,0}, {-0.01,-64.5,0.1}, {16,319,-16}, {1000000.25,42,-999999.75}, {16777216,-16777216,33554432.125}}) points.add(p);
        for (int i=0; i<32; i++) points.add(new double[]{(i-16)*7919.125, -64+i*12.5, (i-7)*-104729.25});
        int[][] positions = {{0,0,0},{-1,-64,1},{30000000,319,-30000000},{Integer.MIN_VALUE,Integer.MAX_VALUE,-17}};
        String[] names = {"", "octave_-10", "minecraft:temperature", "Монгол 🌍", "x".repeat(55), "x".repeat(56), "x".repeat(64), "x".repeat(129)};
        var output = new JsonArray();
        var definitions = new java.util.TreeMap<String, JsonObject>();
        try (var jar = new ZipFile(args[0])) {
            for (var entry : jar.stream().filter(e -> e.getName().startsWith("data/minecraft/worldgen/noise/") && e.getName().endsWith(".json")).toList()) {
                try (var reader = new java.io.InputStreamReader(jar.getInputStream(entry), java.nio.charset.StandardCharsets.UTF_8)) {
                    definitions.put(entry.getName(), JsonParser.parseReader(reader).getAsJsonObject());
                }
            }
        }
        for (String mode : new String[]{"true", "false", "\"legacy\""}) {
            for (String modifiers : new String[]{"[0,0,0,0]", "[1,0,0.125,2]", "[1,1,1,1]"}) {
                definitions.put("test:" + mode + modifiers, JsonParser.parseString("{\"base_octave\":-3,\"octave_count\":4,\"base_amplitude\":0.7,\"normalize\":" + mode + ",\"amplitude_modifiers\":" + modifiers + "}").getAsJsonObject());
            }
        }
        for (long seed : seeds) {
            var random = new XoroshiroRandomSource(seed);
            var factory = random.forkPositional();
            for (int[] p : positions) {
                var row = new JsonObject(); row.addProperty("kind", "at"); row.addProperty("seed", Long.toString(seed));
                row.add("position", new Gson().toJsonTree(p));
                var values = new JsonArray(); var r = factory.at(p[0],p[1],p[2]);
                for (int i=0; i<16; i++) values.add(Long.toString(r.nextLong()));
                row.add("values", values); output.add(row);
            }
            for (String name : names) {
                var row = new JsonObject(); row.addProperty("kind", "hash"); row.addProperty("seed", Long.toString(seed)); row.addProperty("name", name);
                var values = new JsonArray(); var r = factory.fromHashOf(name);
                for (int i=0; i<16; i++) values.add(Long.toString(r.nextLong()));
                row.add("values", values); output.add(row);
            }
            for (long child : seeds) {
                var row = new JsonObject(); row.addProperty("kind", "seed"); row.addProperty("seed", Long.toString(seed)); row.addProperty("child", Long.toString(child));
                var values = new JsonArray(); var r = factory.fromSeed(child);
                for (int i=0; i<16; i++) values.add(Long.toString(r.nextLong()));
                row.add("values", values); output.add(row);
            }
            for (var entry : definitions.entrySet()) {
                for (boolean named : new boolean[]{false, true}) {
                if (named && !entry.getKey().startsWith("data/")) continue;
                var definition = NormalNoise.DIRECT_CODEC.parse(JsonOps.INSTANCE, entry.getValue()).getOrThrow();
                String id = "minecraft:" + entry.getKey().replace("data/minecraft/worldgen/noise/", "").replace(".json", "");
                var source = named ? factory.fromHashOf(id) : new XoroshiroRandomSource(seed);
                var noise = definition.create(source);
                var row = new JsonObject(); row.addProperty("kind", "normal"); row.addProperty("seed", Long.toString(seed));
                row.addProperty("id", entry.getKey()); row.add("parameters", entry.getValue());
                if (named) row.addProperty("identifier", id);
                var samples = new JsonArray();
                for (double[] p : points) {
                    var sample = new JsonObject(); sample.add("position", new Gson().toJsonTree(p));
                    sample.addProperty("bits", Float.floatToRawIntBits(noise.get(p[0],p[1],p[2]))); samples.add(sample);
                }
                row.add("samples", samples); row.addProperty("nextLong", Long.toString(source.nextLong())); output.add(row);
                }
            }
        }
        System.out.println("NOISE:" + output);
    }
}
