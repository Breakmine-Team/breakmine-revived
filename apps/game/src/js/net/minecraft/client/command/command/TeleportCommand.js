import Command from "../Command.js";

export default class TeleportCommand extends Command {

    constructor() {
        super("tp", "<x> <y> <z>", "Teleport to a position")
    }

    execute(minecraft, args) {
        if (args.length !== 3) {
            return false;
        }

        let x = parseInt(args[0]);
        let y = parseInt(args[1]);
        let z = parseInt(args[2]);

        if (args[0] === "~") {
            x = minecraft.player.x;
        } else if (args[0] && args[0].startsWith("~")) {
            x = parseInt(args[0].slice(1)) + minecraft.player.x;
        }

        if (args[1] === "~") {
            y = minecraft.player.y;
        } else if (args[1] && args[1].startsWith("~")) {
            y = parseInt(args[1].slice(1)) + minecraft.player.y;
        }

        if (args[2] === "~") {
            z = minecraft.player.z;
        } else if (args[2] && args[2].startsWith("~")) {
            z = parseInt(args[2].slice(1)) + minecraft.player.z;
        }

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return false;
        }

        minecraft.player.setPosition(x, y, z);
        minecraft.addMessageToChat("Teleported to " + x + " " + y + " " + z);

        return true;
    }

}
