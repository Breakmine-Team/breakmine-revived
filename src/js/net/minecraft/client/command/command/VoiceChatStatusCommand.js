import Command from "../Command.js";

export default class VoiceChatStatusCommand extends Command {

    constructor() {
        super("voice", "", "Show voice chat connection status")
    }

    execute(minecraft) {
        const voiceChat = minecraft.voiceChat;
        if (!voiceChat) {
            minecraft.addMessageToChat("Voice chat is not available");
            return true;
        }

        for (const line of voiceChat.getStatusLines()) {
            minecraft.addMessageToChat("\u00a77" + line);
        }

        return true;
    }

}
