import Block from '../client/world/block/Block.js';
import Item from '../client/world/block/Item.js';
import ItemEdible from '../client/world/block/ItemEdible.js';
import ItemTool from '../client/world/block/type/ItemTool.js';
import ItemGeneric from '../client/world/block/type/ItemGeneric.js';
import { BlockRegistry } from '../client/world/block/BlockRegistry.js';
import BoundingBox from '../util/BoundingBox.js';
import EnumBlockFace from '../util/EnumBlockFace.js';
import EnumCreativeInventoryTab from '../client/gui/EnumCreativeInventoryTab.js';
import Sound from '../client/sound/Sound.js';
import Command from '../client/command/Command.js';
import { CommandRegistry } from '../client/command/CommandRegistry.js';
import * as THREE from '../../../../../libraries/three.module.js';
import Logger from './logger.js';
import { readServerMods } from './serverMods.js';
import BlockActionRegistry from '../mod/BlockActionRegistry.js';
import { modDataPath } from '../mod/ModDataKey.js';
import fs from '../client/fs/ServerFs.js';
import { findPlayerByUsername, getPlayers, isOp, isSuperOp } from './players.js';

const log = Logger;

let loadedMods = [];
const blockActions = new BlockActionRegistry('ServerMods');
const modMessageHandlers = new Map(); 

function stripImports(source) {
    return source
        .replace(/import\s+[\s\S]*?from\s+["'][^"']*["']\s*;?/g, '')
        .replace(/import\s+["'][^"']*["']\s*;?/g, '');
}

function parseImports(source) {
    const imports = [];
    const re = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g;
    let match;

    while ((match = re.exec(source)) !== null) {
        const clause = match[1].trim();
        const imp = { specifier: match[2], defaultName: null, namedNames: [], namespace: null };

        const nsMatch = clause.match(/^\*\s+as\s+(\w+)$/);
        if (nsMatch) {
            imp.namespace = nsMatch[1];
            imports.push(imp);
            continue;
        }

        let rest = clause;
        const braceMatch = clause.match(/\{([^}]*)\}/);
        if (braceMatch) {
            for (const name of braceMatch[1].split(',')) {
                const trimmed = name.trim();
                if (trimmed) imp.namedNames.push(trimmed.split(/\s+as\s+/).pop());
            }
            rest = clause.replace(/\{([^}]*)\}/, '').trim();
        }

        rest = rest.replace(/,$/, '').trim();
        if (rest) imp.defaultName = rest;
        imports.push(imp);
    }

    return imports;
}

function resolveImportPath(fromPath, specifier) {
    const base = fromPath.split('/');
    base.pop();

    for (const part of specifier.split('/')) {
        if (part === '.' || part === '') continue;
        if (part === '..') {
            if (base.length === 0) return null;
            base.pop();
        } else {
            base.push(part);
        }
    }

    return base.length === 0 ? null : base.join('/');
}

function transformModuleExports(source) {
    let transformed = stripImports(source);
    let defaultName = null;
    const namedNames = [];

    transformed = transformed.replace(/export\s+default\s+class\s+(\w+)/, (m, name) => {
        defaultName = name;
        return `class ${name}`;
    });
    transformed = transformed.replace(/export\s+default\s+function\s+(\w+)/, (m, name) => {
        defaultName = name;
        return `function ${name}`;
    });
    transformed = transformed.replace(/export\s+default\s+(?!class\s|function\s)([\s\S]+?);/g, (m, expr) => {
        defaultName = '__mod_default';
        return `var __mod_default = ${expr};`;
    });
    transformed = transformed.replace(/export\s+class\s+(\w+)/g, (m, name) => {
        namedNames.push(name);
        return `class ${name}`;
    });
    transformed = transformed.replace(/export\s+function\s+(\w+)/g, (m, name) => {
        namedNames.push(name);
        return `function ${name}`;
    });
    transformed = transformed.replace(/export\s+(const|let|var)\s+(\w+)/g, (m, keyword, name) => {
        namedNames.push(name);
        return `${keyword} ${name}`;
    });

    return { transformed, defaultName, namedNames };
}

