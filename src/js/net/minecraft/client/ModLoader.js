import CraftingRegistry from "./crafting/CraftingRegistry.js";
import SmeltingRegistry from "./smelting/SmeltingRegistry.js";
import FileSystem from "./fs/Filesystem.js";
import BridgeFilesystem from "./fs/BridgeFilesystem.js";
import EnumCreativeInventoryTab from "./gui/EnumCreativeInventoryTab.js";
import { BlockRegistry } from "./world/block/BlockRegistry.js";
import Sound from "./sound/Sound.js";
import { loadJSZip } from "./JSZipLoader.js";
import * as THREE from "../../../../../libraries/three.module.js";
import ModelRenderer from "./render/model/renderer/ModelRenderer.js";
import Tessellator from "./render/Tessellator.js";
import * as AuthLib from "./network/AuthLib.js";
import CommandRegistry from "./command/CommandRegistry.js";
import BlockActionRegistry, { normalizeBlockAction } from "../mod/BlockActionRegistry.js";
import { modDataPath } from "../mod/ModDataKey.js";
import FontRenderer from "./render/gui/FontRenderer.js";

const ENABLED_MODS_KEY = 'breakmine_enabled_mods';
const DISABLED_MODS_KEY = 'breakmine_disabled_mods';
const BINARY_MOD_EXTENSIONS = new Set([
    'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp',
    'ogg', 'wav', 'mp3'
]);

function isBinaryModFile(path) {
    const dot = path.lastIndexOf('.');
    return dot !== -1 && BINARY_MOD_EXTENSIONS.has(path.slice(dot + 1).toLowerCase());
}

function normalizeOverlayTextColor(value) {
    if (typeof value === 'number' && Number.isFinite(value)) {
        return value & 0xFFFFFF;
    }
    if (typeof value === 'string') {
        let hex = value.trim().replace(/^#/, '');
        if (/^[0-9a-f]{3}$/i.test(hex)) {
            hex = hex.split('').map((char) => char + char).join('');
        }
        if (/^[0-9a-f]{6}$/i.test(hex)) return parseInt(hex, 16);
        if (/^[0-9a-f]{8}$/i.test(hex)) return parseInt(hex.slice(0, 6), 16);
    }
    return 0xFFFFFF;
}

function normalizeOverlayCanvasColor(value) {
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' && Number.isFinite(value)) {
        const red = (value >> 16) & 0xFF;
        const green = (value >> 8) & 0xFF;
        const blue = value & 0xFF;
        // Plain 0xRRGGBB is opaque; only values with bits above 24 carry alpha.
        const alpha = value > 0xFFFFFF ? ((value >>> 24) & 0xFF) / 255 : 1;
        return alpha < 1
            ? `rgba(${red}, ${green}, ${blue}, ${alpha})`
            : `rgb(${red}, ${green}, ${blue})`;
    }
    return '#000000';
}

/**
 * ModLoader - discovers, installs, and registers mods.
 *
 * Supported mod layout (inside a ZIP or folder):
 *   ModData.js           - metadata (static NAME, ID, AUTHOR, VERSION)
 *   ModLoad.js           - lifecycle hook (static onLoad(world))
 *   blocks/*.js          - block classes (extend Block)
 *   items/*.js           - item classes (extend Item / ItemGeneric / ItemEdible / ItemTool)
 *   crafting/*.js        - crafting recipe classes
 *   smelting/*.js        - smelting recipe classes
 *   gui/*.js             - GUI screen classes (extend GuiScreen / GuiContainer)
 *   commands/*.js        - chat commands (extend Command); registered for
 *                           client and server use, op-only with `this.opOnly = true`
 *   tabs/*.js            - custom creative inventory tab classes (with static
 *                           NAME and ICON_BLOCK_ID properties)
 *   gui_textures/*.png   - GUI background textures (accessible via 'gui/&lt;modId&gt;/&lt;name&gt;')
 *   textures/*.png       - 16×16 block/item textures
 *   sounds/*.ogg         - custom sounds (playable via Sound.play('&lt;modId&gt;:&lt;name&gt;.ogg', volume))
 *
 * Modding API exposed to block/item/GUI/command code:
 *   Block, BlockRegistry, BoundingBox, EnumBlockFace, EnumCreativeInventoryTab,
 *   Command, THREE, Sound, AuthLib, ModAPI
 *
 * ModAPI is the mod-facing facade (also the third argument of ModLoad.onLoad
 * as the loader itself):
 *   ModAPI.registerCommand(name, usage, description, execute, { opOnly })
 *   ModAPI.registerRenderHook(hook, fn, { priority })   // 'beforeRender',
 *       'renderChunks', 'renderSky', 'renderBlockHitBox', 'afterRender', 'onTick'
 *   ModAPI.registerBlockAction(action, fn, { priority })
 *       action: 'place' | 'break' | 'interact' ('destroy' and 'use' are aliases)
 *       The handler gets { action, username, player, x, y, z, pos, currentBlock,
 *       currentBlockId, targetBlock, targetBlockId, clickedBlock,
 *       clickedBlockId, clickedPos, placePos, face, metadata, world, minecraft }.
 *       Call event.cancel() or return false to veto the action. The same hooks
 *       are registered by server-side mods, so a server-sent mod can veto the
 *       authoritative action too.
 *   ModAPI.registerOverlayText(fn, { priority })  // fn(textContext)
 *       text(value, x, y, { color, shadow, align, background, padding,
 *       scale, noColor }) draws HUD text anywhere on screen. Newlines work.
 *   ModAPI.registerKeybind(id, name, defaultKey, onPress, { category, onRelease, allowRepeat })
 *       or registerKeybind({ id, name, defaultKey, onPress, ... }). The bind
 *       appears in Options > Controls and is saved with the game settings.
 *       onPress({ key, keybind, minecraft }) runs while in game; onRelease
 *       runs on key-up. Use null for an unbound default. Key ids must be
 *       unique within the mod; allowRepeat defaults to false.
 *   ModAPI.unregisterKeybind(id), ModAPI.getKeybind(id),
 *       ModAPI.getKeybindKey(id), ModAPI.getKeybinds()
 *   ModAPI.saveJson(key, value), ModAPI.loadJson(key, fallback),
 *       ModAPI.deleteJson(key), ModAPI.listJson()
 *       Persistent per-mod JSON under mod_data/<modId>/, never inside the
 *       (possibly read-only) mod folder. *   ModAPI.sendModMessage(payload)  // JSON to the server mod's onMessage()
 *   ModAPI.getLookedAtBlock(reach = 5)
 *       The block under the crosshair as { name, namespace, id, text_id,
 *       description }: name is the first line of its description, id the
 *       numeric block id, text_id the namespaced id ("breakmine:stone").
 *       null when nothing is targeted, undefined when no world is loaded.
 *   ModAPI.registerService(id, service), ModAPI.getService(id),
 *       ModAPI.resolveTexture('modid:name'), ModAPI.log(...), ModAPI.warn(...)
 * Commands, render hooks, block-action hooks, overlay text, keybinds and
 * registered services are dropped when the mod is disabled or uninstalled;
 * its JSON data and block registrations are kept.
 * AuthLib is the account module: getAuthToken(), getUserInfo(username),
 * userExists(username), getSkinUrl(username) and getCapeUrl(username). Mods read
 * it rather than calling fetch, so they inherit the API base URL and the auth
 * token already in the browser.
 * Relative imports that point to other files inside the mod are resolved
 * automatically (e.g. `import Helper from "./Helper.js"` in blocks/BlockFoo.js
 * loads blocks/Helper.js). Imports of game classes (e.g. `../Block.js`) are
 * provided via the sandbox deps. Circular imports are allowed and cached.
 * Block naming convention:
 *   BlockUnbreakableBlock  ->  strip "Block"  ->  UnbreakableBlock  ->  unbreakable_block
 *   Final namespaced ID:  <modId>:unbreakable_block
 *
 * Item naming convention:
 *   ItemTestItem          ->  strip "Item"   ->  TestItem          ->  test_item
 *   Final namespaced ID:  <modId>:test_item
 *
 * GUI classes loaded from gui/ are automatically available in block/item eval
 * sandboxes so blocks can `new GuiMyScreen(...)` in onMouseButton.
 */
export default class ModLoader {
    /**
     * @param {import("./Minecraft.js").default} minecraft
     */
    constructor(minecraft) {
        this.minecraft = minecraft;
        this.mods = new Map();          // modId -> ModEntry
        this.enabledMods = new Set();   // modIds that are active
        this._disabledMods = new Set(); // modIds the user has explicitly switched off
        // Load the deny-list up front so toggleMod()/uninstallMod() are correct
        // regardless of whether loadAllMods() has run yet.
        this._loadDisabledSet();
        this.services = new Map();      // serviceId -> mod-provided runtime service
        this.filesystem = new FileSystem('ModDB', 'mods');
        this._devModFilesystems = new Map(); // modId -> MemoryFilesystem (temporary dev mods, never persisted)
        this._serverModIds = new Set();      // modIds supplied by the current multiplayer server
        this._serverModFilesystems = new Map(); // modId -> MemoryFilesystem (server-supplied mods)
        this._serverModGeneration = 0;       // invalidates an in-flight server mod load
        this._replacedLocalModIds = new Set(); // modIds that had local versions replaced by server versions
        this._temporaryDisabledModIds = new Set(); // mods switched off only for this session (join a no-mods server)
        this._diskFilesystem = null;         // BridgeFilesystem over the physical mods/ folder (Electron only)
        this._blockBaseClass = null;    // cached Block class for eval sandbox
        this._commandBaseClass = null;  // cached Command class for mod command sandboxes
        this._modModuleCache = new Map(); // 'modId/filePath' -> evaluated exports
        this.renderHooks = new Map();    // hook name -> [{ fn, modId, priority, hook }] - world-render hook targets
        this.blockActions = new BlockActionRegistry('Patchwork'); // cancelable place/break/interact hooks
        this.overlayTextHooks = [];      // [{ fn, modId, priority }] - screen-space HUD text providers
        this._modRegistrations = new Map(); // modId -> { commands, hooks, blockActions, overlayText } for cleanup
        this._activeModId = null;       // mod currently being loaded (attributes registrations)
        this._modApis = new Map();      // modId -> ModAPI facade handed to mod sandboxes
        this.customTabs = [];           // Array of custom tabs from mods: { modId, name, iconBlockId }
        this.keybinds = new Map();      // "modId:keybindId" -> registered keybind entry
        this._pressedKeybinds = new Map(); // keybind setting -> key currently held
    }

    /* ------------------------------------------------------------------
     *  Public API
     * ------------------------------------------------------------------ */

    /**
     * Register a runtime service from a mod. Services are intentionally
     * small objects: the core can call generic lifecycle hooks without
     * knowing anything about a particular mod's feature set.
     */
    registerService(serviceId, service, modId = this._activeModId) {
        if (!serviceId || !service) {
            throw new Error('A service id and service instance are required.');
        }

        const id = String(serviceId);
        this.services.set(id, service);

        // Attribute the service to the mod that registered it, so disabling
        // that mod also removes its services (and anything they expose, such
        // as main-menu buttons) instead of leaving them behind until reload.
        if (modId) {
            this._trackRegistration(modId).services.set(id, service);
        }
        return service;
    }

    getService(serviceId) {
        return this.services.get(String(serviceId)) || null;
    }

    getGuiButtons(screenId, screen) {
        const buttons = [];
        for (const service of this.services.values()) {
            if (typeof service.getGuiButtons !== 'function') continue;
            try {
                const result = service.getGuiButtons(screenId, screen);
                if (Array.isArray(result)) buttons.push(...result.filter(Boolean));
            } catch (error) {
                console.warn(`[Patchwork] Mod GUI hook failed for '${screenId}':`, error);
            }
        }
        return buttons;
    }

    handleNetworkMessage(payload, networkManager) {
        for (const service of this.services.values()) {
            if (typeof service.handleNetworkMessage !== 'function') continue;
            try {
                service.handleNetworkMessage(payload, networkManager);
            } catch (error) {
                console.warn('[Patchwork] Mod network hook failed:', error);
            }
        }
    }

    /* ----------------------------- custom tabs ----------------------- */

    /**
     * Register a custom creative tab from a mod.
     * @param {string} modId - The mod ID
     * @param {string} name - The tab display name
     * @param {string} iconBlockId - The block ID to use as the tab icon (e.g., "minecraft:stone" or "modId:block_name")
     * @returns {object} The tab object with { id, name, iconBlockId, modId }
     */
    registerCustomTab(modId, name, iconBlockId) {
        // Mods are re-loaded every time a world is (re)entered, so the same tab
        // arrives again. Reuse the existing one instead of stacking duplicates
        // in the creative screen.
        const existing = this.customTabs.find(tab => tab.modId === modId && tab.name === name);
        if (existing) {
            if (iconBlockId) existing.iconBlockId = iconBlockId;
            return existing;
        }

        // Find the next available ID (starting from 100 to avoid conflicts with built-in tabs)
        const nextId = 100 + this.customTabs.length;
        const tab = { id: nextId, modId, name, iconBlockId };
        this.customTabs.push(tab);
        console.log(`[Patchwork] Registered custom tab '${name}' (ID: ${nextId}) from mod '${modId}' with icon '${iconBlockId}'`);
        return tab;
    }

    /**
     * Get all custom tabs registered by mods.
     * @returns {Array} Array of { id, modId, name, iconBlockId }
     */
    getCustomTabs() {
        return this.customTabs;
    }

    /**
     * Get a custom tab by name.
     * @param {string} name - The tab name
     * @returns {object|null} The tab object or null if not found
     */
    getCustomTabByName(name) {
        return this.customTabs.find(tab => tab.name === name) || null;
    }

    /**
     * Clear all custom tabs (used when a mod is disabled/uninstalled).
     * @param {string} modId - Optional mod ID to clear only tabs from that mod
     */
    clearCustomTabs(modId = null) {
        if (modId) {
            this.customTabs = this.customTabs.filter(tab => tab.modId !== modId);
        } else {
            this.customTabs = [];
        }
    }

    /* ----------------------------- commands --------------------------- */

    /**
     * Register a chat command for a mod.
     *
     * Two call styles are accepted:
     *   registerCommand({ command: "spawn_pet", usage: "<type>", description: "...",
     *                      opOnly: false, execute(minecraft, args) { ... } })
     *   registerCommand("spawn_pet", "<type>", "Spawn a pet", (minecraft, args) => ..., { opOnly: true })
     *
     * `execute` gets the same `minecraft` object the command was typed into
     * (the real client, or a per-player adapter on the server) and returns
     * false to have the usage line echoed back. `opOnly: true` makes the
     * server require operator status, exactly like the built-in mutating
     * commands. A modId that collides with an existing command replaces it.
     *
     * @returns the stored registry entry
     */
    registerCommand(name, usage, description, execute, options = {}) {
        const descriptor = typeof name === 'object' && name !== null
            ? { ...name }
            : { command: name, usage, description, execute, ...options };
        const modId = descriptor.modId || options.modId || this._activeModId || null;

        const entry = CommandRegistry.register({ ...descriptor, modId });
        if (modId) {
            this._trackRegistration(modId).commands.add(entry.command);
        }
        return entry;
    }

