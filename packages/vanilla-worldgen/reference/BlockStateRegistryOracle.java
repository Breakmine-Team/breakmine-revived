import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import java.util.stream.Collectors;

public final class BlockStateRegistryOracle {
    public static void main(String[] args) {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        Blocks.AIR.defaultBlockState();
        var states = Block.BLOCK_STATE_REGISTRY;
        for (int id = 0; id < states.size(); id++) {
            var state = states.byId(id);
            if (state == null) continue;
            var name = BuiltInRegistries.BLOCK.getKey(state.getBlock());
            var properties = state.getValues()
                .map(value -> value.property().getName() + "=" + value.valueName())
                .collect(Collectors.joining(";"));
            Bootstrap.realStdoutPrintln("STATE," + id + "," + name + "," + properties);
        }
    }
}
