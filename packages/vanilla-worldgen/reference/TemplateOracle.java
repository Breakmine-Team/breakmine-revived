import java.util.*;
import java.util.jar.JarFile;
import java.security.MessageDigest;
import java.nio.charset.StandardCharsets;
import net.minecraft.core.*;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.nbt.*;
import net.minecraft.resources.Identifier;
import net.minecraft.server.MinecraftServer;
import net.minecraft.world.level.block.*;
import net.minecraft.world.level.levelgen.*;
import net.minecraft.world.level.levelgen.structure.*;
import net.minecraft.world.level.levelgen.structure.pools.*;
import net.minecraft.world.level.levelgen.structure.templatesystem.*;

final class TemplateOracle {
    static MinecraftServer server;
    static void initialize() throws Exception {
        var field = sun.misc.Unsafe.class.getDeclaredField("theUnsafe"); field.setAccessible(true);
        var unsafe = (sun.misc.Unsafe)field.get(null);
        var repository = new HashMap<Identifier, Optional<StructureTemplate>>();
        for (var name : List.of("spine_1","spine_2","spine_3","spine_4","skull_1","skull_2","skull_3","skull_4")) {
            for (var suffix : List.of("", "_coal")) {
                var id = Identifier.parse("minecraft:fossil/" + name + suffix);
                try (var in = TemplateOracle.class.getResourceAsStream("/data/minecraft/structure/fossil/" + name + suffix + ".nbt")) {
                    var nbt = NbtIo.readCompressed(in, NbtAccounter.unlimitedHeap());
                    var template = new StructureTemplate(); template.load(BuiltInRegistries.BLOCK, nbt);
                    repository.put(id, Optional.of(template));
                }
            }
        }
        var manager = (StructureTemplateManager)unsafe.allocateInstance(StructureTemplateManager.class);
        var repoField = StructureTemplateManager.class.getDeclaredField("structureRepository"); repoField.setAccessible(true); repoField.set(manager, repository);
        server = (MinecraftServer)unsafe.allocateInstance(net.minecraft.server.dedicated.DedicatedServer.class);
        var managerField = MinecraftServer.class.getDeclaredField("structureTemplateManager"); managerField.setAccessible(true); managerField.set(server, manager);
    }
    static BlockPos origin(String mode) { return new BlockPos(mode.equals("fossil_negative") ? -17 : 0, 40, mode.equals("fossil_negative") ? -33 : 0); }
    static net.minecraft.world.level.block.state.BlockState base(String mode, BlockPos pos) {
        return (mode.equals("fossil_air") ? Blocks.AIR : mode.equals("fossil_water") || mode.equals("fossil_water_allowed") && pos.getX() >= 0 ? Blocks.WATER : mode.equals("fossil_lava_allowed") && pos.getX() >= 0 ? Blocks.LAVA
            : mode.equals("fossil_protected") && (pos.getX()+pos.getY()+pos.getZ())%3 == 0 ? Blocks.BEDROCK : Blocks.STONE).defaultBlockState();
    }
    static void beardifier() {
        var cases = new ArrayList<Object>();
        for (var adjustment : TerrainAdjustment.values()) {
            for (int delta : new int[]{0, 3, -4}) {
                var box = new BoundingBox(-5, -12, 3, 4, 7, 11);
                var affected = new BoundingBox(-32,-40,-28,32,40,36);
                var rigid = new Beardifier.Rigid(box, adjustment, delta);
                var junction = new JigsawJunction(-7,-9,13,0,StructureTemplatePool.Projection.RIGID);
                var beard = new Beardifier(List.of(rigid), List.of(junction), affected);
                var samples = new ArrayList<Object>();
                for (int z=-29; z<=37; z+=3) for (int x=-33; x<=33; x+=3) for (int y=-41; y<=41; y+=3) {
                    samples.add(List.of(x,y,z,Float.floatToRawIntBits(beard.sampleValue(null,x,y,z))));
                }
                cases.add(Map.of("adjustment",adjustment.getSerializedName(),"ground",delta,"samples",samples));
            }
        }
        net.minecraft.server.Bootstrap.realStdoutPrintln("BEARD," + FeatureOracle.JSON.toJson(cases));
        var transforms = new ArrayList<Object>();
        for (var rotation : Rotation.values()) for (var mirror : Mirror.values()) for (var pos : List.of(new BlockPos(0,0,0),new BlockPos(-17,12,31),new BlockPos(9,-64,4))) {
            var pivot = new BlockPos(-3,5,7);
            var result = StructureTemplate.transform(pos,mirror,rotation,pivot);
            transforms.add(Map.of("rotation",rotation.name().toLowerCase(Locale.ROOT),"mirror",mirror.name().toLowerCase(Locale.ROOT),
                "pos",List.of(pos.getX(),pos.getY(),pos.getZ()),"pivot",List.of(-3,5,7),"result",List.of(result.getX(),result.getY(),result.getZ())));
        }
        net.minecraft.server.Bootstrap.realStdoutPrintln("TRANSFORM," + FeatureOracle.JSON.toJson(transforms));
    }

