import net.minecraft.world.level.biome.Biome;
import net.minecraft.world.level.biome.Climate;
import net.minecraft.world.level.biome.MultiNoiseBiomeSourceParameterList;
import com.google.gson.Gson;
import java.lang.reflect.Field;
import java.util.*;

public class ClimateOracle {
    static Object field(Object value, String name) throws Exception {
        Class<?> type = value.getClass();
        while (type != null) {
            try {
                Field field = type.getDeclaredField(name);
                field.setAccessible(true);
                return field.get(value);
            } catch (NoSuchFieldException ignored) { type = type.getSuperclass(); }
        }
        throw new NoSuchFieldException(name);
    }

    record Node(long[][] bounds, int biome, List<Integer> children) {}
    record Query(long[] point, int biome) {}
    record PresetData(List<String> biomes, int parameterCount, List<Node> nodes, List<Query> queries) {}

    static int exportNode(Object node, List<Node> nodes, List<String> biomes) throws Exception {
        int index = nodes.size();
        nodes.add(null);
        var space = (Climate.Parameter[])field(node, "parameterSpace");
        long[][] bounds = new long[space.length][2];
        for (int i=0;i<space.length;i++) bounds[i] = new long[]{space[i].min(),space[i].max()};
        List<Integer> children = new ArrayList<>();
        int biome = -1;
        if (node.getClass().getSimpleName().equals("Leaf")) {
            biome = biomes.indexOf((String)field(node,"value"));
        } else {
            for(Object child : (Object[])field(node,"children")) children.add(exportNode(child,nodes,biomes));
        }
        nodes.set(index, new Node(bounds,biome,children));
        return index;
    }

    static PresetData export(MultiNoiseBiomeSourceParameterList.Preset preset) throws Exception {
        Object provider = preset.provider();
        var method = provider.getClass().getDeclaredMethod("apply", java.util.function.Function.class);
        method.setAccessible(true);
        java.util.function.Function<net.minecraft.resources.ResourceKey<Biome>,String> names = key -> key.identifier().toString();
        @SuppressWarnings("unchecked")
        Climate.ParameterList<String> list = (Climate.ParameterList<String>)method.invoke(provider, names);
        List<String> biomes = list.values().stream().map(pair -> pair.getSecond()).distinct().sorted().toList();
        List<Node> nodes = new ArrayList<>();
        exportNode(field(field(list,"index"),"root"),nodes,biomes);
        List<Query> queries = new ArrayList<>();
        // Include every leaf centre and boundary, followed by a repeat to exercise cached ties.
        for (var pair : list.values()) {
            var p = pair.getFirst();
            var space = new Climate.Parameter[]{p.temperature(),p.humidity(),p.continentalness(),p.erosion(),p.depth(),p.weirdness()};
            for (int mode=0;mode<3;mode++) {
                long[] point = new long[6];
                for(int i=0;i<6;i++) point[i] = mode == 0 ? space[i].min() : mode == 1 ? space[i].max() : (space[i].min()+space[i].max())/2;
                var target = new Climate.TargetPoint(point[0],point[1],point[2],point[3],point[4],point[5]);
                for(int repeat=0;repeat<2;repeat++) queries.add(new Query(point,biomes.indexOf(list.findValue(target))));
            }
        }
        return new PresetData(biomes,list.values().size(),nodes,queries);
    }

    public static void main(String[] args) throws Exception {
        var result = new LinkedHashMap<String,PresetData>();
        result.put("overworld", export(MultiNoiseBiomeSourceParameterList.Preset.OVERWORLD));
        result.put("nether", export(MultiNoiseBiomeSourceParameterList.Preset.NETHER));
        System.out.println("CLIMATE:" + new Gson().toJson(result));
    }
}
