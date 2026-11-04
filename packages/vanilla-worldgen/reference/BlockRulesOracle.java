import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.material.Fluids;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.world.phys.AABB;
import net.minecraft.world.phys.shapes.VoxelShape;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public final class BlockRulesOracle {
    private static final Map<String, Integer> OCCLUSION_SHAPE_IDS = new HashMap<>();
    private static final List<String> OCCLUSION_SHAPES = new ArrayList<>();

    private static int occlusionShapeId(VoxelShape shape, int direction) {
        long[] words = new long[4];
        List<AABB> boxes = shape.toAabbs();
        for (AABB box : boxes) {
            double[] bounds = direction < 2
                ? new double[]{box.minX, box.maxX, box.minZ, box.maxZ}
                : direction < 4
                    ? new double[]{box.minX, box.maxX, box.minY, box.maxY}
                    : new double[]{box.minZ, box.maxZ, box.minY, box.maxY};
            for (double bound : bounds) if (Math.abs(bound * 16.0 - Math.rint(bound * 16.0)) > 1.0e-7) {
                throw new IllegalStateException("Light occlusion face is not aligned to Minecraft's 1/16 block grid: " + bound);
            }
        }
        for (int v = 0; v < 16; v++) for (int u = 0; u < 16; u++) {
            double a = (u + 0.5) / 16.0, b = (v + 0.5) / 16.0;
            boolean occupied = false;
            for (AABB box : boxes) {
                double minU, maxU, minV, maxV;
                if (direction < 2) { minU = box.minX; maxU = box.maxX; minV = box.minZ; maxV = box.maxZ; }
                else if (direction < 4) { minU = box.minX; maxU = box.maxX; minV = box.minY; maxV = box.maxY; }
                else { minU = box.minZ; maxU = box.maxZ; minV = box.minY; maxV = box.maxY; }
                if (a >= minU && a <= maxU && b >= minV && b <= maxV) { occupied = true; break; }
            }
            if (occupied) {
                int bit = v * 16 + u;
                words[bit >>> 6] |= 1L << (bit & 63);
            }
        }
        StringBuilder key = new StringBuilder(64);
        for (long word : words) key.append(String.format("%016x", word));
        String mask = key.toString();
        Integer existing = OCCLUSION_SHAPE_IDS.get(mask);
        if (existing != null) return existing;
        int id = OCCLUSION_SHAPES.size();
        OCCLUSION_SHAPE_IDS.put(mask, id);
        OCCLUSION_SHAPES.add(mask);
        return id;
    }

    private static String owner(Class<?> type, String method) {
        for (var current = type; current != null; current = current.getSuperclass()) {
            for (var candidate : current.getDeclaredMethods()) if (candidate.getName().equals(method)) return current.getSimpleName();
        }
        return "";
    }
    public static void main(String[] args) {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        for (var block : BuiltInRegistries.BLOCK) {
            Bootstrap.realStdoutPrintln("DEFAULT," + BuiltInRegistries.BLOCK.getKey(block) + "," + Block.getId(block.defaultBlockState()));
            String survival = owner(block.getClass(), "canSurvive");
            String substrate = owner(block.getClass(), "mayPlaceOn");
            if (substrate.equals("VegetationBlock") && (survival.equals("VegetationBlock") || survival.equals("DoublePlantBlock"))) {
                Bootstrap.realStdoutPrintln("SURVIVAL," + BuiltInRegistries.BLOCK.getKey(block) + "," + (survival.equals("DoublePlantBlock") ? "double_vegetation" : "vegetation"));
            }
        }
        var states = Block.BLOCK_STATE_REGISTRY;
        for (int id = 0; id < states.size(); id++) {
            var state = states.byId(id);
            var fluid = state.getFluidState();
            int support = 0, collision = 0, sturdy = 0, occlusion = 0;
            for (var face : Direction.values()) {
                int bit = 1 << face.ordinal();
                if (Block.isFaceFull(state.getBlockSupportShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO), face)) support |= bit;
                if (Block.isFaceFull(state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO), face)) collision |= bit;
                if (state.isFaceSturdy(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, face)) sturdy |= bit;
                if (Block.isShapeFullBlock(state.getFaceOcclusionShape(face))) occlusion |= bit;
            }
            StringBuilder faceLine = new StringBuilder("FACE,").append(id).append(',').append(support).append(',').append(collision).append(',').append(sturdy).append(',').append(occlusion);
            for (var face : Direction.values()) faceLine.append(',').append(occlusionShapeId(state.getFaceOcclusionShape(face), face.ordinal()));
            Bootstrap.realStdoutPrintln(faceLine.toString());
            Bootstrap.realStdoutPrintln("RULE," + id + "," + state.isSolid() + "," + state.isSolidRender()
                + "," + state.canOcclude() + "," + state.canBeReplaced() + "," + fluid.isEmpty()
                + "," + fluid.isSourceOfType(Fluids.WATER) + "," + state.liquid() + "," + BuiltInRegistries.FLUID.getKey(fluid.getType())
                + "," + state.isFaceSturdy(EmptyBlockGetter.INSTANCE, BlockPos.ZERO, Direction.UP) + "," + fluid.isSource()
                + "," + state.isCollisionShapeFullBlock(EmptyBlockGetter.INSTANCE, BlockPos.ZERO)
                + "," + state.getLightEmission() + "," + state.getLightDampening() + "," + state.useShapeForLightOcclusion()
                + "," + state.getDestroySpeed(EmptyBlockGetter.INSTANCE, BlockPos.ZERO));
        }
        for (int id = 0; id < OCCLUSION_SHAPES.size(); id++) Bootstrap.realStdoutPrintln("SHAPE," + id + "," + OCCLUSION_SHAPES.get(id));
    }
}
