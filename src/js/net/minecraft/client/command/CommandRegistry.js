/**
 * Shared registry for mod-defined commands.
 *
 * The built-in commands live as Command instances inside CommandHandler, but
 * mods register theirs here so that every CommandHandler in the process sees
 * them: the singleplayer client, the integrated server client, and the
 * standalone server (which builds its own CommandHandler in
 * src/js/net/minecraft/server/commands.js) all share one registry.
 *
 * A registered command is a plain object:
 *   { command, usage, description, opOnly, execute(minecraft, args) }
 * `execute` follows the built-in Command contract: it is handed the same
 * `minecraft` object the caller is using (the real client on the client, a
 * per-player adapter on the server) and the argument array, and returns false
 * to make the handler echo the usage line back to the caller.
 */

const commands = new Map();

function normalizeName(name) {
    if (typeof name !== 'string') return null;
    const cleaned = name.trim().toLowerCase().replace(/^\/+/, '');
    return /^[a-z0-9_:-]+$/.test(cleaned) ? cleaned : null;
}

export const CommandRegistry = {
    /**
     * @param {{command?: string, name?: string, usage?: string, description?: string,
     *          opOnly?: boolean, modId?: string, execute: Function}} descriptor
     */
    register(descriptor) {
        if (!descriptor || typeof descriptor !== 'object') {
            throw new Error('registerCommand() needs a command object.');
        }
        const name = normalizeName(descriptor.command || descriptor.name);
        if (!name) {
            throw new Error(`Invalid command name '${descriptor.command || descriptor.name}'. Use letters, numbers, '_', '-' or ':'.`);
        }
        if (typeof descriptor.execute !== 'function') {
            throw new Error(`Command '/${name}' needs an execute(minecraft, args) function.`);
        }

        const entry = {
            command: name,
            usage: descriptor.usage || '',
            description: descriptor.description || descriptor.usage || '',
            modId: descriptor.modId || null,
            opOnly: !!descriptor.opOnly,
            execute: descriptor.execute
        };

        commands.set(name, entry);
        return entry;
    },

    unregister(name) {
        const key = normalizeName(name);
        if (!key) return false;
        return commands.delete(key);
    },

    /** Drop every command a mod registered (used when it is disabled/uninstalled). */
    unregisterMod(modId) {
        let removed = 0;
        for (const [name, entry] of commands) {
            if (entry.modId === modId) {
                commands.delete(name);
                removed++;
            }
        }
        return removed;
    },

    get(name) {
        const key = normalizeName(name);
        return key ? (commands.get(key) || null) : null;
    },

    has(name) {
        return this.get(name) !== null;
    },

    getAll() {
        return [...commands.values()];
    },

    isOpOnly(name) {
        const entry = this.get(name);
        return !!entry && entry.opOnly;
    },

    get size() {
        return commands.size;
    },

    clear() {
        commands.clear();
    }
};

export default CommandRegistry;