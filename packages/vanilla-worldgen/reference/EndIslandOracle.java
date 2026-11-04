import java.lang.reflect.Method;
import java.lang.reflect.Proxy;
import net.minecraft.util.RandomSource;
import net.minecraft.server.Bootstrap;
import net.minecraft.SharedConstants;
import net.minecraft.world.level.levelgen.LegacyRandomSource;
import net.minecraft.world.level.levelgen.densityfunction.DensityFunction;
import net.minecraft.world.level.levelgen.densityfunction.DensitySampler;
import net.minecraft.world.level.levelgen.densityfunction.DensityFunctions;
import net.minecraft.world.level.levelgen.densityfunction.DistanceMetric;
import net.minecraft.world.level.levelgen.densityfunction.generator.EndIslandFunction;
import net.minecraft.core.Vec3i;

public final class EndIslandOracle {
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        int[][] positions = {
            {0, 0, 0}, {1024, 64, -1024}, {32000, 80, 26000},
            {-25000000, 20, 25000000}, {12345, 100, -54321},
            {8000000, 0, -12000000}, {-16000000, 255, 17000000}
        };
        Method height = EndIslandFunction.class.getDeclaredMethod("getHeightValue",
            net.minecraft.world.level.levelgen.synth.SimplexNoise.class, int.class, int.class);
        height.setAccessible(true);
        for (long seed : new long[] {0L, 1L, -1L, 123456789L, Long.MIN_VALUE, Long.MAX_VALUE}) {
            DensityFunction.CompileContext context = (DensityFunction.CompileContext)Proxy.newProxyInstance(
                DensityFunction.CompileContext.class.getClassLoader(),
                new Class<?>[] {DensityFunction.CompileContext.class},
                (proxy, method, values) -> {
                    if (method.getName().equals("createEndIslandRandom")) return (RandomSource)new LegacyRandomSource(seed);
                    throw new UnsupportedOperationException(method.getName());
                });
            DensitySampler sampler = new EndIslandFunction().compileSampler(context);
            DensityFunction endGraph = DensityFunctions.max(
                DensityFunctions.mul(
                    DensityFunctions.sub(
                        DensityFunctions.clamp(DensityFunctions.sub(DensityFunctions.constant(100.0f),
                            DensityFunctions.distanceToPoint(Vec3i.ZERO, DistanceMetric.EUCLIDEAN)), -100.0f, 80.0f),
                        DensityFunctions.constant(8.0f)),
                    DensityFunctions.constant(0.0078125f)),
                DensityFunctions.endOuterIslands());
            DensitySampler graphSampler = endGraph.compileSampler(context);
            Method getNoise = sampler.getClass().getDeclaredMethod("islandNoise");
            getNoise.setAccessible(true);
            var noise = (net.minecraft.world.level.levelgen.synth.SimplexNoise)getNoise.invoke(sampler);
            for (int[] point : positions) {
                float value = sampler.sampleValue(null, point[0], point[1], point[2]);
                float outer = (float)height.invoke(null, noise, point[0] / 8, point[2] / 8);
                float graph = graphSampler.sampleValue(null, point[0], point[1], point[2]);
                System.out.println(seed + "," + point[0] + "," + point[1] + "," + point[2] + ","
                    + Float.floatToIntBits(value) + "," + Float.floatToIntBits(outer) + "," + Float.floatToIntBits(graph));
            }
        }
    }
}
