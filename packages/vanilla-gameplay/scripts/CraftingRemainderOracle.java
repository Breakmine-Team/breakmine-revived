import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.registries.BuiltInRegistries;

public final class CraftingRemainderOracle {
    public static void main(String[] args) {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        for (var item : BuiltInRegistries.ITEM) {
            var template = item.getCraftingRemainder();
            if (template == null) continue;
            Bootstrap.realStdoutPrintln("REMAINDER," + BuiltInRegistries.ITEM.getKey(item) + ","
                + BuiltInRegistries.ITEM.getKey(template.item().value()) + "," + template.count());
        }
    }
}
