import net.minecraft.world.level.levelgen.XoroshiroRandomSource;
import net.minecraft.world.level.levelgen.Xoroshiro128PlusPlus;
import net.minecraft.world.level.levelgen.synth.PerlinNoise;
import net.minecraft.world.level.levelgen.synth.SmearedPerlinNoise;

public class WorldgenOracle {
    public static void main(String[] args) {
        long[] seeds = {0, 1, -1, Long.MIN_VALUE, Long.MAX_VALUE, 9007199254740993L, -1234567890123456789L};
        int[] bounds = {1, 2, 3, 17, 255, 256, 65537, 1073741825, Integer.MAX_VALUE};
        double[][] points = {{0,0,0}, {-0.01,-64.5,0.1}, {16,319,-16}, {1000000.25,42,-999999.75}, {16777216,-16777216,33554432.125}};
        for (long seed : seeds) {
            var random = new XoroshiroRandomSource(seed);
            for (int i=0; i<128; i++) System.out.println("LONG," + seed + "," + random.nextLong());
            random = new XoroshiroRandomSource(seed);
            for (int i=0; i<128; i++) {
                int bound = bounds[i % bounds.length];
                System.out.println("INT," + seed + "," + bound + "," + random.nextInt(bound));
            }
            random = new XoroshiroRandomSource(seed);
            for (int i=0; i<128; i++) System.out.println("DOUBLE," + seed + "," + Long.toUnsignedString(Double.doubleToRawLongBits(random.nextDouble())));
            var noise = new PerlinNoise(new XoroshiroRandomSource(seed));
            for (double[] p : points) {
                System.out.println("PERLIN," + seed + "," + p[0] + "," + p[1] + "," + p[2] + "," + Float.floatToRawIntBits(noise.get(p[0],p[1],p[2])));
            }
            for (double scale : new double[]{0, 0.2, 1.0}) {
                var smeared = new SmearedPerlinNoise(new XoroshiroRandomSource(seed), scale);
                for (double[] p : points) {
                    System.out.println("SMEAR," + seed + "," + p[0] + "," + p[1] + "," + p[2] + "," + scale + "," + Float.floatToRawIntBits(smeared.get(p[0],p[1],p[2])));
                }
            }
        }
        var zero = new Xoroshiro128PlusPlus(0, 0);
        for (int i=0; i<32; i++) System.out.println("PAIR,0,0," + zero.nextLong());
    }
}
