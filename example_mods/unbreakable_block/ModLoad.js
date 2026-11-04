export default class ModLoad {
    // The third argument is the ModLoader, so anything registered here is
    // remembered and removed again when the mod is disabled or uninstalled.
    static onLoad(world, minecraft, modLoader) {
        console.log('[ModLoad] Unbreakable Blocks mod loaded!');

        // World-render hooks: 'beforeRender', 'renderChunks', 'renderSky',
        // 'renderBlockHitBox', 'afterRender', 'onTick'. The handle returned by
        // registerRenderHook() can be handed back to unregister it later.
        const handle = modLoader.registerRenderHook('renderSky', (context) => {
            console.log('[ModLoad] renderSky hook, partialTicks =', context.partialTicks);
            modLoader.unregisterRenderHook('renderSky', handle);
        });

        // A command can also be registered from code instead of a commands/
        // file. It shows up in /help and in chat autocomplete.
        modLoader.registerCommand(
            "unbreakable_count",
            "",
            "Count unbreakable ingots (from ModLoad.js)",
            (mc, args) => {
                mc.addMessageToChat("§7Unbreakable blocks mod is active.");
                return true;
            }
        );
    }
}