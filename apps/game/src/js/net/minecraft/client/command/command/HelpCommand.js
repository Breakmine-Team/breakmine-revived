import Command from "../Command.js";

export default class HelpCommand extends Command {

    constructor() {
        super("help", "", "Displays a list of commands")
    }

    execute(minecraft, args) {
        minecraft.addMessageToChat("\u00a72--- Showing help page ---");
        minecraft.commandHandler.commands.forEach(command => {
            minecraft.addMessageToChat("/" + command.command + " " + command.usage + " - " + command.description);
        });
        return true;
    }

}
