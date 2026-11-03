export default class ModLoad {

    static onLoad(world, minecraft, modLoader) {
        const REACH = 5;

        ModAPI.registerOverlayText((ctx) => {
            const target = ModAPI.getLookedAtBlock(REACH);
            if (!target) {
                return;
            }

            const lines = [`§f§o${target.name}`];
            if (target.text_id) {
                lines.push(`§8${target.text_id}`);
            }

            const extra = (target.description || '')
                .split(/\r?\n/)
                .slice(1)
                .map(line => line.trim())
                .filter(line => line.length > 0);
            for (const line of extra) {
                lines.push(`§7${line}`);
            }

            ctx.tooltip(lines.join('\n'), ctx.width / 2, 6, {
                align: 'center'
            });
        });

        ModAPI.log('Wys HUD ready.');
    }
}
