import net.minecraft.SharedConstants;
import net.minecraft.server.Bootstrap;
import net.minecraft.core.registries.BuiltInRegistries;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.item.component.ItemAttributeModifiers;
import net.minecraft.world.level.biome.Biome;
import net.minecraft.core.BlockPos;

public final class GameplayOracle {
    private static void copyGameplayComponents(Object initializer, net.minecraft.core.component.DataComponentMap.Builder builder) throws Exception {
        Object type = null, value = null;
        for (var field : initializer.getClass().getDeclaredFields()) {
            if (java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;
            field.setAccessible(true);
            var captured = field.get(initializer);
            if (captured instanceof net.minecraft.core.component.DataComponentInitializers.Initializer<?>) copyGameplayComponents(captured, builder);
            else if (captured instanceof net.minecraft.core.component.DataComponentType<?>) type = captured;
            else if (captured instanceof ItemAttributeModifiers || captured instanceof net.minecraft.world.food.FoodProperties ||
                captured instanceof net.minecraft.world.item.component.Consumable || captured instanceof net.minecraft.world.item.component.Tool ||
                captured instanceof net.minecraft.world.item.component.Weapon || captured instanceof net.minecraft.world.item.component.SwingAnimation ||
                captured instanceof net.minecraft.world.item.equipment.Equippable || captured instanceof Integer) value = captured;
        }
        if (type == DataComponents.ATTRIBUTE_MODIFIERS && value instanceof ItemAttributeModifiers attributes) builder.set(DataComponents.ATTRIBUTE_MODIFIERS, attributes);
        if (type == DataComponents.FOOD && value instanceof net.minecraft.world.food.FoodProperties food) builder.set(DataComponents.FOOD, food);
        if (type == DataComponents.CONSUMABLE && value instanceof net.minecraft.world.item.component.Consumable consumable) builder.set(DataComponents.CONSUMABLE, consumable);
        if (type == DataComponents.MAX_STACK_SIZE && value instanceof Integer count) builder.set(DataComponents.MAX_STACK_SIZE, count);
        if (type == DataComponents.MAX_DAMAGE && value instanceof Integer durability) builder.set(DataComponents.MAX_DAMAGE, durability);
        if (type == DataComponents.TOOL && value instanceof net.minecraft.world.item.component.Tool tool) builder.set(DataComponents.TOOL, tool);
        if (type == DataComponents.WEAPON && value instanceof net.minecraft.world.item.component.Weapon weapon) builder.set(DataComponents.WEAPON, weapon);
        if (type == DataComponents.ATTACK_ANIMATION && value instanceof net.minecraft.world.item.component.SwingAnimation animation) builder.set(DataComponents.ATTACK_ANIMATION, animation);
        if (type == DataComponents.EQUIPPABLE && value instanceof net.minecraft.world.item.equipment.Equippable equippable) builder.set(DataComponents.EQUIPPABLE, equippable);
    }
    public static void main(String[] args) throws Exception {
        SharedConstants.tryDetectVersion();
        Bootstrap.bootStrap();
        var field = net.minecraft.core.component.DataComponentInitializers.class.getDeclaredField("initializers");
        field.setAccessible(true);
        for (var entry : (java.util.List<?>)field.get(BuiltInRegistries.DATA_COMPONENT_INITIALIZERS)) {
            var keyMethod = entry.getClass().getDeclaredMethod("key"); keyMethod.setAccessible(true);
            var key = (net.minecraft.resources.ResourceKey<?>)keyMethod.invoke(entry);
            var name = key.identifier().toString();
            if (!name.startsWith("minecraft:")) continue;
            var builder = net.minecraft.core.component.DataComponentMap.builder();
            var initializerMethod = entry.getClass().getDeclaredMethod("initializer"); initializerMethod.setAccessible(true);
            copyGameplayComponents(initializerMethod.invoke(entry), builder);
            var components = builder.build();
            var attributes = components.getOrDefault(DataComponents.ATTRIBUTE_MODIFIERS, ItemAttributeModifiers.EMPTY);
            var food = components.get(DataComponents.FOOD);
            var consumable = components.get(DataComponents.CONSUMABLE);
            var weapon = components.get(DataComponents.WEAPON);
            var swing = components.getOrDefault(DataComponents.ATTACK_ANIMATION, net.minecraft.world.item.component.SwingAnimation.DEFAULT);
            var equippable = components.get(DataComponents.EQUIPPABLE);
            var slot = equippable == null ? EquipmentSlot.MAINHAND : equippable.slot();
            Bootstrap.realStdoutPrintln("ITEM," + name + ","
                + attributes.compute(Attributes.ATTACK_DAMAGE, 1, EquipmentSlot.MAINHAND) + ","
                + attributes.compute(Attributes.ATTACK_SPEED, 4, EquipmentSlot.MAINHAND) + ","
                + (food == null ? "0,0" : food.nutrition() + "," + food.saturation()) + ","
                + components.getOrDefault(DataComponents.MAX_STACK_SIZE, components.has(DataComponents.MAX_DAMAGE) ? 1 : 64) + ","
                + components.getOrDefault(DataComponents.MAX_DAMAGE, 0) + ","
                + (consumable == null ? 32 : Math.round(consumable.consumeSeconds() * 20)) + ","
                + (food != null && food.canAlwaysEat()) + ","
                + (consumable != null && !consumable.onConsumeEffects().isEmpty()) + ","
                + (weapon == null ? 0 : weapon.itemDamagePerAttack()) + ","
                + swing.type().name().toLowerCase(java.util.Locale.ROOT) + "," + swing.duration() + ","
                + (equippable == null ? "" : slot.name().toLowerCase(java.util.Locale.ROOT)) + ","
                + attributes.compute(Attributes.ARMOR, 0, slot) + ","
                + attributes.compute(Attributes.ARMOR_TOUGHNESS, 0, slot) + ","
                + attributes.compute(Attributes.KNOCKBACK_RESISTANCE, 0, slot) + ","
                + (equippable != null && equippable.damageOnHurt()));
            var tool = components.get(DataComponents.TOOL);
            if (tool != null) {
                var rules = new java.util.ArrayList<java.util.Map<String,Object>>();
                for (var rule : tool.rules()) {
                    var row = new java.util.LinkedHashMap<String,Object>();
                    var tag = rule.blocks().unwrapKey();
                    if (tag.isPresent()) row.put("tag", tag.get().location().toString());
                    else row.put("blocks", rule.blocks().stream().map(holder -> BuiltInRegistries.BLOCK.getKey(holder.value()).toString()).toList());
                    rule.speed().ifPresent(speed -> row.put("speed", speed));
                    rule.correctForDrops().ifPresent(correct -> row.put("correctForDrops", correct));
                    rules.add(row);
                }
                var json = new com.google.gson.Gson().toJson(java.util.Map.of("rules", rules,
                    "defaultMiningSpeed", tool.defaultMiningSpeed(), "damagePerBlock", tool.damagePerBlock(),
                    "canDestroyBlocksInCreative", tool.canDestroyBlocksInCreative()));
                Bootstrap.realStdoutPrintln("TOOL," + name + "," + java.util.Base64.getEncoder().encodeToString(json.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
            }
        }
        var biome = new Biome.BiomeBuilder().hasPrecipitation(true).temperature(0.8f).downfall(0.4f)
            .specialEffects(new net.minecraft.world.level.biome.BiomeSpecialEffects.Builder().waterColor(4159204).build())
            .mobSpawnSettings(net.minecraft.world.level.biome.MobSpawnSettings.EMPTY)
            .generationSettings(net.minecraft.world.level.biome.BiomeGenerationSettings.EMPTY).build();
        var method = Biome.class.getDeclaredMethod("getHeightAdjustedTemperature", BlockPos.class, int.class);
        method.setAccessible(true);
        for (var pos : new BlockPos[]{new BlockPos(0,80,0),new BlockPos(0,81,0),new BlockPos(-130,220,88),new BlockPos(99,200,-300)})
            Bootstrap.realStdoutPrintln("TEMP," + pos.getX()+","+pos.getY()+","+pos.getZ()+","+method.invoke(biome,pos,63));
    }
}
