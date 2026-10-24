import Command from "../Command.js";
import OffGridBlockField from "../../render/OffGridBlockField.js";
import {
    getOrBindField as bindOffGridField,
    getOrBindRenderer as bindOffGridRenderer
} from "../../render/OffGridClientSync.js";
import Block from "../../world/block/Block.js";
import World from "../../world/World.js";
import { BlockRegistry } from "../../world/block/BlockRegistry.js";

/**
 * Debug command for the off-grid block system.
 *
 *   /offgridrenderer <x> <y> <z> <rx> <ry> <rz> [block]
 *       Render the block stored at (x,y,z) floating at (rx,ry,rz) - works
 *       with an unloaded source when an explicit block is given.
 *
 *   /offgridrenderer fill <x> <y> <z> <w> <h> <d> <block> [data]
 *       Summon a whole range of blocks at the corner (x,y,z). Summoned
 *       blocks behave like real ones - collision, breaking, placement
 *       preview, AO - and can be edited in place. In a running game the
 *       server validates and owns the shared cells and pose.
 *
 *   /offgridrenderer move <dx> <dy> <dz>
 *       Move the whole summoned group. Decimals are allowed: whole blocks
 *       re-anchor onto the grid (collision/editing follow), the fractional
 *       remainder stays a visual offset.
 *
 *   /offgridrenderer rotate <degrees> [x|y|z]
 *       Rotate the summoned group around its own centre (default y).
 *       Collision, breaking and the placement ghost follow the pose.
 *
 *   /offgridrenderer clear
 *       Remove every summoned block and off-grid rendering.
 *
 * In a running game the server owns the shared off-grid state and runs the
 * authoritative version of this command (see server/offgridCommands.js), then
 * broadcasts the resulting state to every client through the off-grid
 * packets. This class remains the local path for a client with no server (and
 * the storage/interaction helpers used by the /ofr shortcuts).
 */
export default class OffGridBlockRendererCommand extends Command {

    constructor() {
        super("offgridrenderer",
            "<x> <y> <z> <rx> <ry> <rz> [block] | fill <x> <y> <z> <w> <h> <d> <block> [data] | move <dx> <dy> <dz> | rotate <deg> [x|y|z] | clear",);
    }

    execute(minecraft, args) {
        // Server contexts (integrated/standalone server adapters) share the
        // CommandHandler but have no renderer - say so instead of pretending.
        if (!minecraft.worldRenderer) {
            minecraft.addMessageToChat("§c/offgridrenderer is a client-side rendering command.");
            return true;
        }

        if (!minecraft.world) {
            minecraft.addMessageToChat("§cNo world loaded.");
            return true;
        }

        const sub = args.length > 0 ? String(args[0]).toLowerCase() : "";
        if (sub === "clear") {
            return this.executeClear(minecraft);
        }
        if (sub === "fill") {
            return this.executeFill(minecraft, args.slice(1));
        }
        if (sub === "move") {
            return this.executeMove(minecraft, args.slice(1));
        }
        if (sub === "rotate") {
            return this.executeRotate(minecraft, args.slice(1));
        }

        return this.executeSingle(minecraft, args);
    }

