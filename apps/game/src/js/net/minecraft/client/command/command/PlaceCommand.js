import Command from "../Command.js";
import UndergroundHouseGenerator from "../../world/generator/structure/UndergroundHouseGenerator.js";

export default class PlaceCommand extends Command {

    constructor() {
        super("place", "<id> <x> <y> <z> <num?>", "Place structure")
    }

    execute(minecraft, args) {
        if (!(args.length === 4 || args.length === 5)) {
            return false;
        }

        let x = parseInt(args[1]);
        let y = parseInt(args[2]);
        let z = parseInt(args[3]);

        if (args[1] === "~") {
            x = Math.trunc(minecraft.player.getBlockPosX());
        } else if (args[1].startsWith("~")) {
            x = parseInt(args[1].slice(1)) + Math.trunc(minecraft.player.getBlockPosX());
        }
        
        if (args[2] === "~") {
            y = Math.trunc(minecraft.player.getBlockPosY());
        } else if (args[2].startsWith("~")) {
            y = parseInt(args[2].slice(1)) + Math.trunc(minecraft.player.getBlockPosY());
        }
        
        if (args[3] === "~") {
            z = Math.trunc(minecraft.player.getBlockPosZ());
        } else if (args[3].startsWith("~")) {
            z = parseInt(args[3].slice(1)) + Math.trunc(minecraft.player.getBlockPosZ());
        }

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return false;
        }

        const structuresToPick = {
            "test": new UndergroundHouseGenerator(minecraft.world, minecraft.world.seed)
        };

        if (structuresToPick[args[0]] !== undefined) {
            structuresToPick[args[0]].generateAtBlock(x, y, z, args[4] ?? 15, args[4] ?? 24);
            minecraft.addMessageToChat("Placed " + args[0] + " at " + x + " " + y + " " + z);
        } else {
            minecraft.addMessageToChat("There is no structure named " + args[3]);
        }

        return true;
    }

}