import en from "./locales/en.js";
import hu from "./locales/hu.js";
import es from "./locales/es.js";

const LOCALES = { en, hu, es };
const FALLBACK_LANGUAGE = "en";

/**
 * Small runtime translation layer.
 *
 * The game was written with English strings directly in the UI code. Instead of
 * rewriting every screen with translation keys, the renderer asks this service
 * to translate the finished string. Unknown strings simply fall back to the
 * original English text, which keeps mods and server-provided text readable.
 */
class I18n {

    constructor() {
        this.language = FALLBACK_LANGUAGE;
        this.translations = {};
        this.patterns = [];
        this.listeners = new Set();
    }

    getLanguages() {
        return Object.values(LOCALES).map(locale => ({
            code: locale.code,
            name: locale.name
        }));
    }

    /** Options for the language list button in the Options screen. */
    getLanguageOptions() {
        return this.getLanguages().map(language => ({
            key: language.code,
            name: language.name
        }));
    }

    setLanguage(code) {
        const normalized = String(code || FALLBACK_LANGUAGE).toLowerCase();
        const locale = LOCALES[normalized] || LOCALES[FALLBACK_LANGUAGE];

        this.language = locale.code;
        this.translations = locale.translations || {};
        this.patterns = locale.patterns || [];

        if (typeof document !== "undefined" && document.documentElement) {
            document.documentElement.setAttribute("lang", this.language);
        }

        for (const listener of this.listeners) {
            try {
                listener(this.language);
            } catch (error) {
                console.warn("[i18n] language listener failed:", error);
            }
        }

        return this.language;
    }

    onChange(listener) {
        if (typeof listener !== "function") return () => {};
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    /**
     * Translate a finished display string. Formatting codes (§a, §7, ...) are
     * preserved, as are leading/trailing whitespace and newlines.
     */
    t(text) {
        if (typeof text !== "string" || text.length === 0) return text;
        if (this.language === FALLBACK_LANGUAGE) return text;
        return this._translate(text);
    }

    _translate(text) {
        if (!text) return text;

        const exact = this.translations[text];
        if (exact !== undefined) return exact;

        if (text.indexOf("\n") !== -1) {
            return text.split("\n").map(line => this._translate(line)).join("\n");
        }

        if (text.indexOf("\u00a7") !== -1) {
            const parts = text.split(/(\u00a7.)/);
            // A lone section sign at the end of the string is not a formatting
            // code; leave the whole string alone rather than recursing forever.
            if (parts.length > 1) {
                return parts.map(part => {
                    if (part.length === 2 && part.charAt(0) === "\u00a7") return part;
                    return this._translate(part);
                }).join("");
            }
        }

        const whitespace = text.match(/^(\s*)([\s\S]*?)(\s*)$/);
        const leading = whitespace[1];
        const core = whitespace[2];
        const trailing = whitespace[3];

        if (!core) return text;

        if (leading || trailing) {
            const translated = this._translate(core);
            if (translated !== core) return leading + translated + trailing;
        }

        for (const [pattern, replacement] of this.patterns) {
            if (!pattern.test(core)) continue;
            const translated = core.replace(pattern, replacement);
            if (translated !== core) {
                return leading + translated + trailing;
            }
        }

        // "Language: English" and every other "label: value" button.
        const separator = core.indexOf(": ");
        if (separator > 0) {
            const label = core.slice(0, separator);
            const value = core.slice(separator + 2);
            const translatedLabel = this._translate(label);
            const translatedValue = this._translate(value);
            if (translatedLabel !== label || translatedValue !== value) {
                return leading + translatedLabel + ": " + translatedValue + trailing;
            }
        }

        return text;
    }
}

export default new I18n();
