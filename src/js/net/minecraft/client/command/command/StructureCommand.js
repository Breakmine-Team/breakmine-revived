import Command from "../Command.js";
import StructureSelection from "../../world/StructureSelection.js";
import World from "../../world/World.js";

// Bounds for one saved structure. A 64x64x64 area fits exactly; the side cap
// stops a long thin selection from walking a million columns along one axis.
const MAX_VOLUME = 262144;
const MAX_SIDE = 128;

// Structures are kept in localStorage so /st load can find them by name; the
// file written by /st save is the same JSON.
const STORAGE_PREFIX = "bts-structure:";
const STORAGE_INDEX = "bts-structures";

/**
 * Structure tool.
 *
 *   /st p1            Set corner 1 to the block in view (or underfoot)
 *   /st p2            Set corner 2 the same way
 *   /st save <name>   Save the selected area and download it as <name>.json
 *   /st load <name>   Paste a saved structure at p1 (or at the player)
 *
 * A saved file is plain JSON: a size, and one [dx, dy, dz, id, data] entry per
 * non-air block. Air is left out, so pasting a structure never erases the
 * terrain it is dropped into.
 *
 * The selection itself is client-side (it is a rendering state), so the block
 * writes go through the local world the same way /setblock does.
 */
export default class StructureCommand extends Command {

    constructor() {
        super("st", "p1 | p2 | save <name> | load <name>", "Save and load structures");

        // The tool lives on the client: /st p1 needs the camera to find the
        // block in view, /st save must write a browser download, and the
        // outline is client rendering. Marking the command clientOnly keeps it
        // out of the normal chat round trip - singleplayer runs through the
        // integrated server, so chat commands otherwise execute in a server
        // context that has no camera and no renderer.
        //
        // The blocks of /st load are the exception: they are handed to the
        // server (see paste()), because a client-side write would only change
        // the local chunk mirror and vanish on the next chunk update.
        this.clientOnly = true;
    }

    execute(minecraft, args) {
        if (!minecraft.world || !minecraft.player) {
            minecraft.addMessageToChat("§cNo world loaded.");
            return true;
        }

        const sub = args.length > 0 ? String(args[0]).toLowerCase() : "";
        if (sub === "p1") {
            return this.setPoint(minecraft, 1);
        }
        if (sub === "p2") {
            return this.setPoint(minecraft, 2);
        }
        if (sub === "save") {
            return this.save(minecraft, args[1]);
        }
        if (sub === "load") {
            return this.load(minecraft, args[1]);
        }

        return false;
    }

    /** The selection for this Minecraft instance, created on first use. */
    getSelection(minecraft) {
        if (!minecraft.structureSelection) {
            minecraft.structureSelection = new StructureSelection();
        }
        return minecraft.structureSelection;
    }

    /** Set a corner to the block being looked at, or the one underfoot. */
    setPoint(minecraft, index) {
        const position = this.getTargetPosition(minecraft);
        const selection = this.getSelection(minecraft);
        selection.setPoint(index, position.x, position.y, position.z);

        const size = selection.getSize();
        minecraft.addMessageToChat("§aPosition p" + index + " set to §f" +
            position.x + ", " + position.y + ", " + position.z +
            (size === null ? "" : " §7(" + size.x + "x" + size.y + "x" + size.z + " selected)"));
        return true;
    }

    getTargetPosition(minecraft) {
        const player = minecraft.player;

        if (typeof player.rayTrace === "function") {
            const partialTicks = minecraft.timer ? minecraft.timer.partialTicks : 0;
            const hit = player.rayTrace(5, partialTicks);
            if (hit !== null && hit !== undefined) {
                return {x: hit.x, y: hit.y, z: hit.z};
            }
        }

        return {x: Math.floor(player.x), y: Math.trunc(player.y), z: Math.floor(player.z)};
    }