    /** Render one block from a source position to a render position. */
    executeSingle(minecraft, args) {
        if (args.length < 6) {
            return false;
        }

        const blockX = parseInt(args[0]);
        const blockY = parseInt(args[1]);
        const blockZ = parseInt(args[2]);
        const renderX = parseFloat(args[3]);
        const renderY = parseFloat(args[4]);
        const renderZ = parseFloat(args[5]);

        if (isNaN(blockX) || isNaN(blockY) || isNaN(blockZ)) {
            minecraft.addMessageToChat("§cInvalid source coordinates.");
            return true;
        }

        if (isNaN(renderX) || isNaN(renderY) || isNaN(renderZ)) {
            minecraft.addMessageToChat("§cInvalid render coordinates.");
            return true;
        }

        const renderer = this.getOrBindRenderer(minecraft);

        // Optional 7th+ argument: explicit block (id or registry name). Lets
        // you render a block whose source chunk is unloaded/unknown.
        let block = null;
        if (args.length >= 7) {
            block = this.resolveBlock(args.slice(6).join(" ").trim());
            if (!block) {
                minecraft.addMessageToChat("§cUnknown block: " + args.slice(6).join(" "));
                return true;
            }
        }

        try {
            const result = block
                ? renderer.renderBlock(block, renderX, renderY, renderZ)
                : renderer.render(blockX, blockY, blockZ, renderX, renderY, renderZ);

            if (!result) {
                minecraft.addMessageToChat("§cThe position is unloaded or air.");
                return true;
            }

            const name = result.block.name || result.block.getId();
            minecraft.addMessageToChat("§aRendered §f" + name +
                (block ? " at " : " from (" + blockX + ", " + blockY + ", " + blockZ + ") to ") +
                "(" + renderX + ", " + renderY + ", " + renderZ + ").");
        } catch (e) {
            minecraft.addMessageToChat("§cError rendering: " + e.message);
        }

        return true;
    }

    /** Summon a volume of one block type at (x,y,z). */
    executeFill(minecraft, args) {
        if (args.length < 7) {
            return false;
        }

        const x = parseInt(args[0]);
        const y = parseInt(args[1]);
        const z = parseInt(args[2]);
        const w = parseInt(args[3]);
        const h = parseInt(args[4]);
        const d = parseInt(args[5]);

        if (isNaN(x) || isNaN(y) || isNaN(z) || isNaN(w) || isNaN(h) || isNaN(d)) {
            minecraft.addMessageToChat("§cInvalid coordinates or sizes.");
            return true;
        }

        if (w < 1 || h < 1 || d < 1 || w > OffGridBlockField.MAX_DIM || h > OffGridBlockField.MAX_DIM || d > OffGridBlockField.MAX_DIM) {
            minecraft.addMessageToChat("§cEach size must be 1.." + OffGridBlockField.MAX_DIM + ".");
            return true;
        }

        if (w * h * d > OffGridBlockField.MAX_CELLS) {
            minecraft.addMessageToChat("§cToo many blocks: " + (w * h * d) + " > " + OffGridBlockField.MAX_CELLS + ".");
            return true;
        }

        if (y < 0 || y + h > World.TOTAL_HEIGHT) {
            minecraft.addMessageToChat("§cHeight out of world (y 0.." + (World.TOTAL_HEIGHT - 1) + ").");
            return true;
        }

        const block = this.resolveBlock(args[6]);
        if (!block) {
            minecraft.addMessageToChat("§cUnknown block: " + args[6]);
            return true;
        }

        let data = 0;
        if (args.length >= 8) {
            data = parseInt(args[7]);
            if (isNaN(data) || data < 0 || data > 15) {
                minecraft.addMessageToChat("§cBlock data must be 0..15.");
                return true;
            }
        }

        // The field renders through the real renderer, which samples blocks
        // one past the volume borders; a missing chunk there would make the
        // singleplayer provider generate an entire chunk mid-mesh. Require
        // the volume (plus a 1-block margin) to be inside loaded chunks.
        const world = minecraft.world;
        if (typeof world.chunkExists === "function") {
            for (let cx = (x - 1) >> 4; cx <= (x + w) >> 4; cx++) {
                for (let cz = (z - 1) >> 4; cz <= (z + d) >> 4; cz++) {
                    if (!world.chunkExists(cx, cz)) {
                        minecraft.addMessageToChat("§cThat area is not fully loaded.");
                        return true;
                    }
                }
            }
        }

        try {
            const field = this.getOrBindField(minecraft);
            const count = field.fill(x, y, z, w, h, d, block.getId(), data);
            const name = block.name || block.getId();
            minecraft.addMessageToChat("§aSummoned §f" + count + " §rblock(s) of §f" + name +
                " §aat (" + x + ", " + y + ", " + z + ")-(" + (x + w - 1) + ", " + (y + h - 1) + ", " + (z + d - 1) +
                ").");
        } catch (e) {
            minecraft.addMessageToChat("§cError summoning: " + e.message);
        }

        return true;
    }