    unregisterCommand(name) {
        const entry = CommandRegistry.get(name);
        const removed = CommandRegistry.unregister(name);
        if (entry && entry.modId) {
            this._modRegistrations.get(entry.modId)?.commands.delete(entry.command);
        }
        return removed;
    }

    /** Every command mods registered, in registration order. */
    getModCommands() {
        return CommandRegistry.getAll();
    }

    /* ----------------------------- keybinds --------------------------- */

    /**
     * Register a rebindable keybind for a mod.
     *
     *   registerKeybind("toggle_overlay", "Toggle Overlay", "KeyU", (event) => ...)
     *   registerKeybind({
     *       id: "toggle_overlay",
     *       name: "Toggle Overlay",
     *       defaultKey: "KeyU",
     *       category: "My Mod",
     *       onPress({ key, keybind, minecraft }) { ... },
     *       onRelease({ key, keybind, minecraft }) { ... }
     *   })
     *
     * The binding is stored in GameSettings and appears in Options > Controls
     * below the built-in bindings. `allowRepeat` defaults to false, so holding
     * a key only fires onPress once until it is released.
     */
    registerKeybind(id, name, defaultKey, onPress, options = {}) {
        const descriptor = typeof id === 'object' && id !== null
            ? { ...id }
            : { id, name, defaultKey, onPress, ...options };
        const modId = descriptor.modId || options.modId || this._activeModId || null;
        const keybindId = String(descriptor.id ?? '').trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(keybindId)) {
            throw new Error('A keybind id (1-64 letters, numbers, _ or -) is required.');
        }

        const label = String(descriptor.name || descriptor.label || keybindId).trim();
        const defaultBinding = descriptor.defaultKey !== undefined
            ? descriptor.defaultKey
            : (descriptor.key ?? null);
        if (defaultBinding !== null && typeof defaultBinding !== 'string') {
            throw new Error(`Keybind '${keybindId}' defaultKey must be a string or null.`);
        }

        const press = descriptor.onPress || descriptor.callback || descriptor.execute || null;
        const release = descriptor.onRelease || null;
        if (press !== null && typeof press !== 'function') {
            throw new Error(`Keybind '${keybindId}' onPress must be a function.`);
        }
        if (release !== null && typeof release !== 'function') {
            throw new Error(`Keybind '${keybindId}' onRelease must be a function.`);
        }

        const modName = this.mods.get(modId)?.name || modId || 'Mods';
        const setting = `${modId || 'mod'}:${keybindId}`;
        const entry = {
            id: keybindId,
            setting,
            name: label || keybindId,
            defaultKey: defaultBinding,
            onPress: press,
            onRelease: release,
            allowRepeat: descriptor.allowRepeat === true,
            category: String(descriptor.category || modName),
            modId,
            modName
        };
        Object.defineProperty(entry, 'key', {
            enumerable: true,
            get: () => this.getKeybindKey(entry)
        });

