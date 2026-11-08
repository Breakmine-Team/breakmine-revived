import Command from "../Command.js";

export default class GameModeCommand extends Command {

    constructor() {
        super("gamemode", "<survival|creative|spectator  0|1|3>", "Change game mode")
    }

    execute(minecraft, args) {
        if (args.length !== 1) {
            return false;
        }

        let mode = args[0].toLowerCase();
        if (mode === "survival" || mode === "0") {
            minecraft.player.creative = false;
            minecraft.player.spectator = false;
            minecraft.player.flying = false;
            minecraft.musicManager.switchWhenReady('game');
            minecraft.addMessageToChat("Game mode changed to Survival");
        } else if (mode === "creative" || mode === "1") {
            minecraft.player.creative = true;
            minecraft.player.spectator = false;
            minecraft.player.flying = true;
            minecraft.musicManager.switchWhenReady('creative');
            minecraft.addMessageToChat("Game mode changed to Creative");
        } else if (mode === "spectator" || mode === "3") {
            minecraft.player.creative = false;
            minecraft.player.spectator = true;
            minecraft.player.flying = true;
            minecraft.musicManager.switchWhenReady('game');
            minecraft.addMessageToChat("Game mode changed to Spectator");
        } else {
            return false;
        }

        const gamemode = (mode === "creative" || mode === "1") ? 1 : (mode === "spectator" || mode === "3") ? 3 : 0;
        const nm = minecraft.playerController?.getNetworkHandler?.()?.getNetworkManager?.();
        if (nm?.sendJson) {
            nm.sendJson({ type: 'gamemode', gamemode, flying: minecraft.player.flying });
        }

        return true;
    }

}