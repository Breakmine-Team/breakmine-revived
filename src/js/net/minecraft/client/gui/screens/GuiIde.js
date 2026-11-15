import GuiScreen from "../GuiScreen.js";
import JphFormat from "../../../mod/JphFormat.js";
import SourceRegistry from "../../../mod/SourceRegistry.js";
import ModulePatcher from "../../../mod/ModulePatcher.js";
import { buildSourceTree, countFiles, collectDirectoryPaths, ancestorPaths } from "../ide/SourceTree.js";
import SourcePatch from "../ide/SourcePatch.js";

const OVERLAY_ID = "jph-ide-overlay";
const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
const ROW_STYLE = "display:flex;align-items:center;gap:5px;height:20px;border-left:2px solid transparent;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";

function make(tag, css, text) {
    const element = document.createElement(tag);
    if (css) element.style.cssText = css;
    if (text !== undefined) element.textContent = text;
    return element;
}

function button(label, css, onClick) {
    const element = make("button", "cursor:pointer;border:1px solid #5f5f60;background:#3b3b3e;color:#eee;padding:4px 10px;border-radius:3px;font:12px " + MONO + ";" + (css || ""), label);
    element.type = "button";
    element.addEventListener("click", (event) => {
        event.preventDefault();
        onClick();
    });
    return element;
}

function input(placeholder, css, value = "") {
    const element = make("input", "border:1px solid #5f5f60;background:#1b1b1d;color:#eee;padding:4px 6px;border-radius:3px;font:12px " + MONO + ";" + (css || ""));
    element.type = "text";
    element.placeholder = placeholder;
    element.value = value;
    return element;
}

function downloadText(filename, text) {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
}

// The IDE edits .jph patch scripts: each one runs against a game file's live
// exports (see ModulePatcher), so a patch can replace or wrap any behaviour in
// that file without touching the file on disk.
export default class GuiIde extends GuiScreen {

    constructor(minecraft, previousScreen) {
        super();
        this.minecraft = minecraft;
        this.previousScreen = previousScreen;

        this.docs = new Map();
        this.activeFile = null;
        this.previewFile = null;
        this.editor = null;
        this.overlay = null;
        this.status = null;
        this.fileList = null;
        this.fileCountLabel = null;
        this.search = null;
        this.expanded = new Set();
        this.aceEditor = null;
        this.acePromise = null;
        this.onResize = null;

        // Direct edits of a game file, keyed by path. A file enters editedSources
        // only once it differs from what ships; editedSources and autoPatches
        // together say whether a patch is still the IDE's to rewrite.
        this.originalSources = new Map();
        this.editedSources = new Map();
        this.autoPatches = new Map();
        this.manualPatches = new Set();
        this.autoTimer = null;
        this.suppressSync = false;
    }

    init() {
        super.init();
        this.pauseGame = false;

        // setup() runs init() again on every window resize, and the overlay is
        // plain DOM: follow the new frame instead of rebuilding it and the editor.
        if (this.overlay) {
            this.positionOverlay();
            return;
        }

        this.mount();
    }

    onClose() {
        this.unmount();
        super.onClose();
    }

    keyTyped(key) {
        // Typing belongs to the editor overlay, not to the game.
        return true;
    }

    drawScreen(stack) {
        this.drawDefaultBackground(stack);
    }

    // --- overlay -------------------------------------------------------------

    unmount() {
        if (this.autoTimer !== null) {
            clearTimeout(this.autoTimer);
            this.autoTimer = null;
        }
        if (this.onResize) {
            window.removeEventListener("resize", this.onResize);
            this.onResize = null;
        }
        if (this.editor && typeof this.editor.destroy === "function") {
            try { this.editor.destroy(); } catch (err) { console.warn("[IDE] Could not destroy editor:", err); }
        }
        this.editor = null;
        this.aceEditor = null;

        if (this.overlay) {
            this.overlay.remove();
            this.overlay = null;
        }
    }

