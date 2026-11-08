

export const BLOCK_ACTIONS = Object.freeze({
    PLACE: 'place',
    BREAK: 'break',
    INTERACT: 'interact'
});

const ACTION_ALIASES = {
    destroy: BLOCK_ACTIONS.BREAK,
    use: BLOCK_ACTIONS.INTERACT
};

const VALID_ACTIONS = new Set(Object.values(BLOCK_ACTIONS));

export function normalizeBlockAction(action) {
    if (typeof action !== 'string') return null;
    const normalized = action.trim().toLowerCase();
    return ACTION_ALIASES[normalized] || normalized;
}

export function createBlockActionEvent(action, data = {}) {
    const event = {
        ...data,
        action: normalizeBlockAction(action)
    };

    event.canceled = false;
    event.cancel = () => {
        event.canceled = true;
    };

    if (event.username !== undefined && event.player === undefined) {
        event.player = event.username;
    }
    if (event.pos === undefined && typeof event.x === 'number') {
        event.pos = { x: event.x, y: event.y, z: event.z };
    }

    return event;
}

export default class BlockActionRegistry {

    constructor(label = 'Mods') {
        this.label = label;
        this.handlers = new Map();
    }

    register(action, fn, options = {}) {
        const normalized = normalizeBlockAction(action);
        if (!normalized || !VALID_ACTIONS.has(normalized)) {
            throw new Error(`Unknown block action '${action}' (expected place, break or interact).`);
        }
        if (typeof fn !== 'function') {
            throw new Error(`Block action '${normalized}' needs a function.`);
        }

        const entry = {
            action: normalized,
            fn,
            modId: options.modId || null,
            priority: Number(options.priority) || 0
        };

        if (!this.handlers.has(normalized)) {
            this.handlers.set(normalized, []);
        }
        const list = this.handlers.get(normalized);
        list.push(entry);
        list.sort((a, b) => a.priority - b.priority);
        return entry;
    }

    
    unregister(action, handle) {
        const normalized = normalizeBlockAction(action);
        if (!normalized) return false;

        const list = this.handlers.get(normalized);
        if (!list) return false;

        if (typeof handle === 'object' && handle) {
            const index = list.indexOf(handle);
            if (index === -1) return false;
            list.splice(index, 1);
        } else if (typeof handle === 'function') {
            const index = list.findIndex((entry) => entry.fn === handle);
            if (index === -1) return false;
            list.splice(index, 1);
        } else {
            this.handlers.delete(normalized);
            return list.length > 0;
        }

        if (list.length === 0) this.handlers.delete(normalized);
        return true;
    }

    clear(action) {
        if (action === undefined) {
            const count = [...this.handlers.values()].reduce((total, list) => total + list.length, 0);
            this.handlers.clear();
            return count;
        }

        const normalized = normalizeBlockAction(action);
        const list = normalized ? this.handlers.get(normalized) : null;
        if (!list) return 0;
        this.handlers.delete(normalized);
        return list.length;
    }

    clearMod(modId) {
        let removed = 0;
        for (const [action, list] of this.handlers) {
            for (let i = list.length - 1; i >= 0; i--) {
                if (list[i].modId === modId) {
                    list.splice(i, 1);
                    removed++;
                }
            }
            if (list.length === 0) this.handlers.delete(action);
        }
        return removed;
    }

    has(action) {
        const normalized = normalizeBlockAction(action);
        return !!normalized && (this.handlers.get(normalized)?.length || 0) > 0;
    }

    
    emit(action, data = {}) {
        const normalized = normalizeBlockAction(action);
        const event = createBlockActionEvent(normalized, data);
        const list = this.handlers.get(normalized);
        if (!list || list.length === 0) {
            return event;
        }

        for (const entry of [...list]) {
            if (event.canceled) break;

            try {
                const result = entry.fn(event);
                if (result === false) event.cancel();
            } catch (error) {
                console.warn(`[${this.label}] Block action '${normalized}' handler failed:`, error);
            }
        }

        return event;
    }
}
