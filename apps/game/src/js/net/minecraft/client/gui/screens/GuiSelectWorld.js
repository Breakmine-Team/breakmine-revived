import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiWorldSlotContainer from "../widgets/GuiWorldSlotContainer.js";
import GuiWorldSlot from "../widgets/GuiWorldSlot.js";
import GuiCreateWorld from "./GuiCreateWorld.js";
import GuiYesNo from "./GuiYesNo.js";
import GuiTooltip from "../widgets/GuiTooltip.js";
import fs from "../../fs/ServerFs.js";
import path from "../../../util/path.js";
import { loadJSZip } from "../../JSZipLoader.js";

export default class GuiSelectWorld extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.worldSlotContainer = null;
        this.saveList = [];
        this.selectedWorld = -1;
    }

    setSelectedWorld(index) {
        this.selectedWorld = index;
        const bool = (index >= 0 && index < this.saveList.length);
        this.buttonSelect.enabled = bool;
        this.buttonDelete.enabled = bool;
        this.buttonExport.enabled = bool;
    }

    init() {
        super.init();

        this.worldSlotContainer = new GuiWorldSlotContainer(this, this.saveList);

        this.minecraft.getWorldList().then(list => {
            this.saveList = list;
            this.refreshWorldSlots();
        });

        this.buttonSelect = new GuiButton(this.minecraft, "Play Selected World", this.width / 2 - 154, this.height - 52, 150, 20, () => {
            if (this.selectedWorld !== -1) {
                const world = this.saveList[this.selectedWorld];
                this.minecraft.loadSavedWorld(world.key);
            }
        });
        this.buttonDelete = new GuiButton(this.minecraft, "Delete", this.width / 2 - 106, this.height - 28, 102, 20, () => {
            if (this.selectedWorld !== -1) {
                const world = this.saveList[this.selectedWorld];
                this.minecraft.displayScreen(new GuiYesNo(this, "Are you sure you want to delete this world?", `'${world.name}' will be lost forever! (A long time!)`, "Yes", "No", async () => {
                    await this.minecraft.deleteWorld(world.key);
                    this.saveList = this.saveList.filter(w => w.key !== world.key);
                    this.refreshWorldSlots();
                    this.selectedWorld = -1;
                    this.worldSlotContainer.selectedWorld = -1;
                    this.buttonSelect.enabled = false;
                    this.buttonDelete.enabled = false;
                    this.buttonExport.enabled = false;
                }));
            }
        });
        this.buttonExport = new GuiButton(this.minecraft, "\u00cd", this.width / 2 - 154, this.height - 28, 20, 20, () => {
            if (this.selectedWorld !== -1) {
                this.exportWorld(this.saveList[this.selectedWorld]);
            }
        });

        this.buttonList.push(new GuiButton(this.minecraft, "Create New World", this.width / 2 + 4, this.height - 52, 150, 20, () => {
            this.minecraft.displayScreen(new GuiCreateWorld(this));
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "\u00d3", this.width / 2 - 130, this.height - 28, 20, 20, () => {
            this.importWorld();
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 + 4, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
        this.buttonList.push(this.buttonSelect);
        this.buttonList.push(this.buttonDelete);
        this.buttonList.push(this.buttonExport);

        this.buttonList.push(new GuiTooltip(this.minecraft, "Download", this.width / 2 - 154, this.height - 28, 20, 20));
        this.buttonList.push(new GuiTooltip(this.minecraft, "Upload", this.width / 2 - 130, this.height - 28, 20, 20));

        this.buttonSelect.enabled = false;
        this.buttonDelete.enabled = false;
        this.buttonExport.enabled = false;
    }

    refreshWorldSlots() {
        this.worldSlotContainer.slotList = this.saveList.map((data, index) =>
            new GuiWorldSlot(
                {
                    name: data.name || 'Unknown World',
                    date: data.lastPlayed ? new Date(data.lastPlayed).toLocaleDateString() : '',
                    details: (data.worldType || 'normal') + ' - ' + (data.gameMode || 'survival'),
                    iconPath: path.join('worlds', data.key, 'icon.png'),
                },
                this.width / 2 - 110,
                0,
                220,
                36,
                () => {
                    this.worldSlotContainer.setSelected(index);
                },
                this.minecraft
            )
        );
    }

    _worldDir(worldKey) {
        const serverName = String(worldKey || 'main').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'main';
        return path.join('worlds', serverName);
    }

    async _loadJSZip() {
        return loadJSZip();
    }

    _addDirToZip(zip, dir, prefix) {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, entry.name);
            const rel = prefix ? prefix + '/' + entry.name : entry.name;
            if (entry.isDirectory()) {
                this._addDirToZip(zip, full, rel);
            } else if (entry.isFile()) {
                try {
                    zip.file(rel, fs.readFileSync(full));
                } catch (e) {
                    // Skip unreadable files.
                }
            }
        }
    }

    async exportWorld(world) {
        await fs.ready();
        const dir = this._worldDir(world.key);
        if (!fs.existsSync(dir)) {
            this.minecraft.displayScreen(new GuiYesNo(this, "Export failed", `No save data found for '${world.name || world.key}'.`, "OK", "Cancel", () => {}));
            return;
        }

        try {
            const JSZip = await this._loadJSZip();
            const zip = new JSZip();
            this._addDirToZip(zip, dir, '');
            const blob = await zip.generateAsync({ type: 'blob' });

            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = (world.name || world.key) + '.zip';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(a.href);
        } catch (e) {
            this.minecraft.displayScreen(new GuiYesNo(this, "Export failed", e.message, "OK", "Cancel", () => {}));
        }
    }

    importWorld() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = (e) => {
            const file = e.target.files && e.target.files[0];
            if (file) {
                this._processImport(file);
            }
        };
        input.click();
    }

    async _processImport(file) {
        await fs.ready();

        try {
            const JSZip = await this._loadJSZip();
            const zip = await JSZip.loadAsync(file);

            const worldKey = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
            const destDir = this._worldDir(worldKey);

            const paths = [];
            for (const [zipPath, zipEntry] of Object.entries(zip.files)) {
                if (zipEntry.dir) continue;
                const rel = zipPath.replace(/\\/g, '/').replace(/^worlds\/[^/]+\//, '');
                if (rel.split('/').some(part => part === '..')) continue;
                paths.push(rel);
            }

            const normalized = this._normalizeImportPaths(paths);
            if (normalized.length === 0) {
                throw new Error("No world files found in archive");
            }
            if (!normalized.some(p => p === 'serverconfig.conf' || p === 'world_data.bin')) {
                throw new Error("Archive does not look like a world (missing serverconfig.conf or world_data.bin)");
            }

            fs.mkdirSync(destDir, { recursive: true });
            for (const rel of normalized) {
                const zipEntry = Object.entries(zip.files).find(([zipPath, e]) => {
                    if (e.dir) return false;
                    const r = zipPath.replace(/\\/g, '/').replace(/^worlds\/[^/]+\//, '');
                    return r === rel;
                });
                if (!zipEntry) continue;
                const data = await zipEntry[1].async('uint8array');
                fs.writeFileSync(path.join(destDir, rel), data);
                const parent = path.dirname(path.join(destDir, rel));
                if (parent && parent !== destDir && !fs.existsSync(parent)) {
                    fs.mkdirSync(parent, { recursive: true });
                }
            }

            this.saveList = await this.minecraft.getWorldList();
            this.refreshWorldSlots();
            this.selectedWorld = -1;
            this.worldSlotContainer.selectedWorld = -1;
            this.buttonSelect.enabled = false;
            this.buttonDelete.enabled = false;
            this.buttonExport.enabled = false;
        } catch (e) {
            this.minecraft.displayScreen(new GuiYesNo(this, "Import failed", e.message, "OK", "Cancel", () => {}));
        }
    }

    // Strip a single wrapping folder (e.g. a zipped folder, or the whole
    // world dir) so files land at the world root: serverconfig.conf,
    // world_data.bin, players/<username>.json.
    _normalizeImportPaths(paths) {
        const cleaned = paths
            .map(p => p.split('/').filter(s => s.length > 0).join('/'))
            .filter(p => p.length > 0);

        const first = cleaned[0];
        const top = first && first.includes('/') ? first.split('/')[0] : null;
        if (top && cleaned.every(p => p === top || p.startsWith(top + '/'))) {
            return cleaned.map(p => (p === top ? null : p.slice(top.length + 1))).filter(Boolean);
        }
        return cleaned;
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.worldSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        this.drawCenteredString(stack, "Select World", this.width / 2, 20);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    // Forward drag/release so the scrollbar thumb can be dragged.
    mouseDragged(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    // Forward mouse wheel events to the list (handled by the container).
    // `amount` is the raw wheel delta; sign indicates direction.
    mouseScrolled(mouseX, mouseY, amount) {
        this.worldSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        super.mouseScrolled(mouseX, mouseY, amount);
    }

    onScroll(mouseX, mouseY, amount) {
        this.worldSlotContainer.mouseScrolled(mouseX, mouseY, amount);
    }

    onClose() {
    }
}