        const previous = this.keybinds.get(setting);
        if (previous) this._removeKeybindEntry(previous);
        this.keybinds.set(setting, entry);
        if (modId) this._trackRegistration(modId).keybinds.add(entry);
        return entry;
    }

    unregisterKeybind(keybindId, modId = this._activeModId) {
        const entry = typeof keybindId === 'object' && keybindId !== null
            ? keybindId
            : this._resolveKeybind(keybindId, modId);
        return entry ? this._removeKeybindEntry(entry) : false;
    }

    getKeybind(keybindId, modId = this._activeModId) {
        return this._resolveKeybind(keybindId, modId);
    }

    /** The currently bound key for a keybind, or null when it is unbound/missing. */
    getKeybindKey(keybindId, modId = this._activeModId) {
        const entry = this._resolveKeybind(keybindId, modId);
        if (!entry) return null;

        const settings = this.minecraft?.settings;
        if (settings && typeof settings.getModKeybind === 'function') {
            return settings.getModKeybind(entry.setting, entry.defaultKey);
        }
        const map = settings?.modKeybinds;
        return map && Object.prototype.hasOwnProperty.call(map, entry.setting)
            ? map[entry.setting]
            : entry.defaultKey;
    }

    /** All registered mod keybinds, with their current key, for the Controls screen. */
    getKeybinds() {
        return [...this.keybinds.values()]
            .map((entry) => ({
                id: entry.id,
                setting: entry.setting,
                name: entry.name,
                category: entry.category,
                modId: entry.modId,
                modName: entry.modName,
                defaultKey: entry.defaultKey,
                key: this.getKeybindKey(entry),
                allowRepeat: entry.allowRepeat
            }))
            .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
    }

    /** Internal: invoke matching mod keybind callbacks on a key-down. */
    handleKeyPressed(key) {
        if (!key) return;

        for (const entry of [...this.keybinds.values()]) {
            if (this.getKeybindKey(entry) !== key) continue;
            if (!entry.allowRepeat && this._pressedKeybinds.has(entry.setting)) continue;

            this._pressedKeybinds.set(entry.setting, key);
            if (!entry.onPress) continue;

            try {
                entry.onPress({ key, keybind: entry, minecraft: this.minecraft });
            } catch (error) {
                console.warn(`[Patchwork] Keybind '${entry.name}' onPress failed:`, error);
            }
        }
    }

    /** Internal: release callbacks and repeat state for a key-up. */
    handleKeyReleased(key) {
        for (const entry of [...this.keybinds.values()]) {
            if (this._pressedKeybinds.get(entry.setting) !== key) continue;

            this._pressedKeybinds.delete(entry.setting);
            if (!entry.onRelease) continue;

            try {
                entry.onRelease({ key, keybind: entry, minecraft: this.minecraft });
            } catch (error) {
                console.warn(`[Patchwork] Keybind '${entry.name}' onRelease failed:`, error);
            }
        }
    }

    /** Release keybind state when keyboard focus is lost, without waiting for key-up. */
    clearKeybindStates() {
        const pressed = [...this._pressedKeybinds.entries()];
        this._pressedKeybinds.clear();

        for (const [setting, key] of pressed) {
            const entry = this.keybinds.get(setting);
            if (!entry?.onRelease) continue;
            try {
                entry.onRelease({ key, keybind: entry, minecraft: this.minecraft });
            } catch (error) {
                console.warn(`[Patchwork] Keybind '${entry.name}' onRelease failed:`, error);
            }
        }
    }

    _resolveKeybind(keybindId, modId = this._activeModId) {
        if (keybindId && typeof keybindId === 'object') {
            return this.keybinds.get(keybindId.setting) === keybindId ? keybindId : null;
        }

        const raw = String(keybindId ?? '');
        if (!raw) return null;

        const direct = this.keybinds.get(raw);
        if (direct) return direct;

        if (modId) {
            const scoped = this.keybinds.get(`${modId}:${raw}`);
            if (scoped) return scoped;
        }

        for (const entry of this.keybinds.values()) {
            if (entry.id === raw) return entry;
        }
        return null;
    }

    _removeKeybindEntry(entry) {
        if (!entry) return false;
        if (this.keybinds.get(entry.setting) === entry) this.keybinds.delete(entry.setting);
        this._pressedKeybinds.delete(entry.setting);
        for (const record of this._modRegistrations.values()) {
            record.keybinds.delete(entry);
        }
        return true;
    }

    /* ---------------------------- render hooks ------------------------ */

    /**
     * Hook a world-render function. WorldRenderer emits these points:
     *   'beforeRender'      - once per frame before the camera is oriented
     *   'renderChunks'      - before the visible chunks are drawn
     *   'renderSky'         - before the sky is drawn
     *   'renderBlockHitBox' - before the block outline is drawn
     *   'afterRender'       - once per frame after everything is drawn
     *   'onTick'            - once per client tick, before renderer updates
     * A handler receives a single context object:
     *   { hook, minecraft, worldRenderer, partialTicks, ...payload }
     * `priority` runs lower numbers first (default 0).
     */
    registerRenderHook(hook, fn, options = {}) {
        if (typeof hook !== 'string' || !hook) {
            throw new Error('A render hook name is required.');
        }
        if (typeof fn !== 'function') {
            throw new Error(`Render hook '${hook}' needs a function.`);
        }
        const modId = options.modId || this._activeModId || null;
        const entry = { fn, modId, priority: options.priority || 0, hook };

        if (!this.renderHooks.has(hook)) this.renderHooks.set(hook, []);
        const list = this.renderHooks.get(hook);
        list.push(entry);
        list.sort((a, b) => a.priority - b.priority);

        if (modId) {
            this._trackRegistration(modId).hooks.add(entry);
        }
        return entry;
    }

    /** Remove one hook (the handle registerRenderHook returned) or all hooks for a name. */
    unregisterRenderHook(hook, handle) {
        if (typeof handle === 'function') {
            for (const entry of [...(this.renderHooks.get(hook) || [])]) {
                if (entry.fn === handle) return this._removeRenderHook(entry);
            }
            return false;
        }
        if (typeof handle === 'object' && handle && handle.fn) {
            return this._removeRenderHook(handle);
        }
        return this.clearRenderHooks(hook) > 0;
    }

    _removeRenderHook(entry) {
        const hooks = this.renderHooks.get(entry.hook);
        if (!hooks) return false;
        const index = hooks.indexOf(entry);
        if (index === -1) return false;
        hooks.splice(index, 1);
        if (hooks.length === 0) this.renderHooks.delete(entry.hook);
        for (const record of this._modRegistrations.values()) {
            record.hooks.delete(entry);
        }
        return true;
    }

    /** Drop every handler for a hook name, or for all names when omitted. */
    clearRenderHooks(hook) {
        if (hook) {
            const hooks = this.renderHooks.get(hook);
            if (!hooks) return 0;
            this.renderHooks.delete(hook);
            return hooks.length;
        }
        let count = 0;
        for (const hooks of this.renderHooks.values()) count += hooks.length;
        this.renderHooks.clear();
        return count;
    }

    hasRenderHooks(hook) {
        if (hook) return (this.renderHooks.get(hook) || []).length > 0;
        for (const hooks of this.renderHooks.values()) {
            if (hooks.length > 0) return true;
        }
        return false;
    }

    /* -------------------------- block actions ------------------------- */

    /**
     * Hook a player block action. `action` is 'place', 'break' (alias
     * 'destroy') or 'interact' (alias 'use'). A handler cancels by calling
     * event.cancel() or returning false; canceled handlers stop the chain.
     */
    registerBlockAction(action, fn, options = {}) {
        const modId = options.modId || this._activeModId || null;
        const entry = this.blockActions.register(action, fn, { ...options, modId });
        if (modId) {
            this._trackRegistration(modId).blockActions.add(entry);
        }
        return entry;
    }

    /** Remove a returned handle, a handler function, or every handler for an action. */
    unregisterBlockAction(action, handle) {
        const removed = this.blockActions.unregister(action, handle);
        if (!removed) return false;

        for (const record of this._modRegistrations.values()) {
            if (typeof handle === 'object' && handle) {
                record.blockActions.delete(handle);
            } else if (typeof handle === 'function') {
                const normalized = normalizeBlockAction(action);
                for (const entry of [...record.blockActions]) {
                    if (entry.action === normalized && entry.fn === handle) {
                        record.blockActions.delete(entry);
                    }
                }
            } else {
                for (const entry of [...record.blockActions]) {
                    if (entry.action === normalizeBlockAction(action)) {
                        record.blockActions.delete(entry);
                    }
                }
            }
        }
        return true;
    }

    hasBlockAction(action) {
        return this.blockActions.has(action);
    }

    /** Internal: fire block-action hooks and return the event. */
    emitBlockAction(action, data) {
        return this.blockActions.emit(action, data);
    }

    /* --------------------------- overlay text ------------------------- */

    /**
     * Register a screen-space HUD text provider. The callback runs every frame
     * while the in-game overlay is visible and receives a drawing context:
     *
     *   { text(value, x, y, options), tooltip(value, x, y, options),
     *     measure(value, options), rect(...), width, height, stack, overlay,
     *     minecraft }
     *
     * `options` for text(): color (number or #rrggbb), shadow, align
     * ('left'|'center'|'right'), background (canvas color), padding, scale and
     * noColor. Newlines are supported. Coordinates are screen pixels, so a mod
     * can draw anywhere on the HUD.
     *
     * tooltip() draws a real GuiTooltip - the same inner bounds, notched dark
     * outline, purple gradient border and 10px line spacing as the in-game
     * item/block tooltips. x/y is the top-left corner of the drawn box and
     * `align` ('left'|'center'|'right') anchors the box on x, so a tooltip
     * centred at the top of the screen is
     * tooltip(lines, ctx.width / 2, 6, { align: 'center' }).
     * § colour codes are interpreted, `color` overrides the text colour, and the
     * box clamps itself to the screen edges.
     */
    registerOverlayText(fn, options = {}) {
        if (typeof fn !== 'function') {
            throw new Error('Overlay text provider must be a function.');
        }

        const modId = options.modId || this._activeModId || null;
        const entry = {
            fn,
            modId,
            priority: Number(options.priority) || 0
        };

        this.overlayTextHooks.push(entry);
        this.overlayTextHooks.sort((a, b) => a.priority - b.priority);
        if (modId) {
            this._trackRegistration(modId).overlayText.add(entry);
        }
        return entry;
    }

    unregisterOverlayText(handle) {
        const index = this.overlayTextHooks.indexOf(handle);
        if (index === -1) return false;
        this.overlayTextHooks.splice(index, 1);
        for (const record of this._modRegistrations.values()) {
            record.overlayText.delete(handle);
        }
        return true;
    }

    /** Called by IngameOverlay after the built-in HUD widgets. */
    emitOverlayText(overlay, stack) {
        if (this.overlayTextHooks.length === 0) return;
        if (!stack || !this.minecraft?.fontRenderer) return;

        const context = this._createOverlayTextContext(overlay, stack);
        for (const entry of [...this.overlayTextHooks]) {
            try {
                entry.fn(context);
            } catch (error) {
                console.warn('[Patchwork] Overlay text provider failed:', error);
            }
        }
    }

    _createOverlayTextContext(overlay, stack) {
        const loader = this;
        const font = this.minecraft.fontRenderer;
        const width = overlay?.window?.width || this.minecraft?.window?.width || 0;
        const height = overlay?.window?.height || this.minecraft?.window?.height || 0;
        const lineStep = FontRenderer.FONT_HEIGHT + 1;

        const measure = (value, options = {}) => {
            const lines = String(value ?? '').split('\n');
            const scale = Math.max(0.1, Number(options.scale) || 1);
            let textWidth = 0;
            for (const line of lines) {
                textWidth = Math.max(textWidth, font.getStringWidth(line));
            }
            return {
                width: textWidth * scale,
                height: (lines.length * lineStep - 1) * scale
            };
        };

        const text = (value, x, y, options = {}) => {
            const lines = String(value ?? '').split('\n');
            const scale = Math.max(0.1, Number(options.scale) || 1);
            const color = normalizeOverlayTextColor(options.color);
            const shadow = options.shadow !== false;
            const noColor = options.noColor !== false;
            const align = options.align === 'center' || options.align === 'right'
                ? options.align : 'left';
            const bounds = measure(value, { scale });
            const baseX = Number(x) || 0;
            const baseY = Number(y) || 0;
            const textHeight = bounds.height;

            if (options.background !== undefined && options.background !== null) {
                const padding = Number(options.padding) || 0;
                let left = baseX;
                if (align === 'center') left -= bounds.width / 2;
                if (align === 'right') left -= bounds.width;

                stack.save();
                stack.globalAlpha = options.backgroundAlpha === undefined
                    ? 1 : Number(options.backgroundAlpha);
                stack.fillStyle = normalizeOverlayCanvasColor(options.background);
                stack.fillRect(
                    Math.floor(left - padding),
                    Math.floor(baseY - padding),
                    Math.ceil(bounds.width + padding * 2),
                    Math.ceil(textHeight + padding * 2)
                );
                stack.restore();
            }

            stack.save();
            stack.translate(Math.round(baseX), Math.round(baseY));
            stack.scale(scale, scale);
            for (let i = 0; i < lines.length; i++) {
                const lineWidth = font.getStringWidth(lines[i]);
                let lineX = 0;
                if (align === 'center') lineX = -lineWidth / 2;
                if (align === 'right') lineX = -lineWidth;
                font.drawString(stack, lines[i], lineX, i * lineStep, color, shadow, noColor);
            }
            stack.restore();

            return {
                x: baseX,
                y: baseY,
                width: bounds.width,
                height: textHeight
            };
        };

        /**
         * Draws a GuiTooltip at any screen position, pixel for pixel the same
         * box the in-game tooltips use. x/y is the top-left of the drawn box;
         * `align` anchors the box on x instead. Returns the box bounds.
         */
        const tooltip = (value, x, y, options = {}) => {
            const lines = String(value ?? '').split('\n');
            const color = normalizeOverlayTextColor(options.color);
            const align = options.align === 'center' || options.align === 'right'
                ? options.align : 'left';

            // GuiTooltip sizes its box on the visible text, ignoring § codes.
            let maxWidth = 0;
            for (const line of lines) {
                maxWidth = Math.max(maxWidth, font.getStringWidth(line.replace(/§./g, '')));
            }

            // Same constants as GuiTooltip.
            const lineSpacing = 10;
            const padding = 2;
            const k = FontRenderer.FONT_HEIGHT + (lines.length - 1) * lineSpacing;

            // The outline reaches 2px outside the inner bounds on every side.
            const boxWidth = maxWidth + padding * 2 + 4;
            const boxHeight = k + padding * 2 + 4;

            let boxLeft = Number(x) || 0;
            if (align === 'center') boxLeft -= boxWidth / 2;
            if (align === 'right') boxLeft -= boxWidth;
            let boxTop = Number(y) || 0;

            // Keep the whole box on screen, like the built-in tooltips.
            boxLeft = Math.max(0, Math.min(Math.floor(boxLeft), Math.max(0, width - boxWidth)));
            boxTop = Math.max(0, Math.min(Math.floor(boxTop), Math.max(0, height - boxHeight)));

            // Text origin, then the inner bounds GuiTooltip draws around it.
            const l1 = boxLeft + padding + 2;
            const i2 = boxTop + padding + 2;
            const x1 = l1 - padding;
            const y1 = i2 - padding;
            const x2 = l1 + maxWidth + padding;
            const y2 = i2 + k + padding;

            const bgColor = 'rgba(16, 0, 16, 0.941)';
            const borderStart = 'rgba(80, 0, 255, 0.50)';
            const borderEnd = 'rgba(40, 0, 127, 0.50)';

            // Gui.drawRect, minus the helper instance.
            const fill = (left, top, right, bottom, style) => {
                stack.save();
                stack.fillStyle = style;
                stack.fillRect(
                    Math.floor(left), Math.floor(top),
                    Math.floor(right - left), Math.floor(bottom - top)
                );
                stack.restore();
            };

            // Gui.drawGradientRect, including its gradient axis.
            const gradient = (left, top, right, bottom, from, to) => {
                const startX = left + (right - left) / 2;
                const grad = stack.createLinearGradient(startX, top, startX, bottom - top);
                grad.addColorStop(0, from);
                grad.addColorStop(1, to);
                fill(left, top, right, bottom, grad);
            };

            // 1. Outer 1px dark frame, with 1px notched corners
            fill(x1 - 1, y1 - 2, x2 + 1, y1 - 1, bgColor);
            fill(x1 - 1, y2 + 1, x2 + 1, y2 + 2, bgColor);
            fill(x1 - 1, y1 - 1, x2 + 1, y2 + 1, bgColor);
            fill(x1 - 2, y1 - 1, x1 - 1, y2 + 1, bgColor);
            fill(x2 + 1, y1 - 1, x2 + 2, y2 + 1, bgColor);

            // 2. Inner gradient border, also with notched corners
            gradient(x1 - 1, y1, x1, y2, borderStart, borderEnd);
            gradient(x2, y1, x2 + 1, y2, borderStart, borderEnd);
            gradient(x1, y1 - 1, x2, y1, borderStart, borderStart);
            gradient(x1, y2, x2, y2 + 1, borderEnd, borderEnd);

            // 3. Text lines, 10px apart, shadowed, § codes interpreted
            for (let i = 0; i < lines.length; i++) {
                font.drawString(stack, lines[i], l1, i2 + i * lineSpacing, color, true, false);
            }

            return {
                x: boxLeft,
                y: boxTop,
                width: boxWidth,
                height: boxHeight
            };
        };

        return {
            text,
            drawText: text,
            tooltip,
            drawTooltip: tooltip,
            measure,
            rect: (left, top, right, bottom, color = '#000000', alpha = 1) => {
                stack.save();
                stack.globalAlpha = Number(alpha);
                stack.fillStyle = normalizeOverlayCanvasColor(color);
                stack.fillRect(
                    Math.floor(left), Math.floor(top),
                    Math.ceil(right - left), Math.ceil(bottom - top)
                );
                stack.restore();
            },
            width,
            height,
            stack,
            overlay,
            minecraft: loader.minecraft
        };
    }

    /* ---------------------------- mod data ---------------------------- */

    /**
     * Store JSON data for this mod. Data lives under its own namespace in the
     * persistent game store, never inside a read-only disk mod folder.
     */
    async saveJson(key, value, modId = this._activeModId) {
        if (!modId) throw new Error('No mod is active for saveJson().');
        const path = modDataPath(modId, key);
        await this.filesystem.saveFile(JSON.stringify(value, null, 2), path);
        return value;
    }

    async loadJson(key, fallback = null, modId = this._activeModId) {
        if (!modId) throw new Error('No mod is active for loadJson().');
        const path = modDataPath(modId, key);
        const raw = await this.filesystem.loadFile(path);
        if (raw === null || raw === undefined || raw === '') return fallback;

        try {
            return JSON.parse(raw);
        } catch (error) {
            console.warn(`[Patchwork] Invalid JSON in '${path}':`, error);
            return fallback;
        }
    }

    async deleteJson(key, modId = this._activeModId) {
        if (!modId) throw new Error('No mod is active for deleteJson().');
        const path = modDataPath(modId, key);
        const existed = await this.filesystem.fileExists(path);
        await this.filesystem.deleteFile(path);
        return existed;
    }

    async listJson(modId = this._activeModId) {
        if (!modId) throw new Error('No mod is active for listJson().');
        const prefix = `mod_data/${modId}/`;
        const files = await this.filesystem.listDir(prefix);
        return files
            .filter((file) => file.endsWith('.json'))
            .map((file) => file.slice(prefix.length, -'.json'.length))
            .filter((key) => /^[A-Za-z0-9._-]{1,64}$/.test(key));
    }

    /**
     * Fire a render hook. Called from WorldRenderer; mods never need this.
     * A throwing hook is reported and skipped so one bad mod cannot break the
     * frame for everybody else.
     */
    emitRenderHook(hook, payload = {}, worldRenderer = null) {
        const hooks = this.renderHooks.get(hook);
        if (!hooks || hooks.length === 0) return;

        const context = {
            hook,
            minecraft: this.minecraft,
            worldRenderer: worldRenderer || this.minecraft?.worldRenderer || null,
            ...payload
        };

        for (const entry of [...hooks]) {
            try {
                entry.fn(context);
            } catch (error) {
                console.warn(`[Patchwork] Mod render hook '${hook}' failed:`, error);
            }
        }
    }

    /* --------------------------- mod bookkeeping ---------------------- */

    _trackRegistration(modId) {
        let record = this._modRegistrations.get(modId);
        if (!record) {
            record = {
                commands: new Set(),
                hooks: new Set(),
                blockActions: new Set(),
                overlayText: new Set(),
                keybinds: new Set(),
                services: new Map()
            };
            this._modRegistrations.set(modId, record);
        }
        return record;
    }

    /** Remove every command, hook, overlay provider, tab and service a mod registered. */
    releaseModRegistrations(modId) {
        const record = this._modRegistrations.get(modId);
        this._modRegistrations.delete(modId);
        if (!record) return 0;

        for (const name of record.commands) {
            CommandRegistry.unregister(name);
        }
        for (const entry of record.hooks) {
            this._removeRenderHook(entry);
        }
        for (const entry of record.blockActions) {
            this.blockActions.unregister(entry.action, entry);
        }
        for (const entry of record.overlayText) {
            const index = this.overlayTextHooks.indexOf(entry);
            if (index !== -1) this.overlayTextHooks.splice(index, 1);
        }
        for (const entry of record.keybinds) {
            if (this.keybinds.get(entry.setting) === entry) this.keybinds.delete(entry.setting);
            this._pressedKeybinds.delete(entry.setting);
        }
        for (const [serviceId, service] of record.services) {
            // Only remove the service this mod registered; another mod may have
            // taken over the same id since it was added.
            if (this.services.get(serviceId) === service) {
                this.services.delete(serviceId);
            }
        }
        this.clearCustomTabs(modId);
        return record.commands.size + record.hooks.size + record.blockActions.size +
            record.overlayText.size + record.keybinds.size + record.services.size;
    }

    /**
     * The object injected into every mod sandbox as `ModAPI` (and passed to
     * ModLoad.onLoad as its third argument is this loader itself).
     */
    _getModApi(modId) {
        const cached = this._modApis.get(modId);
        if (cached) return cached;
        const loader = this;
        const api = {
            modId,
            isServer: false,
            get minecraft() { return loader.minecraft; },
            get world() { return loader.minecraft?.world; },
            registerCommand: (name, usage, description, execute, options = {}) =>
                loader.registerCommand(name, usage, description, execute, { modId, ...options }),
            unregisterCommand: (name) => loader.unregisterCommand(name),
            getCommand: (name) => CommandRegistry.get(name),
            registerRenderHook: (hook, fn, options = {}) => loader.registerRenderHook(hook, fn, { modId, ...options }),
            unregisterRenderHook: (hook, handle) => loader.unregisterRenderHook(hook, handle),
            registerBlockAction: (action, fn, options = {}) => loader.registerBlockAction(action, fn, { modId, ...options }),
            onBlockAction: (action, fn, options = {}) => loader.registerBlockAction(action, fn, { modId, ...options }),
            unregisterBlockAction: (action, handle) => loader.unregisterBlockAction(action, handle),
            registerOverlayText: (fn, options = {}) => loader.registerOverlayText(fn, { modId, ...options }),
            onOverlayText: (fn, options = {}) => loader.registerOverlayText(fn, { modId, ...options }),
            unregisterOverlayText: (handle) => loader.unregisterOverlayText(handle),
            registerKeybind: (id, name, defaultKey, onPress, options = {}) =>
                loader.registerKeybind(id, name, defaultKey, onPress, { modId, ...options }),
            unregisterKeybind: (id) => loader.unregisterKeybind(id, modId),
            getKeybind: (id) => loader.getKeybind(id, modId),
            getKeybindKey: (id) => loader.getKeybindKey(id, modId),
            getKeybinds: () => loader.getKeybinds(),
            saveJson: (key, value) => loader.saveJson(key, value, modId),
            loadJson: (key, fallback = null) => loader.loadJson(key, fallback, modId),
            deleteJson: (key) => loader.deleteJson(key, modId),
            listJson: () => loader.listJson(modId),
            sendModMessage: (payload) => {
                const networkManager = loader.minecraft?.playerController
                    ?.getNetworkHandler?.()?.getNetworkManager?.();
                if (!networkManager) return false;
                networkManager.sendJson({ type: 'modMessage', modId, payload });
                return true;
            },
            getLookedAtBlock: (reach = 5) => globalThis.Mixin?.callFunction('game:getLookedAtBlock', reach),
            registerService: (serviceId, service) => loader.registerService(serviceId, service, modId),
            getService: (serviceId) => loader.getService(serviceId),
            resolveTexture: (key) => loader.resolveTexture(key),
            log: (...args) => console.log(`[Patchwork] [${modId}]`, ...args),
            warn: (...args) => console.warn(`[Patchwork] [${modId}]`, ...args)
        };
        this._modApis.set(modId, api);
        return api;
    }

    /**
     * Install a mod from a ZIP File object (user-uploaded).
     * @param {File} zipFile
     * @returns {Promise<string>} the installed modId
     */
    async installModFromZip(zipFile) {
        const JSZip = await this._ensureJSZip();
        const zip = await JSZip.loadAsync(zipFile);

        // --- 1. Read ModData ---
        const modData = await this._readModDataFromZip(zip);
        const modId = modData.ID;

        // --- 2. Validate ---
        if (!modId || typeof modId !== 'string') {
            throw new Error('ModData.js must export a class with a static ID property.');
        }
        if (this.mods.has(modId)) {
            throw new Error(`A mod with ID '${modId}' is already loaded.`);
        }

        console.log(`[Patchwork] Installing mod '${modData.NAME}' (${modId}) v${modData.VERSION}`);

        // --- 3. Store mod metadata ---
        await this.filesystem.saveFile(JSON.stringify(modData), `mods/${modId}/ModData.json`);

        // --- 4. Extract files from ZIP ---
        for (const [path, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;

            if (path === 'ModLoad.js') {
                const src = await entry.async('string');
                await this.filesystem.saveFile(src, `mods/${modId}/ModLoad.js`);
            } else if (path.endsWith('.js') && !path.includes('/')) {
                // Root-level helper modules are used by runtime-only mods
                // (for example a renderer/service module imported by
                // ModLoad.js). Preserve them instead of silently dropping
                // them during persistent ZIP installation.
                const src = await entry.async('string');
                const filename = path.split('/').pop();
                await this.filesystem.saveFile(src, `mods/${modId}/${filename}`);
            } else if (path.startsWith('blocks/') && path.endsWith('.js')) {
                const src = await entry.async('string');
                const filename = path.split('/').pop();
                await this.filesystem.saveFile(src, `mods/${modId}/blocks/${filename}`);
            } else if (path.startsWith('items/') && path.endsWith('.js')) {
                const src = await entry.async('string');
                const filename = path.split('/').pop();
                await this.filesystem.saveFile(src, `mods/${modId}/items/${filename}`);
            } else if (path === 'icon.png' || path === './icon.png') {
                // Mod icon shown on the Mods screen.
                const b64 = await entry.async('base64');
                await this.filesystem.saveBinaryFile(b64, `mods/${modId}/icon.png.b64`);
            } else if (path.startsWith('textures/') && path.endsWith('.png')) {
                const b64 = await entry.async('base64');
                const filename = path.split('/').pop();
                await this.filesystem.saveBinaryFile(b64, `mods/${modId}/textures/${filename}.b64`);
            } else if (path.startsWith('crafting/') && path.endsWith('.js')) {
                const src = await entry.async('string');
                const filename = path.split('/').pop();
                await this.filesystem.saveFile(src, `mods/${modId}/crafting/${filename}`);
            } else if (path.startsWith('smelting/') && path.endsWith('.js')) {
                const src = await entry.async('string');
                const filename = path.split('/').pop();
                await this.filesystem.saveFile(src, `mods/${modId}/smelting/${filename}`);
            } else if (path.startsWith('gui/') && path.endsWith('.js')) {
                const src = await entry.async('string');
                const filename = path.split('/').pop();
                await this.filesystem.saveFile(src, `mods/${modId}/gui/${filename}`);
            } else if (path.startsWith('gui_textures/') && path.endsWith('.png')) {
                const b64 = await entry.async('base64');
                const filename = path.split('/').pop();
                await this.filesystem.saveBinaryFile(b64, `mods/${modId}/gui_textures/${filename}.b64`);
            } else if (path.startsWith('sounds/') && path.endsWith('.ogg')) {
                const b64 = await entry.async('base64');
                const filename = path.split('/').pop();
                await this.filesystem.saveBinaryFile(b64, `mods/${modId}/sounds/${filename}.b64`);
            }
        }

        // --- 5. Enable & load ---
        this.enabledMods.add(modId);
        this._saveEnabledSet();
        await this._loadMod(modId);

        return modId;
    }

    /**
     * Install a mod from a selected folder. Accepts the FileList produced by
     * an `<input type="file" webkitdirectory>` picker (or any array of File
     * objects with `webkitRelativePath` paths). The folder is copied into the
     * same persistent layout as a ZIP install, so it loads and unloads like any
     * other installed mod.
     *
     * @param {FileList|File[]} fileList
     * @returns {Promise<string>} the installed modId
     */
    async installModFromFolder(fileList) {
        const files = Array.from(fileList || []);
        if (files.length === 0) {
            throw new Error('No files were selected.');
        }

        const entries = [];
        for (const file of files) {
            const rawPath = file.webkitRelativePath || file.name || '';
            const path = String(rawPath).replace(/\\/g, '/').replace(/^\/+/, '');
            const parts = path.split('/');
            if (!path || parts.some((part) => !part || part === '.' || part === '..')) {
                continue;
            }
            entries.push({ file, path });
        }

        const metadataEntries = entries.filter(({ path }) =>
            path === 'ModData.js' || path.endsWith('/ModData.js') ||
            path === 'ModData.json' || path.endsWith('/ModData.json')
        );
        if (metadataEntries.length === 0) {
            throw new Error('ModData.js or ModData.json was not found in the selected folder.');
        }

        // Prefer explicit JSON metadata when a folder carries both forms.
        const metadataEntry = metadataEntries.find(({ path }) =>
            path === 'ModData.json' || path.endsWith('/ModData.json')
        ) || metadataEntries[0];
        const metadataName = metadataEntry.path.split('/').pop();
        const rootPath = metadataEntry.path.slice(0, metadataEntry.path.length - metadataName.length);
        const roots = new Set(metadataEntries.map(({ path }) =>
            path.slice(0, path.length - path.split('/').pop().length)
        ));
        if (roots.size > 1) {
            throw new Error('Select the folder for a single mod, not a folder containing several mods.');
        }

        let modData;
        if (metadataName === 'ModData.json') {
            modData = JSON.parse(await metadataEntry.file.text());
        } else {
            modData = this._parseModDataSource(await metadataEntry.file.text());
        }

        const modId = String(modData?.ID || '').trim();
        if (!/^[A-Za-z0-9_-]{1,64}$/.test(modId)) {
            throw new Error('ModData must define a valid static ID (letters, numbers, _ or -).');
        }
        if (this.mods.has(modId)) {
            throw new Error(`A mod with ID '${modId}' is already loaded.`);
        }

        const normalizedMeta = {
            NAME: String(modData.NAME || modId),
            ID: modId,
            AUTHOR: String(modData.AUTHOR || 'Unknown'),
            VERSION: String(modData.VERSION || '0.0.0'),
            DESCRIPTION: String(modData.DESCRIPTION || ''),
            LICENSE: String(modData.LICENSE || '')
        };

        await this.filesystem.saveFile(
            JSON.stringify(normalizedMeta, null, 2),
            `mods/${modId}/ModData.json`
        );

        for (const { file, path } of entries) {
            if (!path.startsWith(rootPath)) continue;
            const relative = path.slice(rootPath.length);
            if (!relative || relative === 'ModData.json') continue;

            const storagePath = `mods/${modId}/${relative}`;
            if (isBinaryModFile(relative)) {
                const b64 = await this._arrayBufferToBase64(await file.arrayBuffer());
                await this.filesystem.saveBinaryFile(b64, `${storagePath}.b64`);
            } else {
                await this.filesystem.saveFile(await file.text(), storagePath);
            }
        }

        this.enabledMods.add(modId);
        this._saveEnabledSet();
        await this._loadMod(modId);
        return modId;
    }

    /**
     * Temporarily load a mod from a ZIP file served over HTTP (dev mode).
     * Triggered by a `?dev-mod=<url>` query parameter. The mod is held in
     * memory only - nothing is written to the filesystem, so it is gone on
     * the next page load.
     * @param {string} url  - e.g. 'http://localhost:8080/mod.zip'
     * @returns {Promise<string>} the modId
     */
    async loadDevModFromUrl(url) {
        console.log(`[Patchwork] Loading dev mod from URL: ${url}`);

        const JSZip = await this._ensureJSZip();

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch dev mod (${response.status} ${response.statusText}): ${url}`);
        }
        const zipData = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(zipData);

        // 1. Read ModData ---
        const modData = await this._readModDataFromZip(zip);
        const modId = modData.ID;
        if (!modId || typeof modId !== 'string') {
            throw new Error('ModData.js must export a class with a static ID property.');
        }
        if (this.mods.has(modId)) {
            throw new Error(`A mod with ID '${modId}' is already loaded.`);
        }

        // 2. Extract all files into an in-memory map (mirrors the persisted
        //    layout from installModFromZip, but never saved to disk).
        const fileMap = new Map();
        fileMap.set(`mods/${modId}/ModData.json`, JSON.stringify(modData));

        for (const [path, entry] of Object.entries(zip.files)) {
            if (entry.dir) continue;
            if (path === 'ModData.js') continue;

            if (path.endsWith('.png') || path.endsWith('.ogg')) {
                fileMap.set(`mods/${modId}/${path}.b64`, await entry.async('base64'));
            } else {
                fileMap.set(`mods/${modId}/${path}`, await entry.async('string'));
            }
        }

        // 3. Load using an in-memory-only source ---
        const fs = new MemoryFilesystem(fileMap);
        this._devModFilesystems.set(modId, fs);

        console.log(`[Patchwork] Installing dev mod '${modData.NAME}' (${modId}) v${modData.VERSION} in memory`);
        await this._loadMod(modId, fs);
        return modId;
    }

    /**
     * Get the in-memory filesystem backing a temporarily-loaded dev mod, or
     * null if it is not a dev mod.
     * @param {string} modId
     * @returns {MemoryFilesystem|null}
     */
    getDevModFilesystem(modId) {
        return this._devModFilesystems.get(modId) || null;
    }

    /**
     * The in-memory filesystem for a server- or dev-supplied mod, or null for
     * mods that live in IndexedDB / the physical mods folder.
     */
    getModFilesystem(modId) {
        return this._serverModFilesystems.get(modId)
            || this._devModFilesystems.get(modId)
            || null;
    }

    /**
     * Register the mods a multiplayer server sent on join.
     *
     * The payload mirrors the on-disk layout the loader already understands:
     * text files are text, images/sounds carry base64 and are stored under
     * `<name>.b64`. Server mods live only in memory and are tracked separately
     * so leaving the server can remove everything they registered.
     *
     * @param {Array<{id:string,name?:string,author?:string,version?:string,files?:Array}>} serverMods
     * @returns {Promise<string[]>} ids that were loaded
     */
    async loadServerMods(serverMods) {
        this.unloadServerMods();
        const generation = this._serverModGeneration;

        if (!Array.isArray(serverMods) || serverMods.length === 0) {
            return [];
        }

        // `handleJoinGame` starts the client world asynchronously and that may
        // rebuild the texture atlas. Waiting here keeps server textures from
        // being painted into an atlas that is about to be replaced.
        const worldLoad = this.minecraft?.worldLoadPromise;
        if (worldLoad && typeof worldLoad.then === 'function') {
            try {
                await worldLoad;
            } catch {
                // A failed world load will surface through its own path; mods
                // can still be registered for the next join.
            }
        }

        // The player may have disconnected while the world/mod payload was
        // loading. Everything registered by that attempt must be discarded.
        if (generation !== this._serverModGeneration) return [];

        // The world and its texture atlas are ready now, so the remaining work
        // really is importing the server's mods.
        this.minecraft?.setLoadingStatus?.("Importing mods...");

        const loaded = [];

        for (const mod of serverMods) {
            if (generation !== this._serverModGeneration) break;
            if (!mod || typeof mod !== 'object') continue;

            const modId = typeof mod.id === 'string' ? mod.id.trim() : '';
            if (!/^[A-Za-z0-9_-]{1,64}$/.test(modId)) {
                console.warn('[Patchwork] Ignoring server mod with an invalid id:', mod.id);
                continue;
            }
            if (this.mods.has(modId)) {
                console.log(`[Patchwork] Server mod '${modId}' is also installed locally; using server version.`);
                // Unload the local version before loading the server version
                this._unregisterModContent(modId);
                // Mark it as a server mod so it gets cleaned up on disconnect
                this._serverModIds.add(modId);
                // Track that this mod had a local version that was replaced
                this._replacedLocalModIds.add(modId);
            }

            const fileMap = new Map();
            fileMap.set(`mods/${modId}/ModData.json`, JSON.stringify({
                ID: modId,
                NAME: mod.name || modId,
                AUTHOR: mod.author || 'Server',
                VERSION: mod.version || '0.0.0'
            }));

            for (const file of Array.isArray(mod.files) ? mod.files : []) {
                if (!file || typeof file.path !== 'string') continue;

                const relative = file.path.replace(/\\/g, '/').replace(/^\/+/, '');
                if (!relative || relative.includes('\0')) continue;

                const segments = relative.split('/');
                if (segments.some((segment) => segment === '..' || segment === '')) continue;
                if (relative === 'ModData.js') continue;

                const storagePath = file.binary && !relative.endsWith('.b64')
                    ? `${relative}.b64`
                    : relative;
                fileMap.set(`mods/${modId}/${storagePath}`, String(file.data ?? ''));
            }

            const fs = new MemoryFilesystem(fileMap);
            this._serverModFilesystems.set(modId, fs);
            this._serverModIds.add(modId);

            try {
                const entry = await this._loadMod(modId, fs);
                if (generation !== this._serverModGeneration) {
                    this._unregisterModContent(modId, entry);
                    this._serverModIds.delete(modId);
                    this._serverModFilesystems.delete(modId);
                    break;
                }
                loaded.push(modId);
                console.log(`[Patchwork] Loaded server mod '${modId}'`);
            } catch (err) {
                console.error(`[Patchwork] Failed to load server mod '${modId}':`, err);
                this._unregisterModContent(modId);
                this._serverModIds.delete(modId);
                this._serverModFilesystems.delete(modId);
            }
        }

        return loaded;
    }

    /**
     * Remove every mod supplied by the server that was joined last. Called
     * when the connection closes or the player returns to the main menu, so
     * server content never leaks into another server or singleplayer.
     */
    async unloadServerMods() {
        // Even when nothing has finished loading yet, this invalidates an
        // in-flight loadServerMods() so it cannot register content after the
        // player has already left.
        this._serverModGeneration++;
        if (this._serverModIds.size === 0) return;

        const ids = [...this._serverModIds];
        for (const modId of ids) {
            const hadLocalVersion = this._replacedLocalModIds.has(modId);
            this._unregisterModContent(modId);
            this._serverModFilesystems.delete(modId);
            this._serverModIds.delete(modId);
            this._replacedLocalModIds.delete(modId);

            // Reload the local version if it was replaced by the server version
            if (hadLocalVersion) {
                try {
                    const fs = await this._fsForMod(modId);
                    await this._loadMod(modId, fs);
                    console.log(`[Patchwork] Reloaded local version of '${modId}'`);
                } catch (err) {
                    console.error(`[Patchwork] Failed to reload local version of '${modId}':`, err);
                }
            }
        }
        console.log(`[Patchwork] Unloaded ${ids.length} server mod(s)`);
    }

    /**
     * Load a mod from a folder of pre-extracted files (dev mode).
     * @param {string} modId
     * @param {object} fileMap - { relativePath: stringContent | ArrayBuffer }
     */
    async loadModFromFolder(modId, fileMap) {
        console.log(`[Patchwork] Loading mod from folder: ${modId}`);

        // Store all files
        for (const [path, content] of Object.entries(fileMap)) {
            const fullPath = `mods/${modId}/${path}`;
            if (content instanceof ArrayBuffer || content instanceof Blob) {
                // Convert to base64 for binary storage
                const b64 = await this._arrayBufferToBase64(content instanceof Blob ? await content.arrayBuffer() : content);
                await this.filesystem.saveBinaryFile(b64, fullPath + '.b64');
            } else {
                await this.filesystem.saveFile(content, fullPath);
            }
        }

        this.enabledMods.add(modId);
        this._saveEnabledSet();
        await this._loadMod(modId);
    }

    /**
     * Uninstall a mod and clean up its blocks/textures.
     * @param {string} modId
     */
    async uninstallMod(modId) {
        // Files in the physical mods/ folder belong to the user; deleting
        // them is a deliberate act outside the game.
        if (await this.isDiskMod(modId)) {
            throw new Error(
                `'${modId}' is a folder in the mods/ directory and cannot be deleted from inside the game. Remove the folder and restart.`
            );
        }

        this.enabledMods.delete(modId);
        this._disabledMods.delete(modId);
        this._saveEnabledSet();
        this._saveDisabledSet();

        this._unregisterModContent(modId);

        const files = await this.filesystem.listDir(`mods/${modId}/`);
        for (const f of files) {
            await this.filesystem.deleteFile(f);
        }

        console.log(`[Patchwork] Uninstalled mod '${modId}'`);
    }

    /**
     * Remove every registration a mod made, without touching its files.
     * Used by uninstall and by the server-mod lifecycle when a connection
     * ends.
     */
    _unregisterModContent(modId, entryOverride = null) {
        const entry = entryOverride || this.mods.get(modId) || null;
        const atlas = this.minecraft?.worldRenderer?.textureAtlas;

        if (entry) {
            for (const blockId of entry.blockIds) {
                BlockRegistry.unregister(blockId);
            }
            for (const itemId of entry.itemIds) {
                BlockRegistry.unregister(itemId);
            }

            for (const textureName of entry.textureNames || []) {
                atlas?.unregisterModTexture?.(`${modId}:${textureName}`);
            }
            for (const textureName of entry.guiTextureNames || []) {
                if (this.minecraft?.resources) {
                    delete this.minecraft.resources[`gui/${modId}/${textureName}`];
                }
            }
            for (const recipe of entry.craftingRecipes || []) {
                CraftingRegistry.unregisterRecipe(recipe);
            }
            for (const recipe of entry.smeltingRecipes || []) {
                SmeltingRegistry.unregisterRecipe(recipe);
            }
        }

        this.releaseModRegistrations(modId);
        this._temporaryDisabledModIds.delete(modId);
        if (entry) this._temporaryDisabledModIds.delete(entry.id);
        this._modApis.delete(modId);
        this.mods.delete(modId);

        for (const key of this._modModuleCache.keys()) {
            if (key.startsWith(`${modId}/`)) this._modModuleCache.delete(key);
        }

        return entry;
    }

    /**
     * Toggle a mod on/off without uninstalling.
     */
    async toggleMod(modId, enabled) {
        // An explicit toggle overrides the session-only switch made when
        // joining a server that refuses mods.
        this._temporaryDisabledModIds.delete(modId);
        const loadedEntry = this.mods.get(modId);
        if (loadedEntry) this._temporaryDisabledModIds.delete(loadedEntry.id);

        if (enabled) {
            this.enabledMods.add(modId);
            this._disabledMods.delete(modId);
            const fs = await this._fsForMod(modId);
            if (this.mods.has(modId)) {
                // The mod stayed registered while disabled, so only its live
                // registrations (commands, tabs, services, hooks) need to
                // come back - not its blocks, items, recipes or textures.
                await this._reactivateMod(modId, fs);
            } else {
                await this._loadMod(modId, fs);
            }
        } else {
            this.enabledMods.delete(modId);
            // Commands, hooks and services are live JS, so they must go away
            // with the switch; blocks/textures stay registered like they always did.
            this.releaseModRegistrations(modId);
            // Remember the refusal, otherwise a wiki-installed folder would be
            // switched straight back on at the next launch.
            this._disabledMods.add(modId);
        }
        this._saveEnabledSet();
        this._saveDisabledSet();
    }

    /**
     * Switch every locally loaded mod off for this session so the player can
     * join a server that refuses mods. Unlike toggleMod this never touches the
     * saved enabled set, so reloading the game turns the mods back on.
     *
     * @returns {number} how many mods were switched off
     */
    temporarilyDisableMods() {
        let count = 0;
        for (const [modId, entry] of this.mods) {
            if (this._serverModIds.has(modId)) continue;
            if (!this.enabledMods.has(modId) && !this.enabledMods.has(entry.id)) continue;
            if (this._temporaryDisabledModIds.has(modId)) continue;

            this._temporaryDisabledModIds.add(modId);
            if (entry.id) this._temporaryDisabledModIds.add(entry.id);
            this.releaseModRegistrations(modId);
            count++;
        }
        return count;
    }

    /**
     * Restore the runtime registrations a disable removed, without reloading
     * the parts that stayed in place (blocks, items, recipes, textures).
     */
    async _reactivateMod(modId, fs = this.filesystem) {
        const entry = this.mods.get(modId);
        if (!entry) {
            return this._loadMod(modId, fs);
        }

        const previousActiveMod = this._activeModId;
        this._activeModId = modId;
        try {
            this.releaseModRegistrations(modId);
            entry.commandNames = [];

            const allFiles = await fs.listDir(`mods/${modId}/`);
            const modPrefix = `mods/${modId}/`;
            const relFiles = allFiles.map(f => f.startsWith(modPrefix) ? f.slice(modPrefix.length) : f);

            const commandFiles = relFiles
                .filter(f => f.startsWith('commands/') && f.endsWith('.js'))
                .map(f => f.replace(/^commands\//, ''));

            const tabFiles = relFiles
                .filter(f => f.startsWith('tabs/') && f.endsWith('.js'))
                .map(f => f.replace(/^tabs\//, ''));

            await this._registerModCommands(modId, entry, commandFiles, fs);
            await this._registerModTabs(modId, entry, tabFiles, fs);
            await this._callModLoad(modId, entry, fs);

            console.log(`[Patchwork] Re-enabled mod '${entry.name}'`);
            return entry;
        } catch (err) {
            // Do not leave half of the mod's live content registered.
            this.releaseModRegistrations(modId);
            throw err;
        } finally {
            this._activeModId = previousActiveMod;
        }
    }

    /**
     * Return list of mod IDs that have a ModData.json stored.
     */
    async getInstalledModIds() {
        const modIdSet = new Set();

        const allFiles = await this.filesystem.listDir('mods/');
        for (const f of allFiles) {
            const match = f.match(/^mods\/([^/]+)\/ModData\.json$/);
            if (match) modIdSet.add(match[1]);
        }

        // Mods dropped into the physical mods/ folder (Electron only).
        const disk = this._getDiskFilesystem();
        if (disk) {
            for (const modId of await disk.getModIds()) {
                modIdSet.add(modId);
            }
        }

        return [...modIdSet];
    }

    /**
     * The filesystem a mod should be loaded from, or null when mods/ is not
     * reachable (i.e. the web build). A folder on disk wins over a ZIP of the
     * same name so that editing the folder takes effect immediately.
     * @param {string} modId
     */
    async _fsForMod(modId) {
        const disk = this._getDiskFilesystem();
        if (!disk) return this.filesystem;
        const diskIds = await disk.getModIds();
        return diskIds.includes(modId) ? disk : this.filesystem;
    }

    /**
     * True when the mod is a folder in the physical mods/ directory rather
     * than a ZIP installed into IndexedDB.
     * @param {string} modId
     */
    async isDiskMod(modId) {
        const disk = this._getDiskFilesystem();
        if (!disk) return false;
        return (await disk.getModIds()).includes(modId);
    }

    /**
     * Re-scan the physical mods/ folder. Use after adding or removing files
     * there while the game is running.
     */
    async refreshDiskMods() {
        const disk = this._getDiskFilesystem();
        if (disk) await disk.refresh();
    }

    /**
     * Get a loaded mod entry.
     * @param {string} modId
     * @returns {ModEntry|undefined}
     */
    getMod(modId) {
        return this.mods.get(modId);
    }

    /**
     * Resolve a namespaced texture key '<modId>:<name>' to texture atlas data.
     * Returns { modId, textureName } or null.
     */
    resolveTexture(namespacedKey) {
        if (!namespacedKey || !namespacedKey.includes(':')) return null;
        const colonIndex = namespacedKey.indexOf(':');
        const modId = namespacedKey.substring(0, colonIndex);
        const textureName = namespacedKey.substring(colonIndex + 1);
        const entry = this.mods.get(modId);
        if (!entry) {
            console.warn(`[Patchwork] Unknown mod '${modId}' for texture '${namespacedKey}'`);
            return null;
        }
        return { modId, textureName };
    }

    /**
     * Load a mod's texture as an HTMLImageElement from IndexedDB.
     * @param {string} modId
     * @param {string} textureName  e.g. 'unbreakable_block'
     * @param {object} fs  - filesystem to read from (defaults to persisted store)
     * @returns {Promise<HTMLImageElement>}
     */
    async loadModTexture(modId, textureName, fs = null) {
        fs = fs || this.getModFilesystem(modId) || this.filesystem;
        const b64Path = `mods/${modId}/textures/${textureName}.png.b64`;
        const b64data = await fs.loadBinaryFile(b64Path);
        if (!b64data) {
            throw new Error(`Mod texture not found: ${b64Path}`);
        }
        return new Promise((resolve, reject) => {
            const blob = new Blob([b64data], { type: 'image/png' });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to decode mod texture: ${textureName}`)); };
            img.src = url;
        });
    }

    /**
     * Load a mod's root `icon.png` as a data URL for the Mods screen. Returns
     * null when the mod has no icon or it cannot be read.
     * @param {string} modId
     * @param {object} fs - filesystem to read from (defaults to the mod's own)
     * @returns {Promise<string|null>}
     */
    async loadModIcon(modId, fs = null) {
        fs = fs || this.getModFilesystem(modId) || this.filesystem;
        try {
            const bytes = await fs.loadBinaryFile(`mods/${modId}/icon.png.b64`);
            if (!bytes || bytes.length === 0) return null;
            return `data:image/png;base64,${await this._arrayBufferToBase64(bytes)}`;
        } catch (err) {
            console.warn(`[Patchwork] Could not read the icon for '${modId}':`, err);
            return null;
        }
    }

    /* ------------------------------------------------------------------
     *  Integrated server support
     * ------------------------------------------------------------------ */

    /**
     * The mods list advertised to a server during login. A mod switched off at
     * runtime stays in `mods` (its blocks and textures keep working), so the
     * handshake must filter on `enabledMods`; otherwise a server with mods
     * disabled kicks the player for a mod they just turned off.
     *
     * @returns {Array<{id:string,name:string,version:string}>}
     */
    getHandshakeMods() {
        const mods = [];
        for (const [modId, entry] of this.mods) {
            if (!this.enabledMods.has(modId) && !this.enabledMods.has(entry.id)) continue;
            if (this._temporaryDisabledModIds.has(modId) || this._temporaryDisabledModIds.has(entry.id)) continue;
            mods.push({ id: modId, name: entry.name || modId, version: entry.version || '0.0.0' });
        }
        return mods;
    }

    /**
     * Snapshot every locally installed mod in the same shape the server's
     * servermods/ directory uses.
     *
     * Singleplayer runs the world in a worker, so the integrated server cannot
     * read this ModDB store or the Electron mods/ folder. Passing the files
     * over lets the server register the mods' commands and authoritative
     * hooks (block protection, etc.) for the same mods the player sees.
     * Mods supplied by a remote server are excluded; they belong to that
     * server, not to the local world.
     *
     * @returns {Promise<Array<{id:string,name:string,author:string,version:string,files:Array}>>}
     */
    async getServerModPayload() {
        const mods = [];

        for (const [modId, entry] of this.mods) {
            if (this._serverModIds.has(modId)) continue;
            // A disabled mod stays registered for its blocks/textures, but it
            // is not part of what the player runs, so a fresh world must not
            // load it server-side either.
            if (!this.enabledMods.has(modId) && !this.enabledMods.has(entry.id)) continue;
            if (this._temporaryDisabledModIds.has(modId) || this._temporaryDisabledModIds.has(entry.id)) continue;

            let fs;
            try {
                fs = await this._fsForMod(modId);
            } catch (err) {
                console.warn(`[Patchwork] Could not read mod '${modId}' for the integrated server:`, err);
                continue;
            }

            const prefix = `mods/${modId}/`;
            let paths = [];
            try {
                paths = await fs.listDir(prefix);
            } catch (err) {
                console.warn(`[Patchwork] Could not list mod '${modId}' for the integrated server:`, err);
                continue;
            }

            const files = [];
            for (const fullPath of paths) {
                if (!fullPath.startsWith(prefix)) continue;

                const relative = fullPath.slice(prefix.length);
                if (!relative) continue;
                if (relative === 'ModData.json' || relative === 'ModData.js') continue;
                if (relative.split('/').some((segment) => segment === '' || segment === '..')) continue;

                try {
                    if (relative.endsWith('.b64')) {
                        const bytes = await fs.loadBinaryFile(fullPath);
                        if (!bytes || bytes.length === 0) continue;
                        files.push({
                            path: relative.slice(0, -4),
                            binary: true,
                            data: await this._arrayBufferToBase64(bytes)
                        });
                    } else {
                        const text = await fs.loadFile(fullPath);
                        if (typeof text !== 'string') continue;
                        files.push({ path: relative, binary: false, data: text });
                    }
                } catch (err) {
                    console.warn(`[Patchwork] Could not read '${fullPath}' for the integrated server:`, err);
                }
            }

            mods.push({
                id: entry.id || modId,
                name: entry.name || modId,
                author: entry.author || 'Unknown',
                version: entry.version || '0.0.0',
                files
            });
        }

        return mods;
    }

    /* ------------------------------------------------------------------
     *  Internal - load a single mod from IndexedDB
     * ------------------------------------------------------------------ */

    async _loadMod(modId, fs = this.filesystem) {
        // Attribute anything registered while this mod loads (and everything
        // ModLoad.onLoad does) to it, so it can be removed again on disable.
        const previousActiveMod = this._activeModId;
        this._activeModId = modId;
        try {
            // A reload would otherwise leave the previous run's hooks behind.
            this.releaseModRegistrations(modId);
            const entry = await this._loadModInner(modId, fs);
            return entry;
        } catch (err) {
            // Content registered before the failure must not survive as a
            // half-loaded mod (this matters for server mods, which are swapped
            // on every join).
            this._unregisterModContent(modId);
            throw err;
        } finally {
            this._activeModId = previousActiveMod;
        }
    }

    async _loadModInner(modId, fs = this.filesystem) {
        // 1. Read metadata
        const raw = await fs.loadFile(`mods/${modId}/ModData.json`);
        if (!raw) throw new Error(`ModData.json not found for mod '${modId}'`);
        const modData = JSON.parse(raw);

        const entry = {
            id: modData.ID || modId,
            name: modData.NAME || 'Unknown',
            author: modData.AUTHOR || 'Unknown',
            version: modData.VERSION || '0.0.0',
            description: modData.DESCRIPTION || '',
            license: modData.LICENSE || '',
            blockIds: [],
            blockClasses: new Map(),
            itemIds: [],
            itemClasses: new Map(),
            guiClasses: new Map(),
            commandNames: [],
            guiTextureNames: [],
            textureNames: [],
            soundNames: [],
            craftingRecipes: [],
            smeltingRecipes: []
        };

        // Store the entry before registering anything so a partial failure can
        // still be cleaned up through _unregisterModContent().
        this.mods.set(modId, entry);

        // 2. Discover files
        const allFiles = await fs.listDir(`mods/${modId}/`);
        const modPrefix = `mods/${modId}/`;
        const relFiles = allFiles.map(f => f.startsWith(modPrefix) ? f.slice(modPrefix.length) : f);

        const blockFiles = relFiles
            .filter(f => f.startsWith('blocks/') && f.endsWith('.js'))
            .map(f => f.replace(/^blocks\//, ''));

        const itemFiles = relFiles
            .filter(f => f.startsWith('items/') && f.endsWith('.js'))
            .map(f => f.replace(/^items\//, ''));

        const craftingFiles = relFiles
            .filter(f => f.startsWith('crafting/') && f.endsWith('.js'))
            .map(f => f.replace(/^crafting\//, ''));

        const smeltingFiles = relFiles
            .filter(f => f.startsWith('smelting/') && f.endsWith('.js'))
            .map(f => f.replace(/^smelting\//, ''));

        const guiFiles = relFiles
            .filter(f => f.startsWith('gui/') && f.endsWith('.js'))
            .map(f => f.replace(/^gui\//, ''));

        const commandFiles = relFiles
            .filter(f => f.startsWith('commands/') && f.endsWith('.js'))
            .map(f => f.replace(/^commands\//, ''));

        const tabFiles = relFiles
            .filter(f => f.startsWith('tabs/') && f.endsWith('.js'))
            .map(f => f.replace(/^tabs\//, ''));

        entry.guiTextureNames = relFiles
            .filter(f => f.startsWith('gui_textures/') && f.endsWith('.png.b64'))
            .map(f => f.replace(/^gui_textures\//, '').replace(/\.png\.b64$/, ''));

        entry.textureNames = relFiles
            .filter(f => f.startsWith('textures/') && f.endsWith('.png.b64'))
            .map(f => f.replace(/^textures\//, '').replace(/\.png\.b64$/, ''));

        entry.soundNames = relFiles
            .filter(f => f.startsWith('sounds/') && f.endsWith('.ogg.b64'))
            .map(f => f.replace(/^sounds\//, '').replace(/\.ogg\.b64$/, ''));

        // 3. Register mod textures into the TextureAtlas
        await this._registerModTextures(modId, entry, fs);

        // 4. Register GUI textures into minecraft.resources
        await this._registerModGuiTextures(modId, entry, fs);

        // 5. Load and register GUI classes (before blocks so blocks can reference them)
        await this._registerModGuis(modId, entry, guiFiles, fs);

        // 5b. Load and register chat commands from commands/
        await this._registerModCommands(modId, entry, commandFiles, fs);

        // 5c. Load and register custom tabs from tabs/
        await this._registerModTabs(modId, entry, tabFiles, fs);

        // 6. Load and register block classes (may reference GUI classes)
        await this._registerModBlocks(modId, entry, blockFiles, fs);

        // 7. Load and register item classes
        await this._registerModItems(modId, entry, itemFiles, fs);

        // 8. Register crafting recipes
        await this._registerModCrafting(modId, entry, craftingFiles, fs);

        // 9. Register smelting recipes
        await this._registerModSmelting(modId, entry, smeltingFiles, fs);

        // 10. Call ModLoad.onLoad if present
        await this._callModLoad(modId, entry, fs);

        console.log(`[Patchwork] Loaded mod '${entry.name}' - ${entry.blockIds.length} block(s), ${entry.itemIds.length} item(s), ${entry.textureNames.length} texture(s), ${entry.soundNames.length} sound(s)`);
        return entry;
    }

    /* ------------------------------------------------------------------
     *  Internal - register mod textures into TextureAtlas
     * ------------------------------------------------------------------ */

    async _registerModTextures(modId, entry, fs = this.filesystem) {
        const atlas = this.minecraft.worldRenderer?.textureAtlas;
        if (!atlas) {
            console.warn('[Patchwork] TextureAtlas not ready, skipping texture registration');
            return;
        }

        for (const texName of entry.textureNames) {
            try {
                const img = await this.loadModTexture(modId, texName, fs);
                const namespacedKey = `${modId}:${texName}`;
                atlas.registerModTexture(namespacedKey, img);
            } catch (err) {
                console.warn(`[Patchwork] Failed to register texture '${texName}' for mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - load block JS files, eval classes, register with BlockRegistry
     * ------------------------------------------------------------------ */

    async _registerModBlocks(modId, entry, blockFiles, fs = this.filesystem) {
        const BlockClass = await this._getBlockClass();

        const BoundingBoxClass = await this._getBoundingBox();

        const EnumBlockFaceClass = await this._getEnumBlockFace();

        const EnumCreativeInventoryTabClass = await this._getEnumCreativeInventoryTab();

        // Build deps: base block deps + any GUI classes from this mod
        const blockDeps = { Block: BlockClass, BlockRegistry, BoundingBox: BoundingBoxClass, EnumBlockFace: EnumBlockFaceClass, EnumCreativeInventoryTab: EnumCreativeInventoryTabClass, THREE, Sound, AuthLib, ModAPI: this._getModApi(modId) };
        for (const [className, cls] of entry.guiClasses) {
            blockDeps[className] = cls;
        }

        for (const filename of blockFiles) {
            try {
                const src = await fs.loadFile(`mods/${modId}/blocks/${filename}`);
                if (!src) continue;

                const blockClass = await this._evalClass(src, blockDeps, modId, `blocks/${filename}`, fs);
                if (!blockClass) continue;

                const className = blockClass.name || filename.replace('.js', '');
                const blockId = ModLoader.classToBlockId(className);
                const namespacedId = `${modId}:${blockId}`;

                const registered = this.minecraft.registerBlockClass(
                    namespacedId,
                    blockId,
                    blockClass
                );

                if (registered) {
                    registered.mod = entry.name;

                    // Set inventory tab - check if block specifies one, otherwise default to MATERIALS
                    // First check class property, then instance property (in case it's set in constructor)
                    const tabValue = blockClass.inventoryTab || (blockClass.prototype && blockClass.prototype.inventoryTab);

                    if (tabValue) {
                        if (typeof tabValue === 'object') {
                            // It's already a tab object (EnumCreativeInventoryTab)
                            registered.inventoryTab = tabValue;
                        } else if (typeof tabValue === 'string') {
                            // It's a tab name - look up custom tab
                            const customTab = this.getCustomTabByName(tabValue);
                            if (customTab) {
                                registered.inventoryTab = { id: customTab.id, name: customTab.name };
                                console.log(`[Patchwork] Assigned block '${namespacedId}' to custom tab '${tabValue}' (ID: ${customTab.id})`);
                            } else {
                                // Tab not found, default to MATERIALS
                                registered.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
                                console.warn(`[Patchwork] Custom tab '${tabValue}' not found for block '${namespacedId}', defaulting to MATERIALS`);
                            }
                        } else {
                            registered.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
                        }
                    } else {
                        registered.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
                    }

                    entry.blockIds.push(namespacedId);
                    entry.blockClasses.set(namespacedId, blockClass);
                    console.log(`[Patchwork] Registered block '${namespacedId}' from ${filename}`);
                }
            } catch (err) {
                console.error(`[Patchwork] Failed to load block '${filename}' from mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - load item JS files, eval classes, register with BlockRegistry
     * ------------------------------------------------------------------ */

    async _registerModItems(modId, entry, itemFiles, fs = this.filesystem) {
        const itemClasses = await this._getItemClasses(modId);

        for (const filename of itemFiles) {
            try {
                const src = await fs.loadFile(`mods/${modId}/items/${filename}`);
                if (!src) continue;

                const itemClass = await this._evalClass(src, itemClasses, modId, `items/${filename}`, fs);
                if (!itemClass) continue;

                const className = itemClass.name || filename.replace('.js', '');
                const itemId = ModLoader.classToItemId(className);
                const namespacedId = `${modId}:${itemId}`;

                const registered = this.minecraft.registerBlockClass(
                    namespacedId,
                    itemId,
                    itemClass
                );

                if (registered) {
                    registered.mod = entry.name;

                    // Set inventory tab - check if item specifies one, otherwise default to MATERIALS
                    if (itemClass.inventoryTab) {
                        if (typeof itemClass.inventoryTab === 'object') {
                            // It's already a tab object (EnumCreativeInventoryTab)
                            registered.inventoryTab = itemClass.inventoryTab;
                        } else if (typeof itemClass.inventoryTab === 'string') {
                            // It's a tab name - look up custom tab
                            const customTab = this.getCustomTabByName(itemClass.inventoryTab);
                            if (customTab) {
                                registered.inventoryTab = { id: customTab.id, name: customTab.name };
                            } else {
                                // Tab not found, default to MATERIALS
                                registered.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
                                console.warn(`[Patchwork] Custom tab '${itemClass.inventoryTab}' not found for item '${namespacedId}', defaulting to MATERIALS`);
                            }
                        } else {
                            registered.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
                        }
                    } else {
                        registered.inventoryTab = EnumCreativeInventoryTab.MATERIALS;
                    }

                    entry.itemIds.push(namespacedId);
                    entry.itemClasses.set(namespacedId, itemClass);
                    console.log(`[Patchwork]   Registered item '${namespacedId}' from ${filename}`);
                }
            } catch (err) {
                console.error(`[Patchwork] Failed to load item '${filename}' from mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - register crafting recipes
     * ------------------------------------------------------------------ */

    async _registerModCrafting(modId, entry, craftingFiles, fs = this.filesystem) {
        for (const filename of craftingFiles) {
            try {
                const src = await fs.loadFile(`mods/${modId}/crafting/${filename}`);
                if (!src) continue;

                const filePath = `crafting/${filename}`;
                const recipeDeps = {};
                await this._resolveModImports(src, recipeDeps, modId, filePath, new Set([filePath]), fs);

                let transformed = src.replace(/import\s+.*?from\s+["'][^"']*["']\s*;?/g, '');
                transformed = transformed.replace(/export\s+default\s+class\s+(\w+)/, 'class $1');

                const match = transformed.match(/class\s+(\w+)/);
                if (!match) continue;
                const className = match[1];

                // Extract block name: BlockOakTableCrafting -> OakTable
                let blockName = className;
                if (blockName.startsWith('Block')) blockName = blockName.substring(5);
                if (blockName.endsWith('Crafting')) blockName = blockName.slice(0, -8);
                const blockId = blockName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
                const namespacedId = `${modId}:${blockId}`;

                const resultBlock = BlockRegistry.get(namespacedId);
                if (!resultBlock) {
                    console.warn(`[Patchwork] Crafting recipe '${filename}' target block '${namespacedId}' not found, skipping`);
                    continue;
                }
                const resultTypeId = resultBlock.id;

                const recipeAssignments = Object.keys(recipeDeps).map(name =>
                    `const ${name} = __deps__["${name}"];`
                ).join('\n');

                const wrapped = `
                    return (function(__deps__) {
                        "use strict";
                        ${recipeAssignments}
                        ${transformed}
                        if (typeof ${className} !== 'undefined') {
                            return ${className};
                        }
                        return null;
                    })
                `;
                const factory = new Function(wrapped)();
                const recipeClass = factory(recipeDeps);
                if (!recipeClass) continue;

                const resultCount = recipeClass.amount_output || 1;
                const ingredients = recipeClass.recipe || [];
                const shapeless = recipeClass.shapeless === true;

                if (ingredients.length === 0) {
                    console.warn(`[Patchwork] Crafting recipe '${filename}' has no ingredients, skipping`);
                    continue;
                }

                let recipe = null;
                if (shapeless) {
                    recipe = CraftingRegistry.registerShapelessRecipe(resultTypeId, resultCount, ingredients);
                } else {
                    let width = recipeClass.width || 0;
                    let height = recipeClass.height || 0;
                    if (!width || !height) {
                        if (ingredients.length === 1) { width = 1; height = 1; }
                        else if (ingredients.length === 4) { width = 2; height = 2; }
                        else if (ingredients.length === 9) { width = 3; height = 3; }
                        else if (ingredients.length % 3 === 0) { width = 3; height = ingredients.length / 3; }
                        else if (ingredients.length % 2 === 0) { width = 2; height = ingredients.length / 2; }
                        else { width = ingredients.length; height = 1; }
                    }
                    recipe = CraftingRegistry.registerShapedRecipe(resultTypeId, resultCount, width, height, ingredients);
                }
                if (recipe) entry.craftingRecipes.push(recipe);

                console.log(`[Patchwork] Registered crafting recipe for '${namespacedId}' from ${filename}`);
            } catch (err) {
                console.error(`[Patchwork] Failed to load crafting recipe '${filename}' from mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - register smelting recipes
     * ------------------------------------------------------------------ */

    async _registerModSmelting(modId, entry, smeltingFiles, fs = this.filesystem) {
        try {
            const { default: SmeltingRecipe } = await import('./smelting/SmeltingRecipe.js');

            for (const filename of smeltingFiles) {
                try {
                    const src = await fs.loadFile(`mods/${modId}/smelting/${filename}`);
                    if (!src) continue;

                    const filePath = `smelting/${filename}`;
                    const recipeDeps = {};
                    await this._resolveModImports(src, recipeDeps, modId, filePath, new Set([filePath]), fs);

                    let transformed = src.replace(/import\s+.*?from\s+["'][^"']*["']\s*;?/g, '');
                    transformed = transformed.replace(/export\s+default\s+class\s+(\w+)/, 'class $1');

                    const match = transformed.match(/class\s+(\w+)/);
                    if (!match) continue;
                    const className = match[1];

                    // Extract block name: BlockOakTableSmelting -> OakTable
                    let blockName = className;
                    if (blockName.startsWith('Block')) blockName = blockName.substring(5);
                    if (blockName.endsWith('Smelting')) blockName = blockName.slice(0, -8);
                    const blockId = blockName.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
                    const namespacedId = `${modId}:${blockId}`;

                    const resultBlock = BlockRegistry.get(namespacedId);
                    if (!resultBlock) {
                        console.warn(`[Patchwork] Smelting recipe '${filename}' target block '${namespacedId}' not found, skipping`);
                        continue;
                    }
                    const resultTypeId = resultBlock.id;

                    const recipeAssignments = Object.keys(recipeDeps).map(name =>
                        `const ${name} = __deps__["${name}"];`
                    ).join('\n');

                    const wrapped = `
                        return (function(__deps__) {
                            "use strict";
                            ${recipeAssignments}
                            ${transformed}
                            if (typeof ${className} !== 'undefined') {
                                return ${className};
                            }
                            return null;
                        })
                    `;
                    const factory = new Function(wrapped)();
                    const recipeClass = factory(recipeDeps);
                    if (!recipeClass) continue;

                    const inputId = recipeClass.input || 0;
                    const resultCount = recipeClass.amount_output || 1;
                    if (inputId) {
                        const recipe = SmeltingRegistry.registerRecipe(
                            new SmeltingRecipe(inputId, resultTypeId, resultCount)
                        );
                        if (recipe) entry.smeltingRecipes.push(recipe);
                        console.log(`[Patchwork]   Registered smelting recipe for '${namespacedId}' from ${filename}`);
                    }
                } catch (err) {
                    console.error(`[Patchwork] Failed to load smelting recipe '${filename}' from mod '${modId}':`, err);
                }
            }
        } catch (err) {
            console.error(`[Patchwork] Could not import SmeltingRecipe/SmeltingRegistry for mod '${modId}':`, err);
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - register GUI textures into minecraft.resources
     * ------------------------------------------------------------------ */

    async _registerModGuiTextures(modId, entry, fs = this.filesystem) {
        for (const texName of entry.guiTextureNames) {
            try {
                const b64Path = `mods/${modId}/gui_textures/${texName}.png.b64`;
                const b64data = await fs.loadBinaryFile(b64Path);
                if (!b64data) continue;

                const img = await new Promise((resolve, reject) => {
                    const blob = new Blob([b64data], { type: 'image/png' });
                    const url = URL.createObjectURL(blob);
                    const image = new Image();
                    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
                    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Failed to decode GUI texture: ${texName}`)); };
                    image.src = url;
                });

                const resourceKey = `gui/${modId}/${texName}`;
                this.minecraft.resources[resourceKey] = img;
                console.log(`[Patchwork]   Registered GUI texture '${resourceKey}'`);
            } catch (err) {
                console.warn(`[Patchwork] Failed to register GUI texture '${texName}' for mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - dynamically import GUI base classes for mod sandboxing
     * ------------------------------------------------------------------ */

    async _getGuiDeps(modId = null) {
        try {
            const [GuiScreen, GuiContainer, GuiBase, ContainerCls, SlotCls, InventoryBasic, ItemStack, GuiButton] = await Promise.all([
                import('./gui/GuiScreen.js').then(m => m.default),
                import('./gui/screens/GuiContainer.js').then(m => m.default),
                import('./gui/Gui.js').then(m => m.default),
                import('./inventory/Container.js').then(m => m.default),
                import('./inventory/Slot.js').then(m => m.default),
                import('./inventory/inventory/InventoryBasic.js').then(m => m.default),
                import('./item/ItemStack.js').then(m => m.default),
                import('./gui/widgets/GuiButton.js').then(m => m.default),
            ]);

            const BlockClass = await this._getBlockClass();
            const BoundingBoxClass = await this._getBoundingBox();
            const EnumCreativeInventoryTabClass = await this._getEnumCreativeInventoryTab();

            return {
                GuiScreen,
                GuiContainer,
                Gui: GuiBase,
                Container: ContainerCls,
                Slot: SlotCls,
                InventoryBasic,
                ItemStack,
                GuiButton,
                Block: BlockClass,
                BlockRegistry,
                BoundingBox: BoundingBoxClass,
                EnumCreativeInventoryTab: EnumCreativeInventoryTabClass,
                Sound,
                AuthLib,
                Command: modId ? await this._getCommandBaseClass() : undefined,
                ModAPI: modId ? this._getModApi(modId) : undefined,
            };
        } catch (e) {
            console.error('[Patchwork] Could not import GUI classes:', e);
            return { GuiScreen: class EmptyScreen {} };
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - load GUI JS files and store class constructors
     * ------------------------------------------------------------------ */

    async _registerModGuis(modId, entry, guiFiles, fs = this.filesystem) {
        const guiDeps = await this._getGuiDeps(modId);

        for (const filename of guiFiles) {
            try {
                const src = await fs.loadFile(`mods/${modId}/gui/${filename}`);
                if (!src) continue;

                const guiClass = await this._evalClass(src, guiDeps, modId, `gui/${filename}`, fs);
                if (!guiClass) continue;

                const className = guiClass.name || filename.replace('.js', '');
                entry.guiClasses.set(className, guiClass);
                console.log(`[Patchwork] Loaded GUI '${className}' from ${filename}`);
            } catch (err) {
                console.error(`[Patchwork] Failed to load GUI '${filename}' from mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - load commands/*.js and register them in CommandRegistry
     * ------------------------------------------------------------------ */

    /**
     * A commands/CommandSpawnPet.js file is a normal Command subclass:
     *
     *   export default class CommandSpawnPet extends Command {
     *       constructor() { super("spawn_pet", "<type>", "Spawn a pet") }
     *       execute(minecraft, args) { ... return true; }
     *   }
     *
     * The instance is registered in the shared CommandRegistry, so it works
     * both in singleplayer and on the server (which shares the registry and
     * hands each command a per-player `minecraft` adapter).
     */
    async _registerModCommands(modId, entry, commandFiles, fs = this.filesystem) {
        if (commandFiles.length === 0) return;

        const Command = await this._getCommandBaseClass();
        const ModAPI = this._getModApi(modId);
        const deps = { Command, ModAPI, THREE, Sound, BlockRegistry, AuthLib };
        for (const [className, cls] of entry.guiClasses) {
            deps[className] = cls;
        }

        for (const filename of commandFiles) {
            try {
                const src = await fs.loadFile(`mods/${modId}/commands/${filename}`);
                if (!src) continue;

                const CommandClass = await this._evalClass(src, deps, modId, `commands/${filename}`, fs);
                if (!CommandClass) {
                    console.warn(`[Patchwork] No class found in command file '${filename}' of mod '${modId}'`);
                    continue;
                }

                const instance = new CommandClass();
                const registered = this.registerCommand({
                    command: instance.command,
                    usage: instance.usage,
                    description: instance.description,
                    opOnly: !!instance.opOnly,
                    execute: (minecraft, args) => instance.execute(minecraft, args),
                    modId
                });

                entry.commandNames.push(registered.command);
                console.log(`[Patchwork]   Registered command '/${registered.command}' from ${filename}`);
            } catch (err) {
                console.error(`[Patchwork] Failed to load command '${filename}' from mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - load tabs/*.js and register custom creative tabs
     * ------------------------------------------------------------------ */

    /**
     * A tabs/TabMyItems.js file should export a class with static properties:
     *
     *   export default class TabMyItems {
     *       static NAME = "My Items";
     *       static ICON_BLOCK_ID = "minecraft:stone";  // or "modId:block_name"
     *   }
     *
     * The tab will be added to the creative inventory with the specified icon.
     */
    async _registerModTabs(modId, entry, tabFiles, fs = this.filesystem) {
        if (tabFiles.length === 0) return;

        const ModAPI = this._getModApi(modId);
        const deps = { ModAPI, BlockRegistry };

        for (const filename of tabFiles) {
            try {
                const src = await fs.loadFile(`mods/${modId}/tabs/${filename}`);
                if (!src) continue;

                const TabClass = await this._evalClass(src, deps, modId, `tabs/${filename}`, fs);
                if (!TabClass) {
                    console.warn(`[Patchwork] No class found in tab file '${filename}' of mod '${modId}'`);
                    continue;
                }

                const name = TabClass.NAME || 'Unnamed Tab';
                const iconBlockId = TabClass.ICON_BLOCK_ID;

                if (!iconBlockId) {
                    console.warn(`[Patchwork] Tab '${name}' from mod '${modId}' missing ICON_BLOCK_ID, skipping`);
                    continue;
                }

                this.registerCustomTab(modId, name, iconBlockId);
                console.log(`[Patchwork]   Registered custom tab '${name}' from ${filename}`);
            } catch (err) {
                console.error(`[Patchwork] Failed to load tab '${filename}' from mod '${modId}':`, err);
            }
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - call ModLoad.onLoad if present
     * ------------------------------------------------------------------ */

    async _callModLoad(modId, entry, fs = this.filesystem) {
        try {
            const src = await fs.loadFile(`mods/${modId}/ModLoad.js`);
            if (!src) return;

            const GuiButton = (await import('./gui/widgets/GuiButton.js')).default;
            const GuiScreen = (await import('./gui/GuiScreen.js')).default;
            const modDeps = { Sound, THREE, GuiButton, GuiScreen, ModelRenderer, Tessellator, AuthLib, ModAPI: this._getModApi(modId) };
            await this._resolveModImports(src, modDeps, modId, 'ModLoad.js', new Set(['ModLoad.js']), fs);

            let transformed = src.replace(/import\s+.*?from\s+["'][^"']*["']\s*;?/g, '');
            transformed = transformed.replace(/export\s+default\s+class\s+(\w+)/, 'class $1');

            const modLoadAssignments = Object.keys(modDeps).map(name =>
                `const ${name} = __deps__["${name}"];`
            ).join('\n');

            const wrapped = `
                return (function(__deps__) {
                    "use strict";
                    ${modLoadAssignments}
                    ${transformed}
                    if (typeof ModLoad !== 'undefined' && ModLoad.onLoad) {
                        return ModLoad;
                    }
                    return null;
                })
            `;

            const factory = new Function(wrapped)();
            const modLoadClass = factory(modDeps);
            if (modLoadClass && typeof modLoadClass.onLoad === 'function') {
                modLoadClass.onLoad(this.minecraft.world, this.minecraft, this);
                console.log(`[Patchwork]   Called ModLoad.onLoad for '${modId}'`);
            }
        } catch (err) {
            console.warn(`[Patchwork] Failed to load ModLoad.js for '${modId}':`, err);
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - eval a class from source string with provided dependencies
     * ------------------------------------------------------------------ */

    /**
     * Evaluate a class source string and return the constructor.
     * Strips all imports and provides the named classes from the deps map.
     * Relative imports that resolve to other files in the same mod are loaded
     * and evaluated automatically, and their exports are injected into deps.
     *
     * @param {string} source  - JavaScript source with `export default class`
     * @param {Object<string, Function>} deps  - map of variable names to actual classes
     * @param {string|null} modId  - id of the mod the file belongs to (for same-mod imports)
     * @param {string|null} filePath  - mod-relative path of the file (e.g. 'blocks/BlockFoo.js')
     * @param {object} fs  - filesystem to read from
     * @returns {Function|null}
     */
    async _evalClass(source, deps, modId = null, filePath = null, fs = this.filesystem) {
        const localDeps = { ...deps };

        if (modId && filePath) {
            await this._resolveModImports(source, localDeps, modId, filePath, new Set([filePath]), fs);
        }

        // Strip all imports
        let transformed = source.replace(
            /import\s+.*?from\s+["'][^"']*["']\s*;?/g,
            ''
        );

        // Remove `export default` so we can capture the class
        transformed = transformed.replace(/export\s+default\s+class\s+(\w+)/, 'class $1');

        // Build variable assignments from provided classes
        const assignments = Object.keys(localDeps).map(name =>
            `const ${name} = __deps__["${name}"];`
        ).join('\n');

        const wrapped = `
            return (function(__deps__) {
                "use strict";
                ${assignments}
                ${transformed}
                return ${this._extractClassName(source)} || null;
            })
        `;

        try {
            const factory = new Function(wrapped)();
            return factory(localDeps);
        } catch (err) {
            console.error('[Patchwork] Class eval error:', err);
            return null;
        }
    }

    /**
     * Extract the class name from 'export default class BlockFoo ...'
     */
    _extractClassName(source) {
        const match = source.match(/export\s+default\s+class\s+(\w+)/);
        return match ? match[1] : null;
    }

    /* ------------------------------------------------------------------
     *  Internal - same-mod imports
     * ------------------------------------------------------------------ */

    /**
     * Parse import statements from a source string.
     * Handles default, named and namespace imports.
     *
     * @param {string} source
     * @returns {Array<{specifier: string, defaultName: string|null, namedNames: string[], namespace: string|null}>}
     */
    _parseImports(source) {
        const imports = [];
        const re = /import\s+([\s\S]*?)\s+from\s+["']([^"']+)["']\s*;?/g;
        let match;
        while ((match = re.exec(source)) !== null) {
            const clause = match[1].trim();
            const specifier = match[2];
            const imp = { specifier, defaultName: null, namedNames: [], namespace: null };

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

    /**
     * Resolve a relative import specifier against the importing file's
     * mod-relative path. Returns a normalized mod-relative path, or null if
     * the specifier would escape the mod directory (game code, provided via deps).
     *
     * @param {string} fromPath  - mod-relative path of the importing file
     * @param {string} specifier - relative import path from the source
     * @returns {string|null}
     */
    _resolveImportPath(fromPath, specifier) {
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

        if (base.length === 0) return null;
        return base.join('/');
    }

    /**
     * Resolve all same-mod imports in a source string, loading and evaluating
     * the imported mod files and injecting their exports into the deps map.
     * Imports that point outside the mod (game classes) are left for deps.
     *
     * @param {string} source
     * @param {Object<string, Function>} deps  - mutated in place
     * @param {string} modId
     * @param {string} filePath  - mod-relative path of the importing file
     * @param {Set<string>} stack  - files currently being processed (cycle detection)
     * @param {object} fs  - filesystem to read from
     */
    async _resolveModImports(source, deps, modId, filePath, stack, fs = this.filesystem) {
        for (const imp of this._parseImports(source)) {
            if (!imp.specifier) continue;

            // Bare specifiers (e.g. `import Explosive from "Explosive.js"`) are
            // treated as files in the importing file's own directory.
            const specifier = imp.specifier.startsWith('.')
                ? imp.specifier
                : `./${imp.specifier}`;

            const resolved = this._resolveImportPath(filePath, specifier);
            if (!resolved) continue;

            const exportsObj = await this._loadModModule(modId, resolved, deps, stack, fs);
            if (!exportsObj) continue;

            if (imp.namespace) {
                deps[imp.namespace] = exportsObj;
            } else {
                if (imp.defaultName) deps[imp.defaultName] = exportsObj.__default;
                for (const name of imp.namedNames) {
                    if (exportsObj[name] !== undefined) deps[name] = exportsObj[name];
                }
            }
        }
    }

    /**
     * Load and evaluate a module file from the same mod, resolving its own
     * imports recursively. Results are cached per mod file.
     *
     * @param {string} modId
     * @param {string} filePath  - mod-relative path of the module file
     * @param {Object<string, Function>} deps
     * @param {Set<string>} stack
     * @param {object} fs  - filesystem to read from
     * @returns {Promise<Object|null>}  exports object: { __default, ...named }
     */
    async _loadModModule(modId, filePath, deps, stack, fs = this.filesystem) {
        const cacheKey = `${modId}/${filePath}`;
        if (this._modModuleCache.has(cacheKey)) return this._modModuleCache.get(cacheKey);
        if (stack.has(filePath)) return null;

        stack.add(filePath);
        let result = null;
        try {
            const src = await fs.loadFile(`mods/${modId}/${filePath}`);
            if (src) {
                result = await this._evalModModule(src, deps, modId, filePath, stack, fs);
            }
        } catch (err) {
            console.error(`[Patchwork] Failed to load mod module '${filePath}' from mod '${modId}':`, err);
        }
        stack.delete(filePath);

        if (result) this._modModuleCache.set(cacheKey, result);
        return result;
    }

    /**
     * Evaluate a mod module file (with exports) in a sandbox with deps.
     *
     * @param {string} source
     * @param {Object<string, Function>} deps
     * @param {string} modId
     * @param {string} filePath
     * @param {Set<string>} stack
     * @param {object} fs  - filesystem to read from
     * @returns {Promise<Object|null>}  exports object: { __default, ...named }
     */
    async _evalModModule(source, deps, modId, filePath, stack, fs = this.filesystem) {
        const modDeps = { ...deps };
        await this._resolveModImports(source, modDeps, modId, filePath, stack, fs);

        const { transformed, defaultName, namedNames } = this._transformModuleExports(source);

        const assignments = Object.keys(modDeps).map(name =>
            `const ${name} = __deps__["${name}"];`
        ).join('\n');

        const namedProps = namedNames.map(n => `"${n}": ${n}`).join(',');
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

        try {
            const factory = new Function(wrapped)();
            return factory(modDeps);
        } catch (err) {
            console.error(`[Patchwork] Mod module eval error ('${filePath}'):`, err);
            return null;
        }
    }

    /**
     * Transform a module source so it can run in a plain function scope,
     * capturing default and named exports.
     *
     * @param {string} source
     * @returns {{transformed: string, defaultName: string|null, namedNames: string[]}}
     */
    _transformModuleExports(source) {
        let transformed = source.replace(
            /import\s+[\s\S]*?from\s+["'][^"']*["']\s*;?/g,
            ''
        );
        transformed = transformed.replace(/import\s+["'][^"']*["']\s*;?/g, '');

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

    /* ------------------------------------------------------------------
     *  Internal - read ModData from ZIP
     * ------------------------------------------------------------------ */

    async _readModDataFromZip(zip) {
        let modDataSrc = null;

        for (const [path, entry] of Object.entries(zip.files)) {
            if (path === 'ModData.js' || path.endsWith('/ModData.js')) {
                modDataSrc = await entry.async('string');
                break;
            }
        }

        if (!modDataSrc) {
            throw new Error('ModData.js not found in the ZIP archive.');
        }

        return this._parseModDataSource(modDataSrc);
    }

    /**
     * Parse ModData.js source and extract static properties. NAME, ID, AUTHOR
     * and VERSION are required by every mod; DESCRIPTION and LICENSE are
     * optional and are returned as empty strings when undeclared.
     */
    _parseModDataSource(source) {
        let cleaned = source.replace(/export\s+default\s+class\s+\w+\s*\{/, '{');
        cleaned = cleaned.replace(/import\s+.*?from\s+["'][^"']*["']\s*;?/g, '');
        cleaned = cleaned.replace(/\}\s*;?\s*$/, '}');
        cleaned = cleaned.replace(/static\s+(\w+)\s*=/g, '$1 =');

        // Optional fields are read defensively: referencing an undeclared
        // identifier would throw and lose NAME/ID for the whole mod.
        const wrapped = `return (function() { ${cleaned} return { NAME, ID, AUTHOR, VERSION,`
            + ` DESCRIPTION: typeof DESCRIPTION === 'undefined' ? '' : DESCRIPTION,`
            + ` LICENSE: typeof LICENSE === 'undefined' ? '' : LICENSE }; })()`;
        try {
            return new Function(wrapped)();
        } catch (err) {
            console.error('[Patchwork] ModData parse error:', err);
            return { NAME: 'Unknown', ID: 'unknown', AUTHOR: 'Unknown', VERSION: '0.0.0' };
        }
    }

    /* ------------------------------------------------------------------
     *  Internal - utilities
     * ------------------------------------------------------------------ */

    /**
     * Convert a Block class name to a snake_case block ID.
     * BlockUnbreakableBlock -> UnbreakableBlock -> unbreakable_block
     */
    static classToBlockId(className) {
        let name = className;
        if (name.startsWith('Block')) {
            name = name.substring(5);
        }
        return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    }

    /**
     * Convert an Item class name to a snake_case item ID.
     * ItemTestItem -> TestItem -> test_item
     */
    static classToItemId(className) {
        let name = className;
        if (name.startsWith('Item')) {
            name = name.substring(4);
        }
        return name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
    }

    /**
     * Dynamically import the Block base class.
     */
    async _getCommandBaseClass() {
        if (!this._commandBaseClass) {
            const mod = await import('./command/Command.js');
            this._commandBaseClass = mod.default;
        }
        return this._commandBaseClass;
    }

    async _getBlockClass() {
        if (this._blockBaseClass) return this._blockBaseClass;
        if (window.__ModBlockClass__) {
            this._blockBaseClass = window.__ModBlockClass__;
            if (!this._boundingBoxClass) {
                try {
                    const bbMod = await import('../util/BoundingBox.js');
                    this._boundingBoxClass = bbMod.default;
                } catch (e) {}
            }
            return this._blockBaseClass;
        }
        try {
            const [mod, bbMod] = await Promise.all([
                import('./world/block/Block.js'),
                import('../util/BoundingBox.js')
            ]);
            this._blockBaseClass = mod.default;
            this._boundingBoxClass = bbMod.default;
            window.__ModBlockClass__ = this._blockBaseClass;
            return this._blockBaseClass;
        } catch (e) {
            console.error('[Patchwork] Could not import Block class:', e);
            return class EmptyBlock {};
        }
    }

    async _getBoundingBox() {
        if (this._boundingBoxClass) return this._boundingBoxClass;
        await this._getBlockClass();
        if (this._boundingBoxClass) return this._boundingBoxClass;
        try {
            const bbMod = await import('../util/BoundingBox.js');
            this._boundingBoxClass = bbMod.default;
            return this._boundingBoxClass;
        } catch (e) {
            console.error('[Patchwork] Could not import BoundingBox class:', e);
            return class EmptyBoundingBox {};
        }
    }

    async _getEnumBlockFace() {
        if (this._enumBlockFaceClass) return this._enumBlockFaceClass;
        try {
            const mod = await import('../util/EnumBlockFace.js');
            this._enumBlockFaceClass = mod.default;
            return this._enumBlockFaceClass;
        } catch (e) {
            console.error('[Patchwork] Could not import EnumBlockFace class:', e);
            return class EmptyFace {};
        }
    }

    async _getEnumCreativeInventoryTab() {
        if (this._enumCreativeInventoryTabClass) return this._enumCreativeInventoryTabClass;
        try {
            const mod = await import('./gui/EnumCreativeInventoryTab.js');
            this._enumCreativeInventoryTabClass = mod.default;
            return this._enumCreativeInventoryTabClass;
        } catch (e) {
            console.error('[Patchwork] Could not import EnumCreativeInventoryTab class:', e);
            return class EmptyEnumCreativeInventoryTab {};
        }
    }

    /**
     * Dynamically import item base classes for mod sandboxing.
     */
    async _getItemClasses(modId = null) {
        const BlockClass = await this._getBlockClass();
        const BoundingBoxClass = await this._getBoundingBox();
        const EnumCreativeInventoryTabClass = await this._getEnumCreativeInventoryTab();
        try {
            const itemMod = await import('./world/block/Item.js');
            const genericMod = await import('./world/block/type/ItemGeneric.js');
            const edibleMod = await import('./world/block/ItemEdible.js');
            const toolMod = await import('./world/block/type/ItemTool.js');
            return {
                Block: BlockClass,
                BlockRegistry,
                BoundingBox: BoundingBoxClass,
                Item: itemMod.default,
                ItemGeneric: genericMod.default,
                ItemEdible: edibleMod.default,
                ItemTool: toolMod.default,
                EnumCreativeInventoryTab: EnumCreativeInventoryTabClass,
                THREE,
                Sound,
                AuthLib,
                Command: modId ? await this._getCommandBaseClass() : undefined,
                ModAPI: modId ? this._getModApi(modId) : undefined
            };
        } catch (e) {
            console.error('[Patchwork] Could not import Item classes:', e);
            return { Block: BlockClass, BlockRegistry, BoundingBox: BoundingBoxClass, Item: class EmptyItem extends BlockClass {} };
        }
    }

    /**
     * Ensure JSZip is loaded.
     */
    async _ensureJSZip() {
        return loadJSZip();
    }

    async _arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    }

    /* ------------------------------------------------------------------
     *  Internal - persistence of enabled set
     * ------------------------------------------------------------------ */
/**
     * The read-only view of the physical `mods/` folder, or null when running
     * outside Electron (the preload bridge is simply absent in the browser).
     */
    _getDiskFilesystem() {
        if (!BridgeFilesystem.isAvailable()) return null;
        if (!this._diskFilesystem) {
            this._diskFilesystem = new BridgeFilesystem({
                bridge: window.modsBridge,
                modDataParser: (source) => this._parseModDataSource(source)
            });
        }
        return this._diskFilesystem;
    }

    /**
     * Load every enabled mod - both ZIPs installed into IndexedDB and folders
     * in the physical mods/ directory - and register their content.
     * Call this once during game startup, after BlockRegistry.create().
     */
    async loadAllMods() {
        await this._loadEnabledSet();

        const modIds = await this.getInstalledModIds();
        const disk = this._getDiskFilesystem();
        if (disk) {
            console.log(`[Patchwork] Scanning mods/ folder: ${(await disk.getModIds()).length} mod(s) found on disk`);
        }
        console.log(`[Patchwork] Found ${modIds.length} installed mod(s)`);

        for (const modId of modIds) {
            if (!this.enabledMods.has(modId)) continue;
            try {
                await this._loadMod(modId, await this._fsForMod(modId));
            } catch (err) {
                console.error(`[Patchwork] Failed to load mod '${modId}':`, err);
            }
        }

        console.log(`[Patchwork] ${this.mods.size} mod(s) loaded successfully`);
    }

    /**
     * Get metadata for all installed mods, including the optional description,
     * license and the root icon.png (as a data URL) the Mods screen renders.
     * @returns {Promise<Array<{id:string, name:string, author:string, version:string,
     *   description:string, license:string, icon:string|null, enabled:boolean}>>}
     */
    async getInstalledMods() {
        await this._loadEnabledSet(); // Ensure set is populated before querying status
        const modIds = await this.getInstalledModIds();
        const result = [];
        for (const modId of modIds) {
            try {
                const fs = await this._fsForMod(modId);
                const raw = await fs.loadFile(`mods/${modId}/ModData.json`);
                if (!raw) continue;
                const meta = JSON.parse(raw);
                const actualId = meta.ID || modId;

                result.push({
                    id: actualId,
                    name: meta.NAME || 'Unknown',
                    author: meta.AUTHOR || 'Unknown',
                    version: meta.VERSION || '0.0.0',
                    description: typeof meta.DESCRIPTION === 'string' ? meta.DESCRIPTION : '',
                    license: typeof meta.LICENSE === 'string' ? meta.LICENSE : '',
                    icon: await this.loadModIcon(actualId, fs),
                    enabled: (this.enabledMods.has(actualId) || this.enabledMods.has(modId))
                        && !this._temporaryDisabledModIds.has(modId)
                        && !this._temporaryDisabledModIds.has(actualId),
                    // Folder in the physical mods/ directory rather than an
                    // installed ZIP; the GUI uses this to hide Delete.
                    disk: fs !== this.filesystem
                });
            } catch (e) {
                console.warn(`[Patchwork] Could not read metadata for '${modId}':`, e);
            }
        }
        return result;
    }

    /* ------------------------------------------------------------------
     *  Internal - persistence of enabled set
     * ------------------------------------------------------------------ */

    async _loadEnabledSet() {
        try {
            this._loadDisabledSet();

            const stored = localStorage.getItem(ENABLED_MODS_KEY);
            if (stored !== null) {
                const arr = JSON.parse(stored);
                this.enabledMods = new Set(arr);
            } else {
                // First boot ever: treat all installed mods as enabled by default
                const modIds = await this.getInstalledModIds();
                this.enabledMods = new Set(modIds);
                this._saveEnabledSet();
            }

            // A mod installed from the wiki lands in mods/ as a folder, and
            // this enabled set was written before it existed. Enable it
            // unless the user has since switched it off - without this a
            // deep-link install would need a manual enable every time.
            const disk = this._getDiskFilesystem();
            if (disk) {
                for (const modId of await disk.getModIds()) {
                    if (this._disabledMods.has(modId)) continue;
                    if (!(await disk.isWikiInstalled(modId))) continue;
                    if (!this.enabledMods.has(modId)) {
                        this.enabledMods.add(modId);
                        this._saveEnabledSet();
                    }
                }
            }
        } catch (e) {
            this.enabledMods = new Set();
        }
    }

    _loadDisabledSet() {
        try {
            const stored = localStorage.getItem(DISABLED_MODS_KEY);
            this._disabledMods = new Set(stored ? JSON.parse(stored) : []);
        } catch (e) {
            this._disabledMods = new Set();
        }
    }

    _saveDisabledSet() {
        try {
            localStorage.setItem(DISABLED_MODS_KEY, JSON.stringify([...this._disabledMods]));
        } catch (e) {
            console.warn('[Patchwork] Could not save disabled mods:', e);
        }
    }

    _saveEnabledSet() {
        try {
            localStorage.setItem(ENABLED_MODS_KEY, JSON.stringify([...this.enabledMods]));
        } catch (e) {
            console.warn('[Patchwork] Could not save enabled mods:', e);
        }
    }
}

/**
 * In-memory filesystem backing temporarily-loaded dev mods. Implements the
 * subset of FileSystem used by the mod loading pipeline (loadFile,
 * loadBinaryFile, listDir) and never persists anything.
 */
class MemoryFilesystem {
    constructor(fileMap) {
        this.fileMap = fileMap; // Map<path, string | Uint8Array>
    }

    async loadFile(filename) {
        const value = this.fileMap.get(filename);
        return typeof value === 'string' ? value : null;
    }

    async loadBinaryFile(filename) {
        const value = this.fileMap.get(filename);
        if (value instanceof Uint8Array) return value;
        if (typeof value === 'string') {
            try {
                const bin = atob(value);
                const u8 = new Uint8Array(bin.length);
                for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
                return u8;
            } catch (e) {
                return null;
            }
        }
        return null;
    }

    async listDir(dir = '') {
        let prefix = dir.trim();
        if (prefix.length > 0 && !prefix.endsWith('/')) prefix += '/';
        return [...this.fileMap.keys()].filter(f => f.startsWith(prefix));
    }
}

/**
 * @typedef {Object} ModEntry
 * @property {string} id
 * @property {string} name
 * @property {string} author
 * @property {string} version
 * @property {string[]} blockIds
 * @property {Map<string, Function>} blockClasses
 * @property {string[]} itemIds
 * @property {Map<string, Function>} itemClasses
 * @property {Map<string, Function>} guiClasses
 * @property {string[]} guiTextureNames
 * @property {string[]} textureNames
 * @property {string[]} soundNames
 */
