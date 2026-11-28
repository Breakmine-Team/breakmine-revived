import Command from "../Command.js";
import RagdollEntity from "../../entity/RagdollEntity.js";

export default class RagdollCommand extends Command {

    constructor() {
        super("ragdoll", "<summon|clear>", "Summon a ragdoll or clear all of them")
    }

    execute(minecraft, args) {
        const action = (args[0] || "").toLowerCase();

        if (!minecraft.world || !minecraft.player) {
            return false;
        }

        if (action === "summon") {
            const player = minecraft.player;

            // The body spawns at the player's feet and topples over, like the one
            // a placed ragdoll item drops.
            const ragdoll = new RagdollEntity(minecraft, minecraft.world, player.x, player.y, player.z);
            minecraft.world.addEntity(ragdoll);

            minecraft.addMessageToChat("Summoned a ragdoll");
            return true;
        }

        if (action === "clear") {
            // A player lying limp is their own body, so stand them up before the
            // body is removed underneath them.
            if (minecraft.playerRagdoll !== null) {
                minecraft.endPlayerRagdoll();
            }

            const ragdolls = minecraft.world.entities
                .filter(entity => entity instanceof RagdollEntity);

            if (ragdolls.length === 0) {
                minecraft.addMessageToChat("There are no ragdolls to clear");
                return true;
            }

            for (const ragdoll of ragdolls) {
                if (minecraft.heldRagdoll === ragdoll) {
                    minecraft.heldRagdoll = null;
                }

                // Other clients would otherwise keep replaying a pose that
                // nobody simulates any more.
                ragdoll.sendNetworkState({type: "ragdoll:remove", id: ragdoll.syncId});
                minecraft.world.removeEntityById(ragdoll.id);
            }

            minecraft.addMessageToChat("Cleared " + ragdolls.length
                + (ragdolls.length === 1 ? " ragdoll" : " ragdolls"));
            return true;
        }

        return false;
    }

}
