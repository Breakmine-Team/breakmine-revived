import HelpCommand from "./command/HelpCommand.js";
import TimeCommand from "./command/TimeCommand.js";
import TeleportCommand from "./command/TeleportCommand.js";
import GameModeCommand from "./command/GameModeCommand.js";
import UtilCommand from "./command/UtilCommand.js";
import SetBlockCommand from "./command/SetBlockCommand.js"
import PlaceCommand from "./command/PlaceCommand.js"
import HealCommand from "./command/HealCommand.js"
import GiveCommand from "./command/GiveCommand.js"
import SummonCommand from "./command/SummonCommand.js"
import CommandRegistry from "./CommandRegistry.js";

export default class CommandHandler {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.commands = [];
        this.commands.push(new HelpCommand());
        this.commands.push(new TimeCommand());
        this.commands.push(new TeleportCommand());
        this.commands.push(new GameModeCommand());
        this.commands.push(new UtilCommand());
        this.commands.push(new SetBlockCommand());
        this.commands.push(new PlaceCommand());
        this.commands.push(new HealCommand());
        this.commands.push(new GiveCommand());
        this.commands.push(new SummonCommand());
    }

    /**
     * Register a mod-provided command. Mods normally go through
     * ModLoader.registerCommand(), which fills in the owning modId; this is
     * the same entry point for anything else holding a CommandHandler.
     */
    registerCommand(descriptor) {
        return CommandRegistry.register(descriptor);
    }

    unregisterCommand(name) {
        return CommandRegistry.unregister(name);
    }

    /** Built-in commands plus everything mods registered. */
    getCommands() {
        return [...this.commands, ...CommandRegistry.getAll()];
    }

    /** True when the command exists, either built-in or registered by a mod. */
    hasCommand(name) {
        const key = typeof name === 'string' ? name.toLowerCase() : '';
        return this.commands.some(command => command.command === key) || CommandRegistry.has(key);
    }

    handleMessage(message) {
        let args = message.split(" ");
        let command = args[0].toLowerCase();
        this.handleCommand(command, args.slice(1));
    }

    handleCommand(command, args) {
        for (let i = 0; i < this.commands.length; i++) {
            let commandExecutor = this.commands[i];
            if (commandExecutor.command === command) {
                if (!this.commands[i].execute(this.minecraft, args)) {
                    this.minecraft.addMessageToChat("/" + commandExecutor.command + " " + commandExecutor.usage);
                }
                return;
            }
        }

        // Mod commands live in the shared registry rather than in this list, so
        // they also work on the server, where each CommandHandler is shared by
        // every player and `minecraft` is the current player's adapter.
        const modCommand = CommandRegistry.get(command);
        if (modCommand) {
            let handled = false;
            try {
                handled = modCommand.execute(this.minecraft, args);
            } catch (error) {
                this.minecraft.addMessageToChat("§cCommand /" + modCommand.command + " failed: " + error.message);
                return;
            }
            if (!handled) {
                this.minecraft.addMessageToChat("/" + modCommand.command + " " + modCommand.usage);
            }
            return;
        }

        this.minecraft.addMessageToChat("Unknown command! Type \"/help\" for help.");
    }
}