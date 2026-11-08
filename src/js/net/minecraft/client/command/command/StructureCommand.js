import Command from "../Command.js";
import StructureSelection from "../../world/StructureSelection.js";
import World from "../../world/World.js";



const MAX_VOLUME = 262144;
const MAX_SIDE = 128;



const STORAGE_PREFIX = "bts-structure:";
const STORAGE_INDEX = "bts-structures";

export default class StructureCommand extends Command {

    constructor() {
        super("st", "p1 | p2 | save <name> | load <name>", "Save and load structures");

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

    
    getSelection(minecraft) {
        if (!minecraft.structureSelection) {
            minecraft.structureSelection = new StructureSelection();
        }
        return minecraft.structureSelection;
    }

    
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

    
    paste(minecraft, name, structure) {
        const world = minecraft.world;
        const target = this.getPasteOrigin(minecraft);
        const size = structure.size;

        if (target.y < 0 || target.y + size.y > World.TOTAL_HEIGHT) {
            minecraft.addMessageToChat("§cThe structure does not fit in the world from y " + target.y + ".");
            return;
        }

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
            return false;
        }

        return false;
    }

    
    storeStructure(name, text) {
        try {
            localStorage.setItem(STORAGE_PREFIX + name.toLowerCase(), text);

            const names = this.getStoredNames();
            if (!names.some(existing => existing.toLowerCase() === name.toLowerCase())) {
                names.push(name);
                localStorage.setItem(STORAGE_INDEX, JSON.stringify(names));
            }
        } catch (e) {
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
                if (this.pasteText(minecraft, name, text) !== null) {
                    this.storeStructure(name, text);
                }
            }).catch(error => {
                minecraft.addMessageToChat("§cCould not read the file: " + error.message);
            });
        });

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
