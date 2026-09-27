import Command from "../Command.js";
import {BlockRegistry} from "../../world/block/BlockRegistry.js";

export default class SetBlockCommand extends Command {

    constructor() {
        super("setblock", "<x> <y> <z> <block>", "Set block at XYZ")
    }

    execute(minecraft, args) {
        if (args.length !== 4) {
            return false;
        }

        let x = parseInt(args[0]);
        let y = parseInt(args[1]);
        let z = parseInt(args[2]);

        if (args[0] === "~") {
            x = Math.trunc(minecraft.player.getBlockPosX());
        } else if (args[0].startsWith("~")) {
            x = parseInt(args[0].slice(1)) + Math.trunc(minecraft.player.getBlockPosX());
        }
        
        if (args[1] === "~") {
            y = Math.trunc(minecraft.player.getBlockPosY());
        } else if (args[1].startsWith("~")) {
            y = parseInt(args[1].slice(1)) + Math.trunc(minecraft.player.getBlockPosY());
        }
        
        if (args[2] === "~") {
            z = Math.trunc(minecraft.player.getBlockPosZ());
        } else if (args[2].startsWith("~")) {
            z = parseInt(args[2].slice(1)) + Math.trunc(minecraft.player.getBlockPosZ());
        }

        if (isNaN(x) || isNaN(y) || isNaN(z)) {
            return false;
        }

        let typeId;

        if (args[3].toUpperCase() === "AIR") {
            typeId = 0;
        } else {
            let block = BlockRegistry.getBlockByName(args[3]);
            if (!block) {
                return false;
            }
            typeId = block.id;
        }

        minecraft.world.setBlockAt(x, y, z, typeId);

        return true;
    }

}
