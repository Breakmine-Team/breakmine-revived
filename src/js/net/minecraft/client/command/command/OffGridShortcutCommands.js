import Command from "../Command.js";
import OffGridBlockRendererCommand from "./OffGridBlockRendererCommand.js";
import { BlockRegistry } from "../../world/block/BlockRegistry.js";

/**
 * Shortcut helpers for the off-grid block field. In a running game the server
 * handles /ofr and /ofrclear authoritatively (see server/offgridCommands.js);
 * this class keeps the direct local path and the shared field binding helpers.
 */
class OffGridShortcutCommand extends Command {

    constructor() {
        super("ofr", "")
        this.helper = new OffGridBlockRendererCommand();
    }

    execute(minecraft) {
        if (!minecraft.worldRenderer) {
            minecraft.addMessageToChat("§c/ofr is a client-side rendering command.");
            return true;
        }

        if (!minecraft.world) {
            minecraft.addMessageToChat("§cNo world loaded.");
            return true;
        }

        if (!minecraft.player) {
            minecraft.addMessageToChat("§cNo player.");
            return true;
        }

        // Floor the player position: getBlockPosX()/Y()/Z() only truncate
        // negative coordinates, so at a positive position they hand back the
        // FRACTIONAL player position. fill() would then key its cells on
        // non-integers, which renders fine but is invisible to every
        // integer-keyed interaction seam (covers/raytrace/collision boxes).
        const x = Math.floor(minecraft.player.x);
        const y = Math.floor(minecraft.player.y);
        const z = Math.floor(minecraft.player.z);
        const block = BlockRegistry.STONE;

        // Same loaded-chunk guard the /offgridrenderer fill path runs: the
        // tessellator samples neighbours one block past the volume.
        const world = minecraft.world;
        if (typeof world.chunkExists === "function") {
            for (let cx = (x - 1) >> 4; cx <= (x + 8) >> 4; cx++) {
                for (let cz = (z - 1) >> 4; cz <= (z + 8) >> 4; cz++) {
                    if (!world.chunkExists(cx, cz)) {
                        minecraft.addMessageToChat("§cYour area is not fully loaded yet.");
                        return true;
                    }
                }
            }
        }

        try {
            const field = this.helper.getOrBindField(minecraft);
            field.clear();
            const count = field.fill(x, y, z, 8, 8, 8, block.getId(), 0);
            field.rotate(45, "x");
            field.rotate(45, "y");
            field.rotate(45, "z");
            minecraft.addMessageToChat("§aSummoned §f" + count + " §rblocks of stone at (" +
                x + ", " + y + ", " + z + "), rotated 45° on all axes");
        } catch (e) {
            minecraft.addMessageToChat("§cError summoning: " + e.message);
        }

        return true;
    }

}

class OffGridClearShortcutCommand extends Command {

    constructor() {
        super("ofrclear", "");
        this.helper = new OffGridBlockRendererCommand();
    }

    execute(minecraft) {
        return this.helper.executeClear(minecraft);
    }

}

export { OffGridShortcutCommand, OffGridClearShortcutCommand };
export default OffGridShortcutCommand;
