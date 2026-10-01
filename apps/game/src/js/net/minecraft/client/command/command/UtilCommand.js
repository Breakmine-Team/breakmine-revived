import Command from "../Command.js";

export default class UtilCommand extends Command {

    constructor() {
        super("util", "", "Testing utilities");
    }

    execute(minecraft, args) {
        return true;
    }

}