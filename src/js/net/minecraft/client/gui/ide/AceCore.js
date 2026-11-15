// Ace ships as classic scripts that talk to a global `ace`: ace.js defines the
// editor, and the mode/theme files register themselves on it when they run.
// Bundlers turn ace.js into a module, which takes the CommonJS branch of its UMD
// wrapper and therefore never sets window.ace itself. This module publishes it
// again, and it must stay a separate module from AceEditor.js: ES module imports
// are evaluated before the importing module's own body, so the assignment has to
// live in a module that the mode and theme depend on.
import ace from "ace-builds/src-min-noconflict/ace.js";

const globalAce = globalThis.ace && typeof globalThis.ace.edit === "function"
    ? globalThis.ace
    : ace;

if (!globalAce || typeof globalAce.edit !== "function") {
    throw new Error("Ace did not load");
}

globalThis.ace = globalAce;

export default globalAce;
