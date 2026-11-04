export default class MixinEngine {
    constructor() {
        this.registry = new Map();
        this.functions = new Map();            // Stores standalone global functions
        this.listeners = new Map();
        this.guaranteedListeners = new Map();
        this.observers = new Map();
        this.lockedFunctions = new WeakMap();
        this.lockedGlobalFunctions = new Set(); // Track locked global functions
    }

    register(key, target) {
        if (!key.includes(':')) {
            console.warn(`Key '${key}' should follow 'namespace:name' format.`);
        }
        this.registry.set(key, target);
        return target;
    }

    get(key) {
        return this.registry.get(key);
    }

    /**
     * Registers a standalone global function under a namespaced key.
     * Example: Mixin.registerFunction('game:getSpawnPoint', (biome) => ({ x: 0, y: 64, z: 0 }));
     */
    registerFunction(key, fn) {
        if (!key.includes(':')) {
            console.warn(`Function key '${key}' should follow 'namespace:name' format.`);
        }
        if (typeof fn !== 'function') {
            console.error(`registerFunction expected a function, got ${typeof fn}.`);
            return;
        }

        this.functions.set(key, fn);
        return (...args) => this.callFunction(key, ...args);
    }

    /**
     * Invokes a registered standalone global function (executing all applied mixin hooks).
     * Example: Mixin.callFunction('game:getSpawnPoint', 'desert');
     */
    callFunction(key, ...args) {
        const fn = this.functions.get(key);
        if (!fn) {
            console.error(`Global function '${key}' is not registered.`);
            return;
        }
        return fn(...args);
    }

    lockFunction(target, methodName) {
        // If target is a string matching a registered global function
        if (typeof target === 'string' && this.functions.has(target)) {
            this.lockedGlobalFunctions.add(target);
            return;
        }

        // Object instance method locking
        if (!target || typeof target[methodName] !== 'function') return;
        if (!this.lockedFunctions.has(target)) {
            this.lockedFunctions.set(target, new Set());
        }
        this.lockedFunctions.get(target).add(methodName);
    }

    /**
     * Applies hooks to either a target dictionary or a registered global function.
     * Works with: Mixin.apply('game:getSpawnPoint', { around(...) { ... } });
     */
    apply(targetKey, mixinDef) {
        // Case A: Patching a standalone global function registered via registerFunction
        if (typeof targetKey === 'string' && this.functions.has(targetKey)) {
            if (this.lockedGlobalFunctions.has(targetKey)) {
                console.warn(`Cannot apply mixin to locked global function '${targetKey}'.`);
                return null;
            }

            const originalFn = this.functions.get(targetKey);
            const hooks = mixinDef.around || mixinDef.before || mixinDef.after ? mixinDef : (mixinDef.methods?.fn || mixinDef);

            const wrappedFn = function (...args) {
                if (hooks.before) hooks.before(args);

                let result;
                if (hooks.around) {
                    result = hooks.around(originalFn, ...args);
                } else {
                    result = originalFn(...args);
                }

                if (hooks.after) hooks.after(result, args);

                return result;
            };

            this.functions.set(targetKey, wrappedFn);
            return wrappedFn;
        }

        // Case B: Patching a target object or dictionary
        const target = typeof targetKey === 'string' ? this.registry.get(targetKey) : targetKey;

        if (!target || typeof target !== 'object') {
            console.error(`Target '${targetKey}' not found or invalid.`);
            return null;
        }

        if (mixinDef.properties) {
            Object.assign(target, mixinDef.properties);
        }

        if (mixinDef.methods) {
            const lockedSet = this.lockedFunctions.get(target);

            for (const [key, hooks] of Object.entries(mixinDef.methods)) {
                if (lockedSet && lockedSet.has(key)) {
                    console.warn(`Cannot apply mixin to locked method '${key}'.`);
                    continue;
                }

                const originalFn = target[key];

                if (typeof originalFn !== 'function') {
                    if (typeof hooks === 'function') {
                        target[key] = hooks;
                    } else if (hooks.around) {
                        target[key] = function (...args) {
                            return hooks.around.call(this, () => {}, ...args);
                        };
                    }
                    continue;
                }

                if (typeof hooks === 'function') {
                    target[key] = hooks;
                    continue;
                }

                target[key] = function (...args) {
                    if (hooks.before) hooks.before.call(this, args);

                    let result;
                    if (hooks.around) {
                        result = hooks.around.call(this, originalFn.bind(this), ...args);
                    } else {
                        result = originalFn.apply(this, args);
                    }

                    if (hooks.after) hooks.after.call(this, result, args);

                    return result;
                };
            }
        }

        return target;
    }

    on(eventKey, handler, priority = 0) {
        this._addListener(this.listeners, eventKey, handler, priority);
    }

    onGuaranteed(eventKey, handler, priority = 0) {
        this._addListener(this.guaranteedListeners, eventKey, handler, priority);
    }

    emit(eventKey, payload) {
        this.emitCancellable(eventKey, payload);
    }

    emitCancellable(eventKey, payload) {
        let isCancelled = false;

        const handlers = this.listeners.get(eventKey);
        if (handlers) {
            for (const { handler } of handlers) {
                const result = handler(payload);
                if (result === false || payload?.cancelled) {
                    isCancelled = true;
                    if (payload) payload.cancelled = true;
                    break;
                }
            }
        }

        const guaranteed = this.guaranteedListeners.get(eventKey);
        if (guaranteed) {
            for (const { handler } of guaranteed) {
                try {
                    handler(payload, isCancelled);
                } catch (err) {
                    console.error(`Error in guaranteed listener for '${eventKey}':`, err);
                }
            }
        }

        this._notifyObservers(eventKey, payload);
        return !isCancelled;
    }

    _addListener(map, key, handler, priority) {
        if (!map.has(key)) {
            map.set(key, []);
        }
        const list = map.get(key);
        list.push({ handler, priority });
        list.sort((a, b) => b.priority - a.priority);
    }

    observe(eventKey, callback) {
        if (!this.observers.has(eventKey)) {
            this.observers.set(eventKey, []);
        }
        this.observers.get(eventKey).push(callback);
    }

    _notifyObservers(eventKey, payload) {
        const list = this.observers.get(eventKey);
        if (!list || list.length === 0) return;

        const readOnlyPayload = typeof payload === 'object' && payload !== null
            ? Object.freeze({ ...payload })
            : payload;

        for (const callback of list) {
            try {
                callback(readOnlyPayload);
            } catch (err) {
                console.error(`Error in observer for '${eventKey}':`, err);
            }
        }
    }
}

// Global instance
globalThis.Mixin = new MixinEngine();