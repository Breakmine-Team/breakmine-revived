import Command from "../Command.js";
import {BlockRegistry} from "../../world/block/BlockRegistry.js";

export default class GiveCommand extends Command {

    constructor() {
        super("give", "<item> [count]", "Give yourself an item")
    }

    execute(minecraft, args) {
        if (args.length < 1) {
            return false;
        }

        let itemName = args[0].toLowerCase();
        let count = 1;
        if (args.length >= 2) {
            count = parseInt(args[1]);
            if (isNaN(count) || count <= 0) {
                return false;
            }
        }

        let block = BlockRegistry.get(itemName);
        if (!block) {
            minecraft.addMessageToChat("Item not found: " + args[0]);
            return true;
        }

        let player = minecraft.player;
        if (!player) {
            minecraft.addMessageToChat("No player available");
            return true;
        }

        let added = player.inventory.addItem(block.id, count);
        if (added) {
            minecraft.addMessageToChat("Gave " + count + " x " + itemName);
        } else {
            minecraft.addMessageToChat("Inventory full!");
        }

        return true;
    }

}