    static void templates(String jarPath) throws Exception {
        var palettesField = StructureTemplate.class.getDeclaredField("palettes"); palettesField.setAccessible(true);
        var entitiesField = StructureTemplate.class.getDeclaredField("entityInfoList"); entitiesField.setAccessible(true);
        var shapes = new TreeMap<String,Object>(); var summaries = new ArrayList<Object>();
        try (var jar = new JarFile(jarPath)) {
            for (var entry : jar.stream().filter(e -> e.getName().startsWith("data/minecraft/structure/") && e.getName().endsWith(".nbt")).sorted(Comparator.comparing(e -> e.getName())).toList()) {
                try (var in = jar.getInputStream(entry)) {
                    var nbt = NbtIo.readCompressed(in,NbtAccounter.unlimitedHeap());
                    var template = new StructureTemplate(); template.load(BuiltInRegistries.BLOCK,nbt);
                    var palettes = (List<StructureTemplate.Palette>)palettesField.get(template);
                    var digests = new ArrayList<Object>();
                    for (var palette : palettes) {
                        var text = new StringBuilder();
                        for (var info : palette.blocks()) {
                            var state = info.state(); var properties = new TreeMap<String,String>();
                            state.getValues().forEach(v -> properties.put(v.property().getName(),v.valueName()));
                            var name = BuiltInRegistries.BLOCK.getKey(state.getBlock()).toString();
                            var propertiesText = String.join(",",properties.entrySet().stream().map(p -> p.getKey()+"="+p.getValue()).toList());
                            var key = name + ";" + propertiesText;
                            shapes.putIfAbsent(key,Map.of("name",name,"properties",properties,"staticFullBlock",!state.getBlock().hasDynamicShape() && state.isCollisionShapeFullBlock(net.minecraft.world.level.EmptyBlockGetter.INSTANCE,BlockPos.ZERO)));
                            var p = info.pos();
                            text.append(p.getX()).append(',').append(p.getY()).append(',').append(p.getZ()).append(';').append(key).append(';').append(info.nbt()!=null?1:0).append('\n');
                        }
                        var digest = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(text.toString().getBytes(StandardCharsets.UTF_8)));
                        digests.add(Map.of("blocks",palette.blocks().size(),"sha256",digest));
                    }
                    var size = template.getSize();
                    summaries.add(Map.of("id","minecraft:"+entry.getName().substring(25,entry.getName().length()-4),"size",List.of(size.getX(),size.getY(),size.getZ()),"palettes",digests,"entities",((List<?>)entitiesField.get(template)).size()));
                }
            }
        }
        net.minecraft.server.Bootstrap.realStdoutPrintln("TEMPLATES," + FeatureOracle.JSON.toJson(Map.of("templates",summaries,"shapes",shapes)));
    }
}
