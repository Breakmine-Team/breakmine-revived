// Self-contained Ace bundle: the core, the JavaScript mode and the monokai theme
// are static imports here, so the evaluation order is fixed no matter how the
// build treats dynamic imports. In particular the single-file build flattens
// dynamic imports, and a lazy `import()` of the mode would otherwise be able to
// run before `globalThis.ace` exists.
import ace from "./AceCore.js";
import "ace-builds/src-min-noconflict/mode-javascript.js";
import "ace-builds/src-min-noconflict/theme-monokai.js";

// No workers: a single-file page is opened from file://, where a module worker
// cannot be constructed the way Ace's worker setup expects, and the IDE does not
// need live linting to write patch scripts. `useWorker` is an editor setting, not
// a config key - ace.config.set/get throw on keys they do not know - so only the
// real config key is set here, and the editor disables the worker itself.
if (ace.config && typeof ace.config.set === "function") {
    try {
        ace.config.set("loadWorkerFromBlob", false);
    } catch (err) {
        console.warn("[IDE] Could not disable Ace worker loading:", err.message);
    }
}

export default ace;
