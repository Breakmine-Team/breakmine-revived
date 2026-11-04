import Command from "../Command.js";

// /unbreakable            — how many unbreakable ingots you are carrying
// /unbreakable give <n>   — give yourself n ingots
//
// Commands from commands/*.js are registered for the client and the server
// alike. Set `this.opOnly = true` in the constructor when the server should
// only let operators run it (like the built-in /give).
export default class CommandUnbreakable extends Command {

    constructor() {
        super("unbreakable", "[give <count>]", "Unbreakable Blocks commands");
        this.opOnly = false;
    }

    execute(minecraft, args) {
        const INGOT = "unbreakable_block:unbreakable_ingot";
        const inventory = minecraft.player.inventory;

        if (args.length >= 2 && args[0].toLowerCase() === "give") {
            const count = parseInt(args[1]);
            if (isNaN(count) || count <= 0) {
                return false;
            }

            if (inventory.addItem(INGOT, count)) {
                minecraft.addMessageToChat("§7Gave you " + count + " unbreakable ingot(s)");
            } else {
                minecraft.addMessageToChat("§cInventory is full!");
            }
            return true;
        }

        if (args.length > 0) {
            return false;
        }

        let total = 0;
        for (const stack of inventory.items) {
            if (stack && !stack.isEmpty() && stack.getType() === INGOT) {
                total += stack.getCount();
            }
        }

        minecraft.addMessageToChat("§7You are carrying " + total + " unbreakable ingot(s)");
        return true;
    }

}