    /** Move the summoned group by a (possibly fractional) world delta. */
    executeMove(minecraft, args) {
        if (args.length < 3) {
            return false;
        }

        const dx = parseFloat(args[0]);
        const dy = parseFloat(args[1]);
        const dz = parseFloat(args[2]);

        if (isNaN(dx) || isNaN(dy) || isNaN(dz)) {
            minecraft.addMessageToChat("§cInvalid offsets, FYI decimals are allowed (e.g. 0.5 -1 2.25).");
            return true;
        }

        const field = this.requireField(minecraft);
        if (!field) return true;

        try {
            const result = field.move(dx, dy, dz, minecraft.world);
            const wholeMove = Number.isInteger(dx) && Number.isInteger(dy) && Number.isInteger(dz);
            if (wholeMove && !result.shifted) {
                minecraft.addMessageToChat("§eTarget area not loaded.");
            } else {
                minecraft.addMessageToChat("§aMoved the summoned group by (" + dx + ", " + dy + ", " + dz + ").");
            }
        } catch (e) {
            minecraft.addMessageToChat("§cError moving: " + e.message);
        }

        return true;
    }

    /** Rotate the summoned group around its own centre. */
    executeRotate(minecraft, args) {
        if (args.length < 1) {
            return false;
        }

        const degrees = parseFloat(args[0]);
        if (isNaN(degrees)) {
            minecraft.addMessageToChat("§cInvalid angle.");
            return true;
        }

        const axis = args.length >= 2 ? String(args[1]).toLowerCase() : "y";
        if (axis !== "x" && axis !== "y" && axis !== "z") {
            minecraft.addMessageToChat("§cAxis must be x, y or z.");
            return true;
        }

        const field = this.requireField(minecraft);
        if (!field) return true;

        try {
            field.rotate(degrees, axis);
            minecraft.addMessageToChat("§aRotated the summoned group by " + degrees + "° around " + axis.toUpperCase());
        } catch (e) {
            minecraft.addMessageToChat("§cError rotating: " + e.message);
        }

        return true;
    }

    /** Shared guard for move/rotate: the field with something in it. */
    requireField(minecraft) {
        const field = minecraft.offGridBlockField;
        if (!field || field.cells.size === 0) {
            minecraft.addMessageToChat("§cNothing summoned yet.");
            return null;
        }
        if (field.world !== minecraft.world) {
            minecraft.addMessageToChat("§cThe summoned blocks belong to a previous world.");
            return null;
        }
        return field;
    }

    /** Remove summoned blocks and every off-grid rendering. */
    executeClear(minecraft) {
        let removed = 0;

        const field = minecraft.offGridBlockField;
        if (field) {
            removed = field.cells.size;
            field.clear();
        }

        if (minecraft.offGridBlockRenderer) {
            minecraft.offGridBlockRenderer.clear();
        }

        minecraft.addMessageToChat("§aCleared off-grid renderings" +
            (removed > 0 ? " and " + removed + " summoned block(s)" : "") + ".");
        return true;
    }

    /** Resolve a numeric id or registry name to a Block. */
    resolveBlock(blockArg) {
        const blockIdNum = parseInt(blockArg);
        if (!isNaN(blockIdNum)) {
            const byId = Block.getById(blockIdNum) || BlockRegistry.get(blockIdNum);
            if (byId) return byId;
        }
        return BlockRegistry.get(blockArg);
    }

    getOrBindRenderer(minecraft) {
        return bindOffGridRenderer(minecraft);
    }

    /**
     * Fetch the field bound to the current world, creating or rebinding it
     * as needed: worlds are recreated per load, so a stale field must be
     * dropped together with its meshes instead of resurrected.
     */
    getOrBindField(minecraft) {
        return bindOffGridField(minecraft);
    }

}