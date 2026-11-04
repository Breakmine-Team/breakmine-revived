import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.BlockPos;
import net.minecraft.world.level.EmptyBlockGetter;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.phys.shapes.VoxelShape;

public final class BlockShapesOracle {
    private static String boxes(VoxelShape shape) {
        StringBuilder out = new StringBuilder();
        shape.toAabbs().forEach(box -> {
            if (!out.isEmpty()) out.append(';');
            out.append(box.minX).append(',').append(box.minY).append(',').append(box.minZ).append(',')
               .append(box.maxX).append(',').append(box.maxY).append(',').append(box.maxZ);
        });
        return out.toString();
    }
    public static void main(String[] args) {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        var states = Block.BLOCK_STATE_REGISTRY;
        for (int id = 0; id < states.size(); id++) {
            var state = states.byId(id);
            try {
                Bootstrap.realStdoutPrintln(id + "|" + boxes(state.getShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO))
                    + "|" + boxes(state.getCollisionShape(EmptyBlockGetter.INSTANCE, BlockPos.ZERO)));
            } catch (Exception error) {
                Bootstrap.realStdoutPrintln(id + "|ERROR|" + error.getClass().getSimpleName());
            }
        }
    }
}