function evalModule(source, deps, files, cache, filePath, stack) {
    if (cache.has(filePath)) return cache.get(filePath);
    if (stack.has(filePath)) return null;

    stack.add(filePath);

    const localDeps = { ...deps };
    for (const imp of parseImports(source)) {
        if (!imp.specifier) continue;
        const specifier = imp.specifier.startsWith('.') ? imp.specifier : `./${imp.specifier}`;
        const resolved = resolveImportPath(filePath, specifier);
        if (!resolved || !files.has(resolved)) continue;

        const exportsObj = evalModule(files.get(resolved), deps, files, cache, resolved, stack);
        if (!exportsObj) continue;

        if (imp.namespace) {
            localDeps[imp.namespace] = exportsObj;
        } else {
            if (imp.defaultName) localDeps[imp.defaultName] = exportsObj.__default;
            for (const name of imp.namedNames) {
                if (exportsObj[name] !== undefined) localDeps[name] = exportsObj[name];
            }
        }
    }

    const { transformed, defaultName, namedNames } = transformModuleExports(source);
    const assignments = Object.keys(localDeps)
        .map((name) => `const ${name} = __deps__["${name}"];`)
        .join('\n');
    const namedProps = namedNames.map((name) => `"${name}": ${name}`).join(',');

    const wrapped = `
        return (function(__deps__) {
            "use strict";
            ${assignments}
            ${transformed}
            return {
                __default: ${defaultName ? defaultName : 'null'}${namedProps ? ',' + namedProps : ''}
            };
        })
    `;

    let result = null;
    try {
        result = new Function(wrapped)()(localDeps);
    } catch (err) {
        log.warn('ServerMods', `Failed to evaluate module '${filePath}': ${err.message}`);
    }

    stack.delete(filePath);
    if (result) cache.set(filePath, result);
    return result;
}

function evalClass(source, deps, files, cache, filePath) {
    const localDeps = { ...deps };

    for (const imp of parseImports(source)) {
        if (!imp.specifier) continue;
        const specifier = imp.specifier.startsWith('.') ? imp.specifier : `./${imp.specifier}`;
        const resolved = resolveImportPath(filePath, specifier);
        if (!resolved || !files.has(resolved)) continue;

        const exportsObj = evalModule(files.get(resolved), deps, files, cache, resolved, new Set([filePath]));
        if (!exportsObj) continue;

        if (imp.namespace) {
            localDeps[imp.namespace] = exportsObj;
        } else {
            if (imp.defaultName) localDeps[imp.defaultName] = exportsObj.__default;
            for (const name of imp.namedNames) {
                if (exportsObj[name] !== undefined) localDeps[name] = exportsObj[name];
            }
        }
    }

    const nameMatch = source.match(/export\s+default\s+class\s+(\w+)/);
    if (!nameMatch) return null;
    const className = nameMatch[1];

    const assignments = Object.keys(localDeps)
        .map((name) => `const ${name} = __deps__["${name}"];`)
        .join('\n');

    const transformed = stripImports(source).replace(
        /export\s+default\s+class\s+(\w+)/,
        'class $1'
    );

    const wrapped = `
        return (function(__deps__) {
            "use strict";
            ${assignments}
            ${transformed}
            return ${className};
        })
    `;

    try {
        return new Function(wrapped)()(localDeps);
    } catch (err) {
        log.warn('ServerMods', `Failed to evaluate class '${filePath}': ${err.message}`);
        return null;
    }
}

