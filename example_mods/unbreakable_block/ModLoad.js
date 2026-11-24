export default class ModLoad {
    // The third argument is the ModLoader (ModAPI). Anything registered here is
    // remembered and removed again when the mod is disabled or uninstalled.
    static onLoad(world, minecraft, modLoader) {
        console.log('[ModLoad] Unbreakable Blocks mod loaded!');

        // -- Persistent stats -------------------------------------------------
        // saveJson()/loadJson() store files under mod_data/unbreakable_block/,
        // scoped to this mod and cleaned up with the mod.
        modLoader.loadJson('stats', { launches: 0 })
            .then((stats) => {
                stats.launches = (stats.launches || 0) + 1;
                return modLoader.saveJson('stats', stats).then(() => stats);
            })
            .then((stats) => modLoader.log('Session #' + stats.launches))
            .catch((err) => modLoader.warn('Could not update stats: ' + err));

        // -- HUD overlay, toggled by a keybind ---------------------------------
        let hudVisible = true;

        modLoader.registerKeybind({
            id: 'toggle_hud',
            name: 'Toggle Unbreakable HUD',
            defaultKey: 'h',
            onPress: () => {
                hudVisible = !hudVisible;
                minecraft.addMessageToChat(
                    hudVisible ? '§7HUD enabled.' : '§7HUD disabled.'
                );
            }
        });

        modLoader.registerOverlayText((ctx) => {
            if (!hudVisible) return;
            const lines = 'Unbreakable Blocks v1.1.0\nPress H to hide';
            ctx.text(lines, 4, 4, {
                color: 0xAAAAAA,
                shadow: true,
                scale: 0.9
            });
        });

        // -- World-render hook: 'beforeRender', 'renderChunks', 'renderSky',
        // 'renderBlockHitBox', 'afterRender', 'onTick'. The handle returned by
        // registerRenderHook() can be handed back to unregister it later.
        const handle = modLoader.registerRenderHook('renderSky', (context) => {
            console.log('[ModLoad] renderSky hook, partialTicks =', context.partialTicks);
            modLoader.unregisterRenderHook('renderSky', handle);
        });

        // -- A command registered from code instead of a commands/ file.
        // It shows up in /help and in chat autocomplete.
        modLoader.registerCommand(
            'unbreakable_count',
            '',
            'Count unbreakable ingots (from ModLoad.js)',
            (mc, args) => {
                mc.addMessageToChat('§7Unbreakable blocks mod is active.');
                return true;
            }
        );
    }
}