    /** Read the selected area, keep it for /st load and download the file. */
    save(minecraft, name) {
        if (!name) {
            return false;
        }

        const selection = this.getSelection(minecraft);
        const bounds = selection.getBounds();
        if (bounds === null) {
            minecraft.addMessageToChat("§cSet both corners first: /st p1 and /st p2.");
            return true;
        }

        const size = selection.getSize();
        const volume = size.x * size.y * size.z;
        if (size.x > MAX_SIDE || size.y > MAX_SIDE || size.z > MAX_SIDE || volume > MAX_VOLUME) {
            minecraft.addMessageToChat("§cSelection too large: " + size.x + "x" + size.y + "x" + size.z +
                " §7(max " + MAX_SIDE + " per side, " + MAX_VOLUME + " blocks)");
            return true;
        }

        const world = minecraft.world;

        // An unloaded chunk reads as air, which would quietly save a hole.
        if (this.isAreaUnloaded(world, {x: bounds.minX, y: bounds.minY, z: bounds.minZ}, size)) {
            minecraft.addMessageToChat("§cThat area is not fully loaded, so it cannot be saved.");
            return true;
        }

        const blocks = [];
        for (let y = bounds.minY; y < bounds.maxY; y++) {
            for (let z = bounds.minZ; z < bounds.maxZ; z++) {
                for (let x = bounds.minX; x < bounds.maxX; x++) {
                    const id = world.getBlockAt(x, y, z);
                    if (id === 0) {
                        continue;
                    }
                    blocks.push([x - bounds.minX, y - bounds.minY, z - bounds.minZ, id, world.getBlockDataAt(x, y, z)]);
                }
            }
        }

        const text = JSON.stringify({
            format: "jsmc-structure",
            version: 1,
            name: name,
            size: {x: size.x, y: size.y, z: size.z},
            origin: {x: bounds.minX, y: bounds.minY, z: bounds.minZ},
            blocks: blocks
        });

        this.storeStructure(name, text);
        this.download(name, text);

        minecraft.addMessageToChat("§aSaved §f" + name + " §7(" + size.x + "x" + size.y + "x" + size.z +
            ", " + blocks.length + " blocks) §aand downloaded it.");
        return true;
    }

    /** Paste the structure saved as <name>, or open a file when unknown. */
    load(minecraft, name) {
        if (!name) {
            return false;
        }

        const text = this.readStoredStructure(name);
        if (text !== null) {
            this.pasteText(minecraft, name, text);
            return true;
        }

        const names = this.getStoredNames();
        minecraft.addMessageToChat("§eNo saved structure named §f" + name +
            "§e, choose the .json file to load." +
            (names.length === 0 ? "" : " §7Saved: " + names.join(", ")));
        this.pickStructureFile(minecraft, name);
        return true;
    }

    /** Validate a structure file, report why, then paste it. */
    pasteText(minecraft, name, text) {
        let structure;
        try {
            structure = this.parseStructure(text);
        } catch (e) {
            minecraft.addMessageToChat("§cNot a structure file: " + e.message);
            return null;
        }

        this.paste(minecraft, name, structure);
        return structure;
    }

    /**
     * A structure file comes from disk, so every field is checked before it
     * reaches setBlockAt: a bad entry would otherwise write NaN coordinates.
     */
    parseStructure(text) {
        let data;
        try {
            data = JSON.parse(text);
        } catch (e) {
            throw new Error("invalid JSON");
        }

        if (!data || data.format !== "jsmc-structure" || !Array.isArray(data.blocks)) {
            throw new Error("missing structure data");
        }

        const size = data.size;
        if (!size || !Number.isInteger(size.x) || !Number.isInteger(size.y) || !Number.isInteger(size.z)
            || size.x <= 0 || size.y <= 0 || size.z <= 0) {
            throw new Error("bad size");
        }
        if (size.x > MAX_SIDE || size.y > MAX_SIDE || size.z > MAX_SIDE
            || size.x * size.y * size.z > MAX_VOLUME) {
            throw new Error("structure too large");
        }

        const blocks = [];
        for (const entry of data.blocks) {
            if (!Array.isArray(entry) || entry.length < 4) {
                throw new Error("bad block entry");
            }

            const dx = entry[0];
            const dy = entry[1];
            const dz = entry[2];
            const id = entry[3];
            const blockData = entry.length >= 5 ? entry[4] : 0;

            if (!Number.isInteger(dx) || !Number.isInteger(dy) || !Number.isInteger(dz)
                || dx < 0 || dy < 0 || dz < 0 || dx >= size.x || dy >= size.y || dz >= size.z) {
                throw new Error("bad block position");
            }
            if (!Number.isInteger(id) || id < 0 || id > 4095
                || !Number.isInteger(blockData) || blockData < 0 || blockData > 15) {
                throw new Error("bad block id or data");
            }

            blocks.push([dx, dy, dz, id, blockData]);
        }

        return {size: {x: size.x, y: size.y, z: size.z}, blocks: blocks};
    }

