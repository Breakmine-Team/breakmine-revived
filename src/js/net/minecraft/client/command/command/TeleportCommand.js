import Command from "../Command.js";

export default class TeleportCommand extends Command {

    constructor() {
        super("tp", "<player|@s|@a> <player|x y z> | <x> <y> <z>", "Teleport yourself or other players")
    }

    execute(minecraft, args) {
        if (args.length === 2) {
            return this.teleportToPlayer(minecraft, args[0], args[1]);
        }

        let targetName = null;
        let positionArgs = args;

        if (args.length === 4) {
            // Accept both "/tp <player> <x> <y> <z>" and "/tp <x> <y> <z> <player>".
            if (this.isPosition(args.slice(0, 3)) && !this.isCoordinate(args[3])) {
                positionArgs = args.slice(0, 3);
                targetName = args[3];
            } else {
                targetName = args[0];
                positionArgs = args.slice(1);
            }
        } else if (args.length !== 3) {
            return false;
        }

        const targets = targetName === null ? [minecraft.player] : this.findPlayers(minecraft, targetName);
        if (targets.length === 0) {
            minecraft.addMessageToChat("Player not found: " + targetName);
            return true;
        }

        // Relative coordinates are relative to whoever ran the command.
        const origin = minecraft.player;
        const x = this.parseCoordinate(positionArgs[0], origin.x);
        const y = this.parseCoordinate(positionArgs[1], origin.y);
        const z = this.parseCoordinate(positionArgs[2], origin.z);

        if (x === null || y === null || z === null) {
            return false;
        }

        for (const target of targets) {
            target.setPosition(x, y, z);
        }

        if (targets.length > 1) {
            minecraft.addMessageToChat("Teleported " + targets.length + " players to " + x + " " + y + " " + z);
        } else if (targets[0] === minecraft.player) {
            minecraft.addMessageToChat("Teleported to " + x + " " + y + " " + z);
        } else {
            minecraft.addMessageToChat("Teleported " + targets[0].username + " to " + x + " " + y + " " + z);
        }

        return true;
    }

    teleportToPlayer(minecraft, fromName, toName) {
        const froms = this.findPlayers(minecraft, fromName);
        if (froms.length === 0) {
            minecraft.addMessageToChat("Player not found: " + fromName);
            return true;
        }

        const destinations = this.findPlayers(minecraft, toName);
        if (destinations.length === 0) {
            minecraft.addMessageToChat("Player not found: " + toName);
            return true;
        }
        if (destinations.length > 1) {
            minecraft.addMessageToChat("Teleport destination must be a single player.");
            return true;
        }

        const to = destinations[0];
        for (const from of froms) {
            from.setPosition(to.x, to.y, to.z);
        }

        if (froms.length > 1) {
            minecraft.addMessageToChat("Teleported " + froms.length + " players to " + to.username);
        } else if (froms[0] === minecraft.player) {
            minecraft.addMessageToChat("Teleported to " + to.username);
        } else {
            minecraft.addMessageToChat("Teleported " + froms[0].username + " to " + to.username);
        }

        return true;
    }

    findPlayers(minecraft, name) {
        if (!name) {
            return [];
        }

        if (name === "@s" || name === "@p" || name === minecraft.player.username) {
            return [minecraft.player];
        }

        if (name === "@a") {
            return this.getPlayers(minecraft);
        }

        if (typeof minecraft.findPlayerByName === "function") {
            const player = minecraft.findPlayerByName(name);
            return player ? [player] : [];
        }

        return [];
    }

    getPlayers(minecraft) {
        if (typeof minecraft.getPlayers === "function") {
            const players = minecraft.getPlayers();
            if (players && players.length > 0) {
                return players;
            }
        }

        return [minecraft.player];
    }

    isCoordinate(value) {
        return typeof value === "string" && value.trim().length > 0
            && (value.startsWith("~") || !isNaN(Number(value)));
    }

    isPosition(args) {
        return args.every(value => this.isCoordinate(value));
    }

    parseCoordinate(value, base) {
        if (value === "~") {
            return base;
        }

        if (value.startsWith("~")) {
            const offset = Number(value.slice(1));
            return Number.isFinite(offset) ? base + offset : null;
        }

        const number = Number(value);
        return Number.isFinite(number) ? number : null;
    }

}