    mount() {
        this.unmount();

        const previous = document.getElementById(OVERLAY_ID);
        if (previous) previous.remove();

        const overlay = make("div", "position:fixed;z-index:2147483000;display:flex;flex-direction:column;background:#26262a;color:#eee;font:12px " + MONO + ";border:1px solid #5f5f60;box-shadow:0 10px 40px rgba(0,0,0,0.6);");
        overlay.id = OVERLAY_ID;
        this.overlay = overlay;

        const header = make("div", "display:flex;align-items:center;gap:8px;padding:6px 8px;background:#333338;border-bottom:1px solid #5f5f60;");
        header.appendChild(make("div", "font-weight:bold;", "JavaScript PatcH IDE"));
        this.status = make("div", "flex:1;color:#9fd8a0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;", "");
        header.appendChild(this.status);
        header.appendChild(button("Close", "", () => this.minecraft.displayScreen(this.previousScreen)));
        overlay.appendChild(header);

        const body = make("div", "display:flex;flex:1;min-height:0;");

        // File browser
        const sidebar = make("div", "width:330px;min-width:240px;display:flex;flex-direction:column;border-right:1px solid #5f5f60;background:#222226;");
        const treeTools = make("div", "display:flex;align-items:center;gap:4px;padding:6px 6px 0 6px;");
        this.fileCountLabel = make("div", "flex:1;color:#9a9a9a;font-size:11px;overflow:hidden;white-space:nowrap;", "");
        treeTools.appendChild(this.fileCountLabel);
        treeTools.appendChild(button("Expand", "padding:2px 6px;font-size:11px;", () => this.expandAll()));
        treeTools.appendChild(button("Collapse", "padding:2px 6px;font-size:11px;", () => this.collapseAll()));
        sidebar.appendChild(treeTools);
        this.search = input("Filter game files...", "margin:6px;flex:none;");
        this.search.addEventListener("input", () => this.renderFileList());
        sidebar.appendChild(this.search);
        this.fileList = make("div", "flex:1;overflow:auto;min-height:0;");
        sidebar.appendChild(this.fileList);
        body.appendChild(sidebar);

        // Editor column
        const main = make("div", "display:flex;flex-direction:column;flex:1;min-width:0;min-height:0;");

        const toolbar = make("div", "display:flex;align-items:center;gap:6px;padding:6px 8px;border-bottom:1px solid #5f5f60;background:#2d2d31;");
        this.tabLabel = make("div", "flex:1;color:#cfcfcf;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;", "Select a file to inspect its source");
        toolbar.appendChild(this.tabLabel);
        toolbar.appendChild(button("Patch this file", "", () => this.patchSelectedFile()));
        toolbar.appendChild(button("Source / patch", "", () => this.toggleSourceView()));
        toolbar.appendChild(button("Remove patch", "", () => this.removeActivePatch()));
        main.appendChild(toolbar);

        this.editorHost = make("div", "position:relative;flex:1;min-height:0;background:#1b1b1d;");
        main.appendChild(this.editorHost);

        // Metadata + export
        const footer = make("div", "display:flex;align-items:center;gap:6px;padding:6px 8px;border-top:1px solid #5f5f60;background:#2d2d31;flex-wrap:wrap;");
        this.fieldId = input("patch id", "width:120px;", "my_patch");
        this.fieldName = input("name", "width:150px;", "My Patch");
        this.fieldAuthor = input("author", "width:120px;", this.minecraft?.settings?.username || "Unknown");
        this.fieldDescription = input("description", "flex:1;min-width:140px;", "");
        footer.appendChild(make("span", "color:#9a9a9a;", "id"));
        footer.appendChild(this.fieldId);
        footer.appendChild(make("span", "color:#9a9a9a;", "name"));
        footer.appendChild(this.fieldName);
        footer.appendChild(make("span", "color:#9a9a9a;", "author"));
        footer.appendChild(this.fieldAuthor);
        footer.appendChild(this.fieldDescription);
        footer.appendChild(button("Validate", "", () => this.validate()));
        footer.appendChild(button("Import .jph", "", () => this.importJph()));
        footer.appendChild(button("Export .jph", "background:#2f6f3f;", () => this.exportJph()));
        main.appendChild(footer);

        body.appendChild(main);
        overlay.appendChild(body);
        document.body.appendChild(overlay);

        this.positionOverlay();
        this.onResize = () => {
            this.positionOverlay();
            if (this.aceEditor) {
                try { this.aceEditor.resize(); } catch (err) { /* overlay was closed */ }
            }
        };
        window.addEventListener("resize", this.onResize);

        // Nothing is swallowed here on purpose. Stopping propagation in the capture
        // phase kept keydown from ever reaching Ace's textarea, and the game's window
        // listeners had already run by then anyway. GameWindow and Keyboard ignore
        // events aimed at a focused text field instead, so typing stays in the editor.
        overlay.addEventListener("keydown", (event) => {
            if ((event.ctrlKey || event.metaKey) && String(event.key).toLowerCase() === "s") {
                event.preventDefault();
                this.validate();
            }
        });

        this.expandInitialFolders();
        this.renderFileList();
        this.setStatus(SourceRegistry.isAvailable()
            ? `${SourceRegistry.list().length} game files — edit one to patch it`
            : "source tree unavailable in this build");
        this.createEditor();
    }

