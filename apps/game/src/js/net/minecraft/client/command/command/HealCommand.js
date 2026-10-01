import Command from "../Command.js";

export default class HealCommand extends Command {

    constructor() {
        super("heal", "<player> <amount>", "Heal a player")
    }

    execute(minecraft, args) {
        if (args.length < 2) {
            return false;
        }

        let targetName = args[0];
        let amount = parseInt(args[1]);

        if (isNaN(amount) || amount <= 0) {
            return false;
        }

        let target = null;
        if (targetName === "@s" || targetName === minecraft.player.username) {
            target = minecraft.player;
        } else if (minecraft.findPlayerByName) {
            target = minecraft.findPlayerByName(targetName);
        }

        if (!target) {
            minecraft.addMessageToChat("Player not found: " + targetName);
            return true;
        }

        target.health = Math.min(20, target.health + amount);
        minecraft.addMessageToChat("Healed " + targetName + " by " + amount + " HP");

        return true;
    }

}
