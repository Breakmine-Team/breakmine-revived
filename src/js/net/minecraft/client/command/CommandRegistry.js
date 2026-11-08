

const commands = new Map();

function normalizeName(name) {
    if (typeof name !== 'string') return null;
    const cleaned = name.trim().toLowerCase().replace(/^\/+/, '');
    return /^[a-z0-9_:-]+$/.test(cleaned) ? cleaned : null;
}

export const CommandRegistry = {
    
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