function classToBlockId(className) {
    let name = className;
    if (name.startsWith('Block')) name = name.substring(5);
    return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function classToItemId(className) {
    let name = className;
    if (name.startsWith('Item')) name = name.substring(4);
    return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

async function saveModJson(modId, key, value) {
    const path = modDataPath(modId, key);
    try {
        fs.mkdirSync(`mod_data/${modId}`, { recursive: true });
    } catch (error) {
    }
    await fs.writeFile(path, JSON.stringify(value, null, 2));
    return value;
}

async function loadModJson(modId, key, fallback = null) {
    const path = modDataPath(modId, key);
    try {
        const raw = await fs.readFile(path, 'utf-8');
        return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
        return fallback;
    }
}

async function deleteModJson(modId, key) {
    const path = modDataPath(modId, key);
    if (!(await fs.exists(path))) return false;
    await fs.unlink(path);
    return true;
}

async function listModJson(modId) {
    try {
        const entries = await fs.readdir(`mod_data/${modId}`);
        return entries
            .filter((name) => name.endsWith('.json'))
            .map((name) => name.slice(0, -5))
            .filter((key) => /^[A-Za-z0-9._-]{1,64}$/.test(key));
    } catch (error) {
        return [];
    }
}

function sendModMessageToPlayer(player, modId, payload) {
    if (!player?.ws || player.ws.readyState !== 1) return false;
    player.ws.send(JSON.stringify({ type: 'modMessage', modId, payload }));
    return true;
}

function createModApi(modId) {
    return {
        modId,
        isServer: true,
        get minecraft() { return undefined; },
        get world() { return undefined; },
        isOp: (username) => !!isOp({username: String(username ?? '')}),
        isSuperOp: (username) => !!isSuperOp({username: String(username ?? '')}),
        registerCommand: (name, usage, description, execute, options = {}) => {
            const descriptor = typeof name === 'object' && name !== null
                ? { ...name }
                : { command: name, usage, description, execute, ...options };
            return CommandRegistry.register({ ...descriptor, modId });
        },
        unregisterCommand: (name) => CommandRegistry.unregister(name),
        getCommand: (name) => CommandRegistry.get(name),
        registerRenderHook: () => null,
        unregisterRenderHook: () => {},
        registerBlockAction: (action, fn, options = {}) =>
            blockActions.register(action, fn, { ...options, modId }),
        onBlockAction: (action, fn, options = {}) =>
            blockActions.register(action, fn, { ...options, modId }),
        unregisterBlockAction: (action, handle) => blockActions.unregister(action, handle),
        saveJson: (key, value) => saveModJson(modId, key, value),
        loadJson: (key, fallback = null) => loadModJson(modId, key, fallback),
        deleteJson: (key) => deleteModJson(modId, key),
        listJson: () => listModJson(modId),
        onMessage: (fn) => {
            if (typeof fn !== 'function') {
                throw new Error('onMessage() needs a function.');
            }
            if (!modMessageHandlers.has(modId)) modMessageHandlers.set(modId, new Set());
            modMessageHandlers.get(modId).add(fn);
            return fn;
        },
        sendToPlayer: (username, payload) => {
            const player = findPlayerByUsername(username);
            return player ? sendModMessageToPlayer(player, modId, payload) : false;
        },
        broadcast: (payload) => {
            let sent = 0;
            for (const player of getPlayers().values()) {
                if (sendModMessageToPlayer(player, modId, payload)) sent++;
            }
            return sent;
        },
        registerService: () => null,
        getService: () => null,
        resolveTexture: () => null,
        log: (...args) => console.log(`[ServerMods] [${modId}]`, ...args),
        warn: (...args) => console.warn(`[ServerMods] [${modId}]`, ...args)
    };
}

export function handleModMessage(player, modId, payload) {
    const handlers = modMessageHandlers.get(modId);
    if (!handlers || handlers.size === 0) return;

    const event = {
        modId,
        username: player.username,
        player: player.username,
        payload,
        data: payload,
        rawPlayer: player,
        send: (message) => sendModMessageToPlayer(player, modId, message)
    };

    for (const handler of [...handlers]) {
        try {
            handler(event);
        } catch (error) {
            log.warn('ServerMods', `Message handler for '${modId}' failed: ${error.message}`);
        }
    }
}

function loadMod(mod) {
    const files = new Map();
    for (const file of mod.files) {
        if (!file.binary) files.set(file.path, file.data);
    }

    const modApi = createModApi(mod.id);
    const blockDeps = {
        Block,
        BlockRegistry,
        BoundingBox,
        EnumBlockFace,
        EnumCreativeInventoryTab,
        THREE,
        Sound,
        AuthLib: {},
        ModAPI: modApi
    };
    const itemDeps = {
        ...blockDeps,
        Item,
        ItemEdible,
        ItemTool,
        ItemGeneric
    };
    const commandDeps = {
        ...blockDeps,
        Command
    };

    const blockIds = [];
    const itemIds = [];
    const commandNames = [];

    for (const filePath of [...files.keys()].sort()) {
        const isBlock = filePath.startsWith('blocks/') && filePath.endsWith('.js');
        const isItem = filePath.startsWith('items/') && filePath.endsWith('.js');
        const isCommand = filePath.startsWith('commands/') && filePath.endsWith('.js');
        if (!isBlock && !isItem && !isCommand) continue;

        const source = files.get(filePath);
        const deps = isBlock ? blockDeps : (isItem ? itemDeps : commandDeps);
        const cache = new Map();
        const contentClass = evalClass(source, deps, files, cache, filePath);
        if (!contentClass) continue;

        if (isCommand) {
            try {
                const instance = new contentClass();
                const registered = CommandRegistry.register({
                    command: instance.command,
                    usage: instance.usage,
                    description: instance.description,
                    opOnly: !!instance.opOnly,
                    execute: (minecraft, args) => instance.execute(minecraft, args),
                    modId: mod.id
                });
                commandNames.push(registered.command);
            } catch (err) {
                log.warn('ServerMods', `Could not register command from '${filePath}': ${err.message}`);
            }
            continue;
        }

        const className = contentClass.name || filePath.split('/').pop().replace('.js', '');
        const localId = isBlock ? classToBlockId(className) : classToItemId(className);
        const namespacedId = `${mod.id}:${localId}`;

        if (BlockRegistry.get(namespacedId)) {
            log.warn('ServerMods', `Skipping duplicate content id '${namespacedId}' from mod '${mod.id}'.`);
            continue;
        }

        try {
            const registered = BlockRegistry.registerBlockClass(namespacedId, localId, contentClass);
            if (registered) {
                registered.mod = mod.name;
                registered.serverMod = true;
                (isBlock ? blockIds : itemIds).push(namespacedId);
            }
        } catch (err) {
            log.warn('ServerMods', `Could not register '${namespacedId}': ${err.message}`);
        }
    }

    const modLoadSource = files.get('ModLoad.js');
    if (modLoadSource) {
        try {
            const modLoadDeps = {
                ...blockDeps,
                ...itemDeps,
                Command
            };
            const exportsObj = evalModule(
                modLoadSource,
                modLoadDeps,
                files,
                new Map(),
                'ModLoad.js',
                new Set()
            );
            const ModLoad = exportsObj?.__default;
            if (ModLoad && typeof ModLoad.onLoad === 'function') {
                ModLoad.onLoad(undefined, undefined, modApi);
            }
        } catch (err) {
            log.warn('ServerMods', `ModLoad.onLoad failed for '${mod.id}': ${err.message}`);
        }
    }

    loadedMods.push({ id: mod.id, blockIds, itemIds, commandNames });
    if (blockIds.length || itemIds.length || commandNames.length) {
        log.info('ServerMods', `Registered ${blockIds.length} block(s), ${itemIds.length} item(s) and ${commandNames.length} command(s) from '${mod.name}'.`);
    }
}

export function emitBlockAction(action, data) {
    return blockActions.emit(action, data);
}

export function hasBlockAction(action) {
    return blockActions.has(action);
}

export function loadServerSideMods() {
    unloadServerSideMods();
    for (const mod of readServerMods()) {
        try {
            loadMod(mod);
        } catch (err) {
            blockActions.clearMod(mod.id);
            modMessageHandlers.delete(mod.id);
            log.warn('ServerMods', `Failed to load server mod '${mod.id}': ${err.message}`);
        }
    }
    return loadedMods.map((mod) => mod.id);
}

export function unloadServerSideMods() {
    for (const mod of loadedMods) {
        for (const id of mod.blockIds) BlockRegistry.unregister(id);
        for (const id of mod.itemIds) BlockRegistry.unregister(id);
        CommandRegistry.unregisterMod(mod.id);
        blockActions.clearMod(mod.id);
        modMessageHandlers.delete(mod.id);
    }
    loadedMods = [];
}

export function reloadServerSideMods() {
    return loadServerSideMods();
}