    /** Write the blocks at p1 (or the player) without clearing anything. */
    paste(minecraft, name, structure) {
        const world = minecraft.world;
        const target = this.getPasteOrigin(minecraft);
        const size = structure.size;

        if (target.y < 0 || target.y + size.y > World.TOTAL_HEIGHT) {
            minecraft.addMessageToChat("§cThe structure does not fit in the world from y " + target.y + ".");
            return;
        }

        // A connected client only mirrors the world; the server owns the
        // blocks. Hand the structure over so the paste is authoritative and
        // reaches every player - this is also the singleplayer path, since
        // singleplayer runs on the integrated server. Offline there is nobody
        // to hand it to, and the writes below are the real world.
        if (this.sendPasteToServer(minecraft, name, structure, target)) {
            minecraft.addMessageToChat("§ePasting §f" + name + " §7(" + size.x + "x" + size.y + "x" + size.z +
                ", " + structure.blocks.length + " blocks)§e...");
            return;
        }

        if (this.isAreaUnloaded(world, target, size)) {
            minecraft.addMessageToChat("§cThat area is not fully loaded.");
            return;
        }

        let placed = 0;
        for (const [dx, dy, dz, id, blockData] of structure.blocks) {
            world.setBlockAt(target.x + dx, target.y + dy, target.z + dz, id, blockData);
            placed++;
        }

        minecraft.addMessageToChat("§aPasted §f" + name + " §7(" + size.x + "x" + size.y + "x" + size.z +
            ", " + placed + " blocks) §aat §f" + target.x + ", " + target.y + ", " + target.z + "§a.");
    }

    /** Hand the paste to the server. False when running without one. */
    sendPasteToServer(minecraft, name, structure, target) {
        const controller = minecraft.playerController;
        if (!controller || typeof controller.sendJson !== "function") {
            return false;
        }

        return controller.sendJson({
            type: "structurePaste",
            name: name,
            x: target.x,
            y: target.y,
            z: target.z,
            size: structure.size,
            blocks: structure.blocks
        });
    }

    /** p1 when a selection exists, otherwise the block the player stands in. */
    getPasteOrigin(minecraft) {
        const p1 = this.getSelection(minecraft).p1;
        if (p1 !== null) {
            return {x: p1.x, y: p1.y, z: p1.z};
        }

        const player = minecraft.player;
        return {x: Math.floor(player.x), y: Math.trunc(player.y), z: Math.floor(player.z)};
    }

    isAreaUnloaded(world, origin, size) {
        if (!world || typeof world.chunkExists !== "function") {
            return false;
        }

        try {
            for (let cx = origin.x >> 4; cx <= (origin.x + size.x - 1) >> 4; cx++) {
                for (let cz = origin.z >> 4; cz <= (origin.z + size.z - 1) >> 4; cz++) {
                    if (!world.chunkExists(cx, cz)) {
                        return true;
                    }
                }
            }
        } catch (e) {
            // A client world whose provider cannot answer is not proof that
            // the area is missing; let the save/paste proceed.
            return false;
        }

        return false;
    }

    /** Save to the browser library so /st load <name> works offline. */
    storeStructure(name, text) {
        try {
            localStorage.setItem(STORAGE_PREFIX + name.toLowerCase(), text);

            const names = this.getStoredNames();
            if (!names.some(existing => existing.toLowerCase() === name.toLowerCase())) {
                names.push(name);
                localStorage.setItem(STORAGE_INDEX, JSON.stringify(names));
            }
        } catch (e) {
            // No storage (private mode): the downloaded file still has it.
        }
    }

    readStoredStructure(name) {
        try {
            return localStorage.getItem(STORAGE_PREFIX + name.toLowerCase());
        } catch (e) {
            return null;
        }
    }

    getStoredNames() {
        try {
            const names = JSON.parse(localStorage.getItem(STORAGE_INDEX));
            return Array.isArray(names) ? names : [];
        } catch (e) {
            return [];
        }
    }

    download(name, text) {
        const blob = new Blob([text], {type: "application/json"});
        const url = URL.createObjectURL(blob);

        const link = document.createElement("a");
        link.href = url;
        link.download = this.sanitizeFileName(name) + ".json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        URL.revokeObjectURL(url);
    }

    /** Open a file picker for a structure that is not in the library. */
    pickStructureFile(minecraft, name) {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".json,application/json";
        input.style.display = "none";
        document.body.appendChild(input);

        input.addEventListener("change", () => {
            const file = input.files && input.files[0];
            document.body.removeChild(input);
            if (!file) {
                return;
            }

            file.text().then(text => {
                // Remember it, so the next /st load <name> needs no picker.
                if (this.pasteText(minecraft, name, text) !== null) {
                    this.storeStructure(name, text);
                }
            }).catch(error => {
                minecraft.addMessageToChat("§cCould not read the file: " + error.message);
            });
        });

        // Dismissing the picker fires no change event; drop the hidden input
        // instead of leaving it in the page.
        input.addEventListener("cancel", () => {
            document.body.removeChild(input);
        });

        input.click();
    }

    sanitizeFileName(name) {
        const safe = String(name).replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "");
        return safe.length > 0 ? safe : "structure";
    }
}