    positionOverlay() {
        if (!this.overlay) return;
        const wrapper = this.minecraft?.window?.wrapper;
        const rect = wrapper && typeof wrapper.getBoundingClientRect === "function"
            ? wrapper.getBoundingClientRect()
            : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };

        const width = Math.max(480, Math.floor(rect.width));
        const height = Math.max(360, Math.floor(rect.height));
        this.overlay.style.left = `${Math.floor(rect.left)}px`;
        this.overlay.style.top = `${Math.floor(rect.top)}px`;
        this.overlay.style.width = `${width}px`;
        this.overlay.style.height = `${height}px`;
    }

    setStatus(message, isError = false) {
        if (!this.status) return;
        this.status.textContent = message;
        this.status.style.color = isError ? "#ff8f8f" : "#9fd8a0";
    }

    // --- editor --------------------------------------------------------------

    async createEditor() {
        try {
            const ace = await this.loadAce();
            const editor = ace.edit(this.editorHost);
            editor.setTheme("ace/theme/monokai");
            editor.session.setMode("ace/mode/javascript");
            editor.session.setUseWorker(false);
            editor.session.setTabSize(4);
            editor.session.setUseSoftTabs(true);
            editor.session.on("change", () => this.syncFromEditor());
            this.aceEditor = editor;

            // Ace measures its container when it is created, but the overlay keeps
            // laying out after the async import resolves, so measure once more.
            requestAnimationFrame(() => {
                try { editor.resize(); } catch (err) { /* overlay was closed */ }
            });

            this.editor = {
                setText: (text, readOnly) => {
                    if (editor.getValue() === text) {
                        editor.setReadOnly(!!readOnly);
                        return;
                    }
                    editor.setValue(text, -1);
                    editor.setReadOnly(!!readOnly);
                },
                getText: () => editor.getValue(),
                focus: () => editor.focus(),
                destroy: () => editor.destroy()
            };
        } catch (err) {
            console.warn("[IDE] Ace editor unavailable, falling back to a plain textarea:", err);
            this.aceEditor = null;
            const area = make("textarea", "position:absolute;inset:0;width:100%;height:100%;resize:none;border:0;outline:none;background:#1b1b1d;color:#eee;font:12px " + MONO + ";padding:8px;");
            area.spellcheck = false;
            area.addEventListener("input", () => this.syncFromEditor());
            this.editorHost.appendChild(area);
            this.editor = {
                setText: (text, readOnly) => {
                    area.value = text;
                    area.readOnly = !!readOnly;
                },
                getText: () => area.value,
                focus: () => area.focus(),
                destroy: () => area.remove()
            };
        }

        this.openSelection();
    }

    async loadAce() {
        if (!this.acePromise) {
            this.acePromise = import("../ide/AceEditor.js").then((module) => {
                const ace = module.default;
                if (!ace || typeof ace.edit !== "function") {
                    throw new Error("Ace did not expose edit()");
                }
                return ace;
            });
        }
        return this.acePromise;
    }

    // --- file tree -----------------------------------------------------------

    renderFileList() {
        if (!this.fileList) return;
        this.fileList.textContent = "";

        if (!SourceRegistry.isAvailable()) {
            if (this.fileCountLabel) this.fileCountLabel.textContent = "unavailable";
            this.fileList.appendChild(make("div", "padding:8px;color:#ff8f8f;", "No source tree in this build."));
            return;
        }

        const query = this.isFiltering() ? this.search.value.trim() : "";
        const all = SourceRegistry.list();
        const files = SourceRegistry.search(query, Infinity);

        if (this.fileCountLabel) {
            this.fileCountLabel.textContent = query
                ? `${files.length} of ${all.length} files`
                : `${all.length} files, ${this.docs.size} patch${this.docs.size === 1 ? "" : "es"}`;
        }

        if (files.length === 0) {
            this.fileList.appendChild(make("div", "padding:8px;color:#9a9a9a;", "No matching files."));
            return;
        }

        this.renderTree(buildSourceTree(files), 0);
    }

    renderTree(node, depth) {
        const forceOpen = this.isFiltering();

        for (const child of node.children) {
            const row = make("div", ROW_STYLE + `padding-left:${6 + depth * 12}px;`);

            if (child.dir) {
                const open = forceOpen || this.expanded.has(child.path);
                row.appendChild(make("span", "width:10px;color:#9a9a9a;", open ? "\u25BE" : "\u25B8"));
                row.appendChild(make("span", "color:#d7ba7d;", `${child.name}/`));
                row.appendChild(make("span", "color:#6a6a6a;", String(countFiles(child))));
                row.title = child.path;
                row.addEventListener("click", () => this.toggleFolder(child.path));
                this.fileList.appendChild(row);

                if (open) this.renderTree(child, depth + 1);
                continue;
            }

            const patched = this.docs.has(child.path);
            const selected = child.path === this.activeFile || child.path === this.previewFile;
            if (selected) {
                row.style.background = "#3b3b40";
                row.style.borderLeftColor = "#9fd8a0";
            }

            row.appendChild(make("span", "width:10px;color:" + (patched ? "#9fd8a0" : "transparent") + ";", "\u25CF"));
            row.appendChild(make("span", patched ? "color:#9fd8a0;" : "color:#cfcfcf;", child.name));
            if (patched) row.appendChild(make("span", "color:#6a6a6a;", "patch"));
            row.title = patched ? `${child.path} (patched)` : child.path;
            row.addEventListener("click", () => this.openFile(child.path));
            this.fileList.appendChild(row);
        }
    }

    isFiltering() {
        return !!(this.search && this.search.value.trim().length > 0);
    }

    toggleFolder(path) {
        if (this.expanded.has(path)) this.expanded.delete(path);
        else this.expanded.add(path);
        this.renderFileList();
    }

    expandInitialFolders() {
        if (this.expanded.size > 0 || !SourceRegistry.isAvailable()) return;

        // Two levels open to start with: enough to see the project's shape without
        // a 500-row wall. Everything stays collapsible, and opening a file or
        // filtering expands whatever it needs on its own.
        for (const path of collectDirectoryPaths(buildSourceTree(SourceRegistry.list()))) {
            if (path.split("/").length <= 2) this.expanded.add(path);
        }
    }

    expandAll() {
        const query = this.isFiltering() ? this.search.value.trim() : "";
        for (const path of collectDirectoryPaths(buildSourceTree(SourceRegistry.search(query, Infinity)))) {
            this.expanded.add(path);
        }
        this.renderFileList();
    }

    collapseAll() {
        this.expanded.clear();
        this.renderFileList();
    }

    toggleSourceView() {
        if (this.activeFile !== null) {
            this.previewFile = this.activeFile;
            this.activeFile = null;
        } else if (this.previewFile !== null && this.docs.has(this.previewFile)) {
            this.activeFile = this.previewFile;
            this.previewFile = null;
        } else {
            return;
        }

        this.renderFileList();
        this.openSelection();
    }

    openFile(file) {
        this.previewFile = null;
        // A file with source edits opens where the editing happened; its
        // generated patch is one click away with the Source / patch toggle.
        if (this.docs.has(file) && !this.editedSources.has(file)) {
            this.activeFile = file;
        } else {
            this.activeFile = null;
            this.previewFile = file;
        }
        for (const directory of ancestorPaths(file)) this.expanded.add(directory);
        this.renderFileList();
        this.openSelection();
    }

    async openSelection() {
        if (!this.editor) return;

        if (this.activeFile !== null) {
            const file = this.activeFile;
            this.tabLabel.textContent = this.editedSources.has(file)
                ? `${file} — patch script (generated from your edits)`
                : `${file} — patch script`;
            this.setEditorText(this.docs.get(file) ?? "", false);
            this.editor.focus();
            return;
        }

        if (this.previewFile !== null) {
            const file = this.previewFile;
            this.tabLabel.textContent = `${file} — source (your edits become a patch)`;
            try {
                const source = await SourceRegistry.read(file);
                if (this.previewFile !== file) return;
                this.originalSources.set(file, source);
                this.setEditorText(this.editedSources.has(file) ? this.editedSources.get(file) : source, false);
            } catch (err) {
                this.setStatus(`Could not read ${file}: ${err.message}`, true);
            }
            return;
        }

        this.tabLabel.textContent = "Select a file to inspect its source";
        this.setEditorText("", true);
    }

    // Programmatic text changes must not look like typing: Ace fires `change`
    // during setValue, which would otherwise record the file as edited and
    // schedule a regeneration of the patch being displayed.
    setEditorText(text, readOnly) {
        this.suppressSync = true;
        try {
            this.editor.setText(text, readOnly);
        } finally {
            this.suppressSync = false;
        }
    }

    syncFromEditor() {
        if (!this.editor || this.suppressSync) return;

        if (this.activeFile !== null) {
            const file = this.activeFile;
            const text = this.editor.getText();
            this.docs.set(file, text);

            // A generated patch that no longer matches what was generated was
            // edited by hand; regenerating would silently throw those edits away.
            if (this.autoPatches.has(file) && text !== this.autoPatches.get(file)) {
                this.manualPatches.add(file);
                this.setStatus(`You are hand-editing the patch for ${file}: it will not be regenerated`);
            }
            return;
        }

        if (this.previewFile !== null) {
            const file = this.previewFile;
            const text = this.editor.getText();
            const original = this.originalSources.get(file);

            if (original !== undefined && text === original) this.editedSources.delete(file);
            else this.editedSources.set(file, text);

            this.scheduleAutoPatch(file);
        }
    }

    scheduleAutoPatch(file) {
        if (this.autoTimer !== null) clearTimeout(this.autoTimer);
        this.autoTimer = setTimeout(() => {
            this.autoTimer = null;
            this.autoGeneratePatch(file);
        }, 350);
    }

    // Diffs the edited file against what ships and rewrites its patch script.
    autoGeneratePatch(file) {
        const original = this.originalSources.get(file);
        if (original === undefined || this.manualPatches.has(file)) return;

        const edited = this.editedSources.get(file);

        if (edited === undefined) {
            if (!this.autoPatches.has(file)) return;
            this.autoPatches.delete(file);
            this.docs.delete(file);
            this.renderFileList();
            if (this.activeFile === file) this.openSelection();
            this.setStatus(`${file} matches the shipped file again; its patch was removed`);
            return;
        }

        let result;
        try {
            result = SourcePatch.generatePatch(file, original, edited);
        } catch (err) {
            this.setStatus(`Could not build a patch for ${file}: ${err.message}`, true);
            return;
        }

        if (!result.source) {
            const first = result.skipped[0];
            if (this.autoPatches.has(file)) {
                this.autoPatches.delete(file);
                this.docs.delete(file);
                this.renderFileList();
                if (this.activeFile === file) this.openSelection();
            }
            this.setStatus(first
                ? `No patch for ${file}: ${first.unit} — ${first.reason}`
                : `No patchable change in ${file}`, true);
            return;
        }

        this.docs.set(file, result.source);
        this.autoPatches.set(file, result.source);
        this.renderFileList();
        if (this.activeFile === file) this.openSelection();

        const count = result.converted.length;
        const notes = [];
        if (result.skipped.length > 0) notes.push(`${result.skipped.length} left for you`);
        if (result.warnings.length > 0) notes.push(`${result.warnings.length} warning(s)`);
        const extra = notes.length > 0 ? ` (${notes.join(", ")})` : "";
        this.setStatus(`Patch updated for ${file}: ${count} change${count === 1 ? "" : "s"}${extra}`);
    }

    async patchSelectedFile() {
        const file = this.activeFile || this.previewFile;
        if (!file) {
            this.setStatus("Select a game file first", true);
            return;
        }

        if (!this.docs.has(file)) {
            const generated = this.editedSources.has(file)
                ? SourcePatch.generatePatch(file, this.originalSources.get(file) ?? "", this.editedSources.get(file)).source
                : "";
            this.docs.set(file, generated || await this.buildPatchTemplate(file));
        }
        this.activeFile = file;
        this.previewFile = null;
        this.renderFileList();
        this.openSelection();
        this.setStatus(`Added a patch for ${file}`);
    }

    removeActivePatch() {
        if (this.activeFile === null) {
            this.setStatus("Open a patch script first", true);
            return;
        }

        const file = this.activeFile;
        this.docs.delete(file);
        this.autoPatches.delete(file);
        this.manualPatches.delete(file);
        this.activeFile = null;
        this.previewFile = file;
        this.renderFileList();
        this.openSelection();
        this.setStatus(`Removed the patch for ${file}`);
    }

    async buildPatchTemplate(file) {
        let exported = [];
        try {
            const module = await ModulePatcher.loadModule(file);
            exported = Object.keys(module);
        } catch (err) {
            exported = [];
        }

        return [
            `// Patch for ${file}`,
            "// Runs with `exports` bound to this file's live module namespace.",
            "// Return a cleanup function so disabling the mod restores stock behaviour.",
            "//",
            `// exports: ${exported.length > 0 ? exported.join(", ") : "(none found)"}`,
            "",
            "// const Base = exports.default;",
            "// const original = Base.prototype.someMethod;",
            "// Base.prototype.someMethod = function (...args) { return original.apply(this, args); };",
            "",
            "return () => {};",
            ""
        ].join("\n");
    }

    // --- .jph ----------------------------------------------------------------

    collectPatchDocs() {
        const patches = [];
        for (const [file, source] of this.docs) {
            patches.push({ file, source });
        }
        return patches;
    }

    buildJph() {
        return JphFormat.serialize({
            id: this.fieldId.value,
            name: this.fieldName.value,
            author: this.fieldAuthor.value,
            description: this.fieldDescription.value,
            patches: this.collectPatchDocs()
        });
    }

    validate() {
        try {
            const jph = JphFormat.parse(this.buildJph());
            for (const patch of jph.patches) {
                new Function("exports", "api", "\"use strict\";\n" + patch.source);
            }
            this.setStatus(`Valid: ${jph.patches.length} patch(es), id '${jph.id}'`);
            return true;
        } catch (err) {
            this.setStatus(err.message, true);
            return false;
        }
    }

    exportJph() {
        if (this.docs.size === 0) {
            this.setStatus("Add at least one patch before exporting", true);
            return;
        }
        if (!this.validate()) return;

        const jph = JphFormat.parse(this.buildJph());
        downloadText(`${jph.id}.jph`, JphFormat.serialize(jph));
        this.setStatus(`Exported ${jph.id}.jph (${jph.patches.length} patch(es))`);
    }

    importJph() {
        const picker = document.createElement("input");
        picker.type = "file";
        picker.accept = ".jph,application/json";
        picker.onchange = async () => {
            const file = picker.files && picker.files[0];
            if (!file) return;
            try {
                const jph = JphFormat.parse(await file.text());
                this.docs = new Map(jph.patches.map((patch) => [patch.file, patch.source]));
                this.fieldId.value = jph.id;
                this.fieldName.value = jph.name;
                this.fieldAuthor.value = jph.author;
                this.fieldDescription.value = jph.description;
                this.activeFile = null;
                this.previewFile = null;
                this.renderFileList();
                this.openSelection();
                this.setStatus(`Imported ${jph.id}.jph (${jph.patches.length} patch(es))`);
            } catch (err) {
                this.setStatus(`Import failed: ${err.message}`, true);
            }
        };
        picker.click();
    }
}
