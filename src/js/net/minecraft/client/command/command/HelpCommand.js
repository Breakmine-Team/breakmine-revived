import Command from "../Command.js";
import CommandRegistry from "../CommandRegistry.js";

export default class HelpCommand extends Command {

    constructor() {
        super("help", "", "Displays a list of commands")
    }

    execute(minecraft, args) {
        minecraft.addMessageToChat("\u00a72--- Showing help page ---");

        const handler = minecraft.commandHandler;
        const builtins = handler ? handler.commands : [];
        const modCommands = CommandRegistry.getAll();

        for (const command of builtins) {
            minecraft.addMessageToChat("/" + command.command + " " + command.usage + " - " + command.description);
        }

        if (modCommands.length > 0) {
            minecraft.addMessageToChat("\u00a76--- Mod commands ---");
            for (const command of modCommands) {
                const origin = command.modId ? " (" + command.modId + ")" : "";
                const op = command.opOnly ? " [op]" : "";
                minecraft.addMessageToChat("/" + command.command + " " + command.usage + " - " + command.description + op + origin);
            }
        }

        return true;
    }

}
