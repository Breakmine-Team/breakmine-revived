import Command from "../Command.js";

export default class SummonCommand extends Command {

    constructor() {
        super("summon", "<x> <y> <z> <entity>", "Summon entity at position")
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

        const summonTypes = new Map([
            ['creeper', 'Creeper'], ['player', 'Player'],
            ...['zombie', 'husk', 'drowned', 'skeleton', 'stray', 'wither_skeleton']
                .flatMap(name => [[name, `minecraft:${name}`], [`minecraft:${name}`, `minecraft:${name}`]])
        ]);
        const entityType = summonTypes.get(args[3].toLowerCase());

        if (entityType) {
            const entity = { type: entityType, x, y, z, yaw: 0, pitch: 0 };
            minecraft.addMessageToChat("Summoned " + args[3] + " at " + x + " " + y + " " + z);

            if (minecraft.broadcastEntitySpawn) {
                minecraft.broadcastEntitySpawn(entity);
            }

            return true;
        } else {
            minecraft.addMessageToChat("There is no entity named " + args[3]);
        }

        return true;
    }

}
