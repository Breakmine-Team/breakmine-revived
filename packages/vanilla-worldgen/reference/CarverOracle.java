import java.lang.reflect.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.zip.ZipFile;
import com.google.gson.*;
import com.mojang.serialization.JsonOps;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.util.RandomSource;
import net.minecraft.world.level.ChunkPos;
import net.minecraft.world.level.LevelAccessor;
import net.minecraft.world.level.chunk.CarverOutput;
import net.minecraft.world.level.chunk.CarvingMask;
import net.minecraft.world.level.levelgen.LegacyRandomSource;
import net.minecraft.world.level.levelgen.WorldGenerationContext;
import net.minecraft.world.level.levelgen.WorldgenRandom;
import net.minecraft.world.level.levelgen.carver.WorldCarver;

public class CarverOracle {
    record Probe(String id, long seed, int index, int originX, int originZ, int targetX, int targetZ, int minY, int maxY, int sea) {}

    static WorldGenerationContext context(int minY, int maxY, int sea) throws Exception {
        LevelAccessor level = (LevelAccessor)Proxy.newProxyInstance(LevelAccessor.class.getClassLoader(), new Class<?>[]{LevelAccessor.class}, (proxy, method, args) -> switch (method.getName()) {
            case "getMinY" -> minY;
            case "getHeight" -> maxY - minY;
            case "getSeaLevel" -> sea;
            case "toString" -> "CarverOracleLevel";
            default -> throw new UnsupportedOperationException(method.getName());
        });
        var constructor = WorldGenerationContext.class.getDeclaredConstructor(LevelAccessor.class);
        constructor.setAccessible(true);
        return constructor.newInstance(level);
    }

    static String name(String id) { return id.substring("minecraft:".length()); }

    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        var sinField = net.minecraft.util.Mth.class.getDeclaredField("SIN");
        sinField.setAccessible(true);
        float[] sinTable = (float[])sinField.get(null);
        var sinBytes = java.nio.ByteBuffer.allocate(sinTable.length * 4).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        for (float value : sinTable) sinBytes.putInt(Float.floatToRawIntBits(value));
        java.nio.file.Files.write(java.nio.file.Path.of(args[2]), sinBytes.array());
        List<Probe> probes = new ArrayList<>();
        long[] seeds = new long[40];
        for (int i = 0; i < 32; i++) seeds[i] = i;
        seeds[32] = -1L;
        seeds[33] = 1337L;
        seeds[34] = 6888349110149677383L;
        seeds[35] = Long.MIN_VALUE;
        seeds[36] = Long.MAX_VALUE;
        seeds[37] = 9007199254740993L;
        seeds[38] = -1234567890123456789L;
        seeds[39] = 42424242L;
        int[][] positions = {{0,0,0,0}, {-1,-1,0,0}, {8,-3,1,-1}};
        String[] ids = {"minecraft:cave", "minecraft:cave_extra_underground", "minecraft:canyon", "minecraft:nether_cave"};
        List<String> rows = new ArrayList<>();
        String drawTrace = "";
        for (long seed : seeds) for (int index : new int[]{0,1}) for (String id : ids) for (int[] p : positions) {
            boolean nether = id.equals("minecraft:nether_cave");
            int minY = nether ? 0 : -64, maxY = nether ? 128 : 320, sea = nether ? 32 : 63;
            probes.add(new Probe(id, seed, index, p[0], p[1], p[0]+p[2], p[1]+p[3], minY, maxY, sea));
        }
        try (var jar = new ZipFile(args[0])) {
            for (Probe p : probes) {
                String path = "data/minecraft/worldgen/carver/" + name(p.id()) + ".json";
                JsonObject json;
                try (var in = jar.getInputStream(jar.getEntry(path))) {
                    json = JsonParser.parseReader(new java.io.InputStreamReader(in, StandardCharsets.UTF_8)).getAsJsonObject();
                }
                WorldCarver carver = WorldCarver.DIRECT_CODEC.parse(JsonOps.INSTANCE, json).getOrThrow();
                WorldgenRandom random = new WorldgenRandom(new LegacyRandomSource(0L));
                random.setLargeFeatureSeed(p.seed() + p.index(), p.originX(), p.originZ());
                boolean start = carver.isStartChunk(random);
                int maskMin = p.minY() + 1, maskMax = p.maxY() - 8;
                int maskHeight = maskMax - maskMin + 1;
                BitSet mask = new BitSet(256 * maskHeight);
                CarverOutput output = new CarverOutput() {
                    public int minY() { return maskMin; }
                    public int maxY() { return maskMax; }
                    public void carve(int x, int y, int z) { mask.set((x * 16 + z) * maskHeight + y - maskMin); }
                };
                if (start) carver.carve(context(p.minY(), p.maxY(), p.sea()), random,
                    new ChunkPos(p.targetX(), p.targetZ()), new ChunkPos(p.originX(), p.originZ()), output);
                if (p.id().equals("minecraft:cave") && p.seed() == 13L && p.index() == 1 && p.originX() == -1 && p.originZ() == -1) {
                    WorldgenRandom traceBase = new WorldgenRandom(new LegacyRandomSource(0L));
                    traceBase.setLargeFeatureSeed(p.seed() + p.index(), p.originX(), p.originZ());
                    List<String> calls = new ArrayList<>();
                    RandomSource traceRandom = (RandomSource)Proxy.newProxyInstance(RandomSource.class.getClassLoader(), new Class<?>[]{RandomSource.class}, (proxy, method, callArgs) -> {
                        try {
                            Object value = method.invoke(traceBase, callArgs);
                            if (method.getName().startsWith("next") && value != null) {
                                String arg = callArgs == null || callArgs.length == 0 ? "" : ":" + callArgs[0];
                                String out = value instanceof Float f ? Integer.toString(Float.floatToRawIntBits(f)) : value.toString();
                                calls.add(method.getName() + arg + "=" + out);
                            }
                            return value;
                        } catch (InvocationTargetException error) { throw error.getCause(); }
                    });
                    if (carver.isStartChunk(traceRandom)) carver.carve(context(p.minY(), p.maxY(), p.sea()), traceRandom,
                        new ChunkPos(p.targetX(), p.targetZ()), new ChunkPos(p.originX(), p.originZ()), output);
                    drawTrace = String.join("\n", calls);
                }
                byte[] fixed = new byte[(256 * maskHeight + 7) / 8];
                byte[] compact = mask.toByteArray();
                System.arraycopy(compact, 0, fixed, 0, Math.min(compact.length, fixed.length));
                rows.add(String.join(",", p.id(), Long.toString(p.seed()), Integer.toString(p.index()),
                    Integer.toString(p.originX()), Integer.toString(p.originZ()), Integer.toString(p.targetX()), Integer.toString(p.targetZ()),
                    Integer.toString(p.minY()), Integer.toString(p.maxY()), Integer.toString(p.sea()), Boolean.toString(start),
                    Base64.getEncoder().encodeToString(fixed)));
            }
        }
        java.nio.file.Files.writeString(java.nio.file.Path.of(args[1]), String.join("\n", rows), StandardCharsets.UTF_8);
        java.nio.file.Files.writeString(java.nio.file.Path.of(args[3]), drawTrace, StandardCharsets.UTF_8);
    }
}
