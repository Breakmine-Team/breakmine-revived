import Timer from "../util/Timer.js";
import GameSettings from "./GameSettings.js";
import GameWindow from "./GameWindow.js";
import Keyboard from "../util/Keyboard.js";
import WorldRenderer from "./render/WorldRenderer.js";
import RoadBuilder from "./roadbuilder/RoadBuilder.js";
import ScreenRenderer from "./render/gui/ScreenRenderer.js";
import ItemRenderer from "./render/gui/ItemRenderer.js";
import IngameOverlay from "./gui/overlay/IngameOverlay.js";
import SoundManager from "./sound/SoundManager.js";
import Sound from "./sound/Sound.js";
import MusicManager from "./sound/MusicManager.js";
import Block from "./world/block/Block.js";
import ItemTool from "./world/block/type/ItemTool.js";
import BoundingBox from "../util/BoundingBox.js";
import {BlockRegistry} from "./world/block/BlockRegistry.js";
import {BiomeRegistry} from "./world/biome/BiomeRegistry.js";
import FontRenderer from "./render/gui/FontRenderer.js";
import GrassColorizer from "./render/GrassColorizer.js";
import ModLoader from "./ModLoader.js";
import CapeManager from "./render/CapeManager.js";
import GuiMainMenu from "./gui/screens/GuiMainMenu.js";
import GuiLoadingScreen from "./gui/screens/GuiLoadingScreen.js";
import GuiLoadingIntegratedServer from "./gui/screens/GuiLoadingIntegratedServer.js";
import * as THREE from "../../../../../libraries/three.module.js";
import ParticleRenderer from "./render/particle/ParticleRenderer.js";
import ClientDropItemPacket from "./network/packet/play/client/ClientDropItemPacket.js";
import GuiChat from "./gui/screens/GuiChat.js";
import CommandHandler from "./command/CommandHandler.js";
import GuiContainerCreative from "./gui/screens/container/GuiContainerCreative.js";
import GameProfile from "../util/GameProfile.js";
import UUID from "../util/UUID.js";
import FocusStateType from "../util/FocusStateType.js";
import Session from "../util/Session.js";
import PlayerControllerMultiplayer from "./network/controller/PlayerControllerMultiplayer.js";
import NetworkManager from "./network/NetworkManager.js";
import VoiceChatManager from "./network/VoiceChatManager.js";
import NetworkLoginHandler from "./network/handler/NetworkLoginHandler.js";
import HandshakePacket from "./network/packet/handshake/client/HandshakePacket.js";
import ProtocolState from "./network/ProtocolState.js";
import LoginStartPacket from "./network/packet/login/client/LoginStartPacket.js";
import { startIntegratedServer, stopIntegratedServer, isIntegratedRunning, getIntegratedServerName, deleteServerWorld, serverNameForKey, listServerWorlds, saveWorldIcon } from "./integrated/IntegratedServer.js";
import ChunkProviderGenerateWorker from "./world/provider/ChunkProviderGenerateWorker.js";
import FileSystem from "./fs/Filesystem.js";
import Chunk from "./world/Chunk.js";
import World from "./world/World.js";
import PlayerController from "./network/controller/PlayerController.js";
import generateUsername from "./UsernameGenerator.js";
import Vector3 from "../util/Vector3.js";
import MathHelper from "../util/MathHelper.js";
import InventoryBasic from "./inventory/inventory/InventoryBasic.js";
import BlockPosition from "../util/BlockPosition.js";
import GuiPlayerInventory from "./gui/screens/container/GuiPlayerInventory.js";
import CraftingRegistry from "./crafting/CraftingRegistry.js";
import SmeltingRegistry from "./smelting/SmeltingRegistry.js";
import GuiPrelaunch from "./gui/screens/GuiPrelaunch.js";
import GuiFunctions from "./gui/screens/GuiFunctions.js";
import ItemEntity from "./entity/ItemEntity.js";
import PlayerEntity from "./entity/PlayerEntity.js";
import { Version } from "../../../../resources/version.js";
import { createErrorWindow } from './gui/WindowDraggable.js';
import * as AuthLib from "./network/AuthLib.js";
import { TunnelLib } from "../util/TunnelLib.js";
import I18n from "./i18n/I18n.js";

export default class Minecraft {

    static VERSION = Version.VERSION;
    static TIMESTAMP = Version.TIMESTAMP;
    static PATCHWORK_VERSION = Version.PATCHWORK_VERSION;
    static URL_GITHUB = "https://codeberg.org/BreakmineDevelopers/breakmine_revived";
    static PROTOCOL_VERSION = 47; //758;

    // TODO Add to settings
    static PROXY = {
        "url": "ws://127.0.0.1:25565"
    };

    /**
     * Create Minecraft instance and render it on a canvas
     */
    constructor(canvasWrapperId, resources) {
        this.resources = resources;

        this.currentScreen = null;
        this.loadingScreen = null;
        this.world = null;
        this.player = null;
        this.currentWorldKey = null;
        // 256x256 world-select screenshots are captured on exit and stored on
        // the world's index entry (see _captureWorldIcon).
        // Seed of the world handed to the in-page integrated server. Singleplayer
        // runs through that server, so the client world is a WorldClient with a
        // ChunkProviderClient that has no generator to read a seed from.
        this.currentWorldSeed = null;
        // True while the client is connected to the in-page integrated server
        // (loopback). isSingleplayer() is false there because singleplayer also
        // uses PlayerControllerMultiplayer, so local sessions need their own flag.
        this.isConnectedToIntegratedServer = false;
        this.playerController = null;
        // Gameplay rules pushed by a multiplayer server. Singleplayer and
        // servers that do not send rules keep the normal behavior.
        this.serverRules = { allowTNT: true, allowLiquidFlow: true };
        this.fps = 0;
        this.maxFps = 0;

        // Tick timer
        this.timer = new Timer(20);

        this.settings = new GameSettings();
        this.settings.load();
        this.settings.language = I18n.setLanguage(this.settings.language);

        AuthLib.setApiBaseUrl(this.settings.apiUrl);

        // Auto-detect Smart TV platform and enable TV mode on first visit
        if (!this.settings.tvmode && !document.cookie.includes('tvmode=')) {
            let ua = window.navigator.userAgent;
            if (/Tizen|SMART-TV|SmartTV/i.test(ua) && !/Mobile|Nexus|SM-/i.test(ua)) {
                this.settings.tvmode = true;
                this.settings.save();
            } else if (/webOS|Web0S|Roku|AFTS|AFTB|AFTM|AFTT|AFTKA|FireTV|GoogleTV|Android TV|Large Screen|VIDAA|Viera|NetCast/i.test(ua)) {
                this.settings.tvmode = true;
                this.settings.save();
            }
        }

        // Load session from settings
        if (this.settings.session === null) {
            if (!this.settings.username) this.loggedIn = false;
            let username = this.settings.username || generateUsername();
            let profile = new GameProfile(UUID.randomUUID(), username);
            this.setSession(new Session(profile, ""));
        } else {
            this.setSession(Session.fromJson(this.settings.session));
        }

        // Create window and world renderer
        this.window = new GameWindow(this, canvasWrapperId);

        // Create renderers
        this.worldRenderer = new WorldRenderer(this, this.window);
        this.screenRenderer = new ScreenRenderer(this, this.window);
        this.itemRenderer = new ItemRenderer(this, this.window);

        // Create current screen and overlay
        this.ingameOverlay = new IngameOverlay(this, this.window);

        // Command handler
        this.commandHandler = new CommandHandler(this);

        this.frames = 0;
        this.lastTime = Date.now();

        // Create all blocks
        BlockRegistry.create();
        BiomeRegistry.create();
        CraftingRegistry.reset();
        SmeltingRegistry.reset();

        this.blockList = BlockRegistry.getAllBlocks();
        this.roadBuilder = new RoadBuilder(this);

        // Expose Block class globally for mod sandboxing
        window.__ModBlockClass__ = Block;

        // Expose live game state on window for external tooling/remote support
        this.initGameState();

        // Mixin: allow mods to register custom blocks
        this.registerBlockClass = (id, name, blockClass) => {
            return BlockRegistry.registerBlockClass(id, name, blockClass);
        };

        // Create mod loader and expose it
        this.modLoader = new ModLoader(this);

        // Per-player capes advertised by the server (JSON channel)
        this.capeManager = new CapeManager(this);

        this.tunnelLib = new TunnelLib(this.settings.tunnelServer);

        // Tools are registered in BlockRegistry.create() alongside blocks and items

        this.blockList = BlockRegistry.getAllBlocks();

        this.itemRenderer.initialize();

        // Create font renderer
        this.fontRenderer = new FontRenderer(this);

        // Grass colorizer
        this.grassColorizer = new GrassColorizer(this);

        this.particleRenderer = new ParticleRenderer(this);

        // Update window size
        this.window.updateWindowSize();

        // Create sound manager
        this.soundManager = new SoundManager();
        this.musicManager = new MusicManager();

        // Create P2P voice chat (push-to-talk)
        this.voiceChat = new VoiceChatManager(this);

        // Wire up the Patchwork Sound API
        Sound.init(this);

        // Create filesystem for texture packs
        this.filesystem = new FileSystem('TexturePackDB', 'texture_packs');

        // If in prelaunch mode; display the menu for it instead
        if (window.isPreLaunch) {
            console.log("Prelaunch mode; game won't start until menu is exited.");
            this.displayScreen(new GuiPrelaunch(this));
        } else {
            this.displayScreen(new GuiMainMenu());
        }

        // Create Filesystem
        this.fs = new FileSystem();

        // World save state
        this.lastSaveTime = Date.now();
        this.saveInterval = 30000;

        // Create various player properties
        this.miningTimer = 0;
        this.maxMiningTicks = 30;
        this.lastBlockPos = null;
        this.isMining = false;
        this.miningProgress = 0;

        // Loading screen timeout tracking
        this.lastChunkCount = 0;
        this.lastChunkArrivalTime = 0;

        // Initialize
        this.init();

        // Mixins
        this.addMixinHandlers();
    }

    async shareWorld() {
        let code = await this.tunnelLib.createTunnel("ws://loopback");
        this.addMessageToChat("Share code: " + code);
    }
    
    addMixinHandlers() {
        // src/js/net/minecraft/client/Minecraft.js

        // src/js/net/minecraft/client/world/World.js
        Mixin.registerFunction('game:teleportEntityPos', (eid, x, y, z) => {
            if (this.world && this.world.getEntityById(eid)) {
                this.world.getEntityById(eid).setPosition(x, y, z);
                return true;
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getEntityPos', (eid) => {
            if (this.world && this.world.getEntityById(eid)) {
                return {
                    x: this.world.getEntityById(eid).x,
                    y: this.world.getEntityById(eid).y,
                    z: this.world.getEntityById(eid).z
                };
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:setBlockAt', (x, y, z, id) => {
            if (this.world) {
                this.world.setBlockAt(x, y, z, id);
                return true;
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getBlockAt', (x, y, z) => {
            if (this.world) {
                return this.world.getBlockAt(x, y, z);
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:setBlockDataAt', (x, y, z, data) => {
            if (this.world) {
                this.world.setBlockDataAt(x, y, z, data);
                return true;
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getBlockDataAt', (x, y, z) => {
            if (this.world) {
                return this.world.getBlockDataAt(x, y, z);
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getWorld', () => {
            if (this.world) {
                return this.world;
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getGame', () => {
            if (this) {
                return this;
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getEntityById', (eid) => {
            if (this.world && this.world.getEntityById(eid)) {
                return this.world.getEntityById(eid);
            } else {
                return undefined;
            }
        });

        Mixin.registerFunction('game:getPlayer', () => {
            if (this.player) {
                return this.player;
            } else {
                return undefined;
            }
        });

        // Patchwork: info about the block under the crosshair
        Mixin.registerFunction('game:getLookedAtBlock', (reach = 5) => {
            if (!this.world || !this.player) {
                return undefined;
            }

            const hit = this.player.rayTrace(reach, this.timer.partialTicks);
            if (!hit) {
                return null;
            }

            // Summoned off-grid structures are addressed with local coordinates.
            const field = hit.fieldCell && this.world.offGridField;
            const typeId = field
                ? field.getBlockAt(hit.x, hit.y, hit.z)
                : this.world.getBlockAt(hit.x, hit.y, hit.z);
            if (!typeId) {
                return null;
            }

            const block = BlockRegistry.get(typeId) || Block.getById(typeId);
            if (!block) {
                return null;
            }

            const rawDescription = typeof block.getDescription === 'function' ? block.getDescription() : null;
            const description = rawDescription ? String(rawDescription) : '';
            const fallbackName = block.name || block.identifier || String(typeId);

            return {
                name: description.split(/\r?\n/)[0].trim() || fallbackName,
                namespace: block.namespace || BlockRegistry.DEFAULT_NAMESPACE,
                id: typeId,
                text_id: block.identifier || `${block.namespace || BlockRegistry.DEFAULT_NAMESPACE}:${fallbackName}`,
                description: description || fallbackName
            };
        });

        // Mod loader mixin functions
        Mixin.registerFunction('mod:list', () => {
            if (this.modLoader) {
                return [...this.modLoader.mods.keys()];
            }
            return [];
        });

        Mixin.registerFunction('mod:isEnabled', (modId) => {
            return this.modLoader ? this.modLoader.enabledMods.has(modId) : false;
        });

        Mixin.registerFunction('mod:getBlock', (modId, blockId) => {
            const namespacedId = `${modId}:${blockId}`;
            if (this.modLoader) {
                const entry = this.modLoader.getMod(modId);
                if (entry) {
                    return entry.blockClasses.get(namespacedId);
                }
            }
            return undefined;
        });

        Mixin.registerFunction('mod:getLoader', () => {
            return this.modLoader;
        });
    }

    newSessionFromUsername(username) {
        let profile = new GameProfile(UUID.randomUUID(), username);
        this.setSession(new Session(profile, ""), true);
    }

    init() {
        // Start render loop
        this.running = true;
        this.requestNextFrame();
    }

    async loadWorld(world) {
        this.miningTimer = 0;
        this.lastBlockPos = null;
        this.musicManager.stopMusic();

        if (world === null) {
            // Store a preview for the world-select list. This has to happen
            // before the teardown below, while the world and its renderer are
            // still alive, because the image is read from the rendered frame.
            if (this.world !== null && this.currentWorldKey && this.isLocalSession()) {
                const icon = this._captureWorldIcon();
                if (icon) {
                    // Shown by the world-select list straight from the index.
                    await this._storeWorldIcon(this.currentWorldKey, icon);
                    // Best effort: also keep a copy inside the world directory
                    // so it travels with the save (export/import).
                    saveWorldIcon(this.currentWorldKey, Minecraft.pngBytesFromDataUrl(icon))
                        .catch((err) => console.error('Failed to save world icon:', err));
                }
            }

            // Mods supplied by the server belong to that connection only.
            // Remove their blocks, textures, recipes and commands before the
            // world is torn down so they cannot leak into another server or
            // singleplayer.
            this.modLoader?.unloadServerMods?.();
            this.worldLoadPromise = Promise.resolve();
            // Save world before quitting
            if (this.world !== null && this.isSingleplayer()) {
                await this.saveWorld();
            }

            this.isConnectedToIntegratedServer = false;
            this.currentWorldSeed = null;
            this.serverRules = { allowTNT: true, allowLiquidFlow: true };

            this.worldRenderer.reset();
            this.itemRenderer.reset();

            // Disconnect from server
            if (this.playerController instanceof PlayerControllerMultiplayer) {
                let networkHandler = this.playerController.getNetworkHandler();
                if (networkHandler.getNetworkManager().isConnected()) {
                    networkHandler.getNetworkManager().close();
                }

                // Reset header and footer
                this.ingameOverlay.playerListOverlay.setHeader(null);
                this.ingameOverlay.playerListOverlay.setFooter(null);

                // The loopback 'close' handler saves the player asynchronously;
                // give it a beat, then shut the integrated server down and
                // refresh the world index metadata (time / gamemode / lastPlayed).
                await new Promise(resolve => setTimeout(resolve, 50));
                stopIntegratedServer();
                await this._updateWorldIndexOnQuit();
            }
            this.playerController = null;

            if (this.world !== null) {
                this.world.cleanup();
                const provider = this.world.getChunkProvider();
                if (provider && typeof provider.terminate === "function") {
                    provider.terminate();
                }
                this.world.getChunkProvider().getChunks().clear();
                this.world.clearEntities();
                this.world = null;
                this.player = null;
                this.loadingScreen = null;

                // The hotbar/inventory overlay keeps rendering during the
                // async teardown above (server shutdown awaits), re-adding
                // item groups to the 3D scene after reset(); clear them now
                // that the world is gone so they don't linger over the menu.
                this.itemRenderer.reset();
            }
            this.displayScreen(new GuiMainMenu());
        } else {
            // Singleplayer: show "Starting integrated server..." for 2 seconds
            // before the regular terrain loading screen
            if (!(this.playerController instanceof PlayerControllerMultiplayer)) {
                this.displayScreen(new GuiLoadingIntegratedServer(this.currentScreen));
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            // Display loading screen. The terrain title stays until the chunk
            // stream starts, then onTick/_loadWorldAsync switches to the
            // building phase.
            this.loadingScreen = new GuiLoadingScreen();
            this.loadingScreen.setTitle("Loading terrain...");
            this.displayScreen(this.loadingScreen);

            // Reset chunk timeout tracking for the new world
            this.lastChunkCount = 0;
            this.lastChunkArrivalTime = 0;

            // Clear previous world
            if (this.world !== null) {
                this.world.getChunkProvider().getChunks().clear();
                this.world.clearEntities();
                this.worldRenderer.reset();
                this.itemRenderer.reset();
            }

            // Create world
            this.world = world;
            this.worldRenderer.scene.add(this.world.group);

            // Reload texture atlas with selected pack if set
            if (this.settings.selectedTexturePack && this.worldRenderer.textureAtlas) {
                this.setLoadingStatus("Loading textures...");
                this.worldRenderer.textureAtlas.texturePath = `texture_packs/${this.settings.selectedTexturePack}/`;
                await this.worldRenderer.textureAtlas.loadTextures();
                this.setLoadingStatus("Loading terrain...");
            }

            // Create player
            this.player = this.playerController.createPlayer(this.world);
            this.player.username = this.session.getProfile().getUsername();
            this.world.addEntity(this.player);

            if (this.player.renderer) {
                this.player.renderer.rebuild(this.player);
            }

            // Load spawn chunks and respawn player
            if (this.world.getChunkProvider() instanceof ChunkProviderGenerateWorker) {
                this._loadWorldAsync(world);
            } else {
                // Sync path: progress is tracked in onTick; spawn loading happens when done
            }
        }
    }

    async _loadWorldAsync(world) {
        this.setLoadingStatus("Loading world data...");

        // Load saved chunk data from IndexedDB before generating new chunks
        if (this.isSingleplayer()) {
            await this.loadWorldSave(world, this.currentWorldKey);
        }

        this.setLoadingStatus("Building terrain...");

        const provider = world.getChunkProvider();
        const viewDistance = this.settings.viewDistance;
        const spawnChunkX = world.spawn.x >> 4;
        const spawnChunkZ = world.spawn.z >> 4;

        const coords = [];
        for (let x = -viewDistance; x <= viewDistance; x++) {
            for (let z = -viewDistance; z <= viewDistance; z++) {
                coords.push([spawnChunkX + x, spawnChunkZ + z]);
            }
        }

        const BATCH_SIZE = 16;
        for (let i = 0; i < coords.length; i += BATCH_SIZE) {
            const batch = coords.slice(i, i + BATCH_SIZE);
            await provider.loadChunksBatchAsync(batch, (done, total) => {
                if (this.loadingScreen !== null) {
                    const batchFraction = total > 0 ? done / total : 1;
                    const progress = Math.min(1, (i + batch.length * batchFraction) / coords.length);
                    this.loadingScreen.setProgress(progress);
                }
            });

            if (this.loadingScreen !== null) {
                const progress = Math.min(1, (i + batch.length) / coords.length);
                this.loadingScreen.setProgress(progress);
            }

            await new Promise(r => setTimeout(r, 0));
        }

        // Light is part of loading: drain everything the chunk stream queued
        // before the world is shown, in frame-sized slices so the loading bar
        // keeps animating instead of freezing the tab.
        this.setLoadingStatus("Propagating Light");

        while (world.lightUpdateQueue.length > 0) {
            this.propagateLight(world, 12);
            await new Promise(r => setTimeout(r, 0));
        }

        world.spawn.y = world.getHeightAt(world.spawn.x, world.spawn.z) + 1;
        this.player.respawn();

        // Load sign text for all signs in the world
        if (this.worldRenderer.signTextRenderer) {
            this.worldRenderer.signTextRenderer.updateAllSigns(world);
        }

        if (this.loadingScreen !== null) {
            this.loadingScreen = null;
            this.displayScreen(null);
        }

        this.musicManager.playMusic('game');
    }

    _getWorldDB() {
        if (this._worldDB) return Promise.resolve(this._worldDB);
        return new Promise((resolve, reject) => {
            const request = indexedDB.open('WorldSaveDB', 1);
            request.onupgradeneeded = (event) => {
                event.target.result.createObjectStore('saves', { keyPath: 'key' });
            };
            request.onsuccess = (event) => {
                this._worldDB = event.target.result;
                resolve(this._worldDB);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    async _migrateOldSave() {
        const db = await this._getWorldDB();
        const tx = db.transaction('saves', 'readwrite');
        const store = tx.objectStore('saves');

        const indexGet = await new Promise(r => {
            const req = store.get('world_index');
            req.onsuccess = () => r(req.result);
            req.onerror = () => r(null);
        });
        if (indexGet) return;

        const old = await new Promise(r => {
            const req = store.get('current_world');
            req.onsuccess = () => r(req.result);
            req.onerror = () => r(null);
        });
        if (!old) return;

        const data = old.data;
        const worldKey = 'w_' + Date.now();
        data.name = data.name || 'My World';

        await new Promise((resolve, reject) => {
            store.put({ key: worldKey, data, timestamp: Date.now() });
            const indexEntry = {
                key: worldKey,
                name: data.name,
                seedLow: data.seedLow || 0,
                seedHigh: data.seedHigh || 0,
                worldType: data.worldType || 'normal',
                gameMode: 'survival',
                lastPlayed: Date.now(),
                time: data.time || 0,
                spawnX: data.spawnX || 0,
                spawnY: data.spawnY || 0,
                spawnZ: data.spawnZ || 0,
            };
            store.put({ key: 'world_index', data: [indexEntry], timestamp: Date.now() });
            store.delete('current_world');
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async _loadWorldIndex() {
        const db = await this._getWorldDB();

        // Check if index exists; if not, try migrating old save
        const checkTx = db.transaction('saves', 'readonly');
        const checkGet = await new Promise(r => {
            const req = checkTx.objectStore('saves').get('world_index');
            req.onsuccess = () => r(req.result);
            req.onerror = () => r(null);
        });

        if (!checkGet) {
            await this._migrateOldSave();
        }

        return new Promise((resolve) => {
            const tx = db.transaction('saves', 'readonly');
            const get = tx.objectStore('saves').get('world_index');
            get.onsuccess = () => resolve(get.result ? get.result.data : []);
            get.onerror = () => resolve([]);
        });
    }

    async _saveWorldIndex(index) {
        const db = await this._getWorldDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('saves', 'readwrite');
            tx.objectStore('saves').put({ key: 'world_index', data: index, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async _saveWorldToDB(worldKey, saveData) {
        const db = await this._getWorldDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('saves', 'readwrite');
            tx.objectStore('saves').put({ key: worldKey, data: saveData, timestamp: Date.now() });
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });
    }

    async _loadWorldFromDB(worldKey) {
        const db = await this._getWorldDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction('saves', 'readonly');
            const get = tx.objectStore('saves').get(worldKey);
            get.onsuccess = () => resolve(get.result ? get.result.data : null);
            get.onerror = (e) => reject(e.target.error);
        });
    }

    async hasSaveData() {
        const list = await this.getWorldList();
        return list.length > 0;
    }

    // List singleplayer worlds from the server-directory layout (the source of
    // truth for world storage now), merged with the legacy IndexedDB index for
    // metadata (last played, display name of not-yet-entered legacy worlds).
    async getWorldList() {
        const index = await this._loadWorldIndex();
        const byKey = new Map(index.map(e => [e.key, e]));
        const serverWorlds = await listServerWorlds();
        const seen = new Set();

        const list = [];
        for (const sw of serverWorlds) {
            // Skip pure multiplayer-style servers (no singleplayer world key
            // and never indexed as a world).
            if (!sw.key.startsWith('w_') && !byKey.has(sw.key)) continue;

            const idx = byKey.get(sw.key);
            seen.add(sw.key);
            list.push({
                key: sw.key,
                name: sw.name || (idx && idx.name) || sw.key,
                seedLow: sw.seedLow ?? (idx && idx.seedLow) ?? 0,
                seedHigh: sw.seedHigh ?? (idx && idx.seedHigh) ?? 0,
                worldType: sw.worldType || (idx && idx.worldType) || 'normal',
                gameMode: sw.gameMode || (idx && idx.gameMode) || 'creative',
                lastPlayed: (idx && idx.lastPlayed) || 0,
                time: sw.time ?? (idx && idx.time) ?? 0,
                spawnX: (idx && idx.spawnX) || 0,
                spawnY: (idx && idx.spawnY) || 0,
                spawnZ: (idx && idx.spawnZ) || 0,
                // The index copy is written on every exit and is therefore
                // the freshest; the file in the world directory is the fallback
                // (e.g. for an imported world that has not been entered yet).
                icon: (idx && idx.icon) || sw.icon || null,
            });
        }

        // Legacy IndexedDB worlds that have not been entered since the switch
        // to the integrated server have no server directory yet; they still
        // show up and migrate on first load.
        for (const [key, idx] of byKey) {
            if (seen.has(key)) continue;
            list.push({
                key,
                name: idx.name || key,
                seedLow: idx.seedLow || 0,
                seedHigh: idx.seedHigh || 0,
                worldType: idx.worldType || 'normal',
                gameMode: idx.gameMode || 'creative',
                lastPlayed: idx.lastPlayed || 0,
                time: idx.time || 0,
                spawnX: idx.spawnX || 0,
                spawnY: idx.spawnY || 0,
                spawnZ: idx.spawnZ || 0,
                icon: idx.icon || null,
            });
        }

        list.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
        return list;
    }

    async createNewWorld(name, seedLong, worldType, gameMode) {
        const worldKey = 'w_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
        this.currentWorldKey = worldKey;
        this.currentWorldSeed = seedLong || null;

        // Add to world index
        const index = await this._loadWorldIndex();
        index.push({
            key: worldKey,
            name: name,
            seedLow: seedLong.low,
            seedHigh: seedLong.high,
            worldType: worldType,
            gameMode: gameMode || 'survival',
            lastPlayed: Date.now(),
            time: 0,
            spawnX: 0,
            spawnY: 0,
            spawnZ: 0,
        });
        await this._saveWorldIndex(index);

        // Start the in-page integrated server and connect as a client. The
        // server owns the world (terrain + save files); the client renders
        // whatever the server sends, exactly like multiplayer.
        this.displayScreen(new GuiLoadingIntegratedServer(this.currentScreen));
        this.setLoadingStatus("Loading world data...");
        await startIntegratedServer({
            worldKey: worldKey,
            name: name,
            seedLow: seedLong.low,
            seedHigh: seedLong.high,
            worldType: worldType,
            gameMode: gameMode || 'survival',
            username: this.getSession().getProfile().getUsername(),
            migrateData: null,
            clientMods: this.modLoader ? await this.modLoader.getServerModPayload() : [],
        });
        this.setLoadingStatus("Connecting to world...");
        this.connectToIntegratedServer();

        return null;
    }

    // Open a client connection to the running integrated server over the
    // loopback transport. handleJoinGame() on the server side will then create
    // the WorldClient + PlayerControllerMultiplayer and enter the world.
    connectToIntegratedServer() {
        const networkManager = new NetworkManager(this);
        networkManager.setNetworkHandler(new NetworkLoginHandler(networkManager));
        networkManager.connect('loopback', 0, { url: 'ws://loopback' });
        this.isConnectedToIntegratedServer = true;

        const mods = this.modLoader ? this.modLoader.getHandshakeMods() : [];
        networkManager.sendPacket(new HandshakePacket(Minecraft.PROTOCOL_VERSION, ProtocolState.LOGIN, mods));
        networkManager.sendPacket(new LoginStartPacket(this.getSession().getProfile().getUsername()));
    }


    /**
     * Render the world once and return a 256x256 PNG data URL of it, for the
     * singleplayer world-select list. The WebGL drawing buffer is not
     * preserved between tasks, so the frame is rendered and copied into a 2D
     * canvas in this same synchronous call: no render-loop round trip, which
     * keeps it working while paused (the frame is otherwise only drawn when
     * unpaused) and in a throttled tab. Returns null when there is nothing to
     * capture.
     */
    _captureWorldIcon() {
        if (!this.isInGame() || !this.worldRenderer) return null;

        try {
            // Draw a fresh frame: the previous one is no longer in the drawing
            // buffer. The pause menu is a separate 2D canvas, so the result is
            // the world without any HUD or menu overlay.
            this.worldRenderer.render(this.timer ? this.timer.partialTicks : 0);

            const source = this.window.canvasWorld;
            const width = source.width;
            const height = source.height;
            if (!width || !height) return null;

            // Centre-crop the frame to a square so the icon is not distorted
            // on wide or tall viewports.
            const side = Math.min(width, height);
            const sx = Math.floor((width - side) / 2);
            const sy = Math.floor((height - side) / 2);

            const icon = document.createElement('canvas');
            icon.width = 256;
            icon.height = 256;
            const context = icon.getContext('2d');
            context.imageSmoothingEnabled = true;
            context.imageSmoothingQuality = 'high';
            context.drawImage(source, sx, sy, side, side, 0, 0, 256, 256);

            return icon.toDataURL('image/png');
        } catch (err) {
            console.error('Failed to capture world icon:', err);
            return null;
        }
    }

    // Store the screenshot on the world's index entry, which is what the
    // world-select list reads. This does not depend on the integrated server
    // (or its filesystem) still being around when the world is left.
    async _storeWorldIcon(worldKey, dataUrl) {
        try {
            const index = await this._loadWorldIndex();
            let entry = index.find(e => e.key === worldKey);
            if (!entry) {
                entry = { key: worldKey, name: '' };
                index.push(entry);
            }
            entry.icon = dataUrl;
            await this._saveWorldIndex(index);
        } catch (err) {
            console.error('Failed to store world icon:', err);
        }
    }

    // PNG bytes for a data URL, used to also store the icon inside the world
    // directory (binary file) for export/import.
    static pngBytesFromDataUrl(dataUrl) {
        const text = String(dataUrl);
        const comma = text.indexOf(',');
        const base64 = comma === -1 ? text : text.slice(comma + 1);
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes;
    }

    async saveWorld() {
        if (!this.world || !this.isSingleplayer() || !this.currentWorldKey) return;

        const provider = this.world.getChunkProvider();
        const chunks = provider.getChunks();
        const modifiedData = {};
        const dirtySections = [];

        for (const [index, chunk] of chunks) {
            if (chunk.hasDirtySections()) {
                modifiedData[index] = chunk.serialize();
                dirtySections.push(chunk.sections);
            }
        }

        // Once a world lives in the server's world_data.bin, the server owns the
        // blocks. Writing a second copy of the chunks into IndexedDB here is what
        // made worlds "randomly" lose builds: the client copy is a partial view
        // (only chunks the client happened to have loaded and marked dirty), and
        // loadSavedWorld() fed it back in as migrateData on the next launch, so
        // it silently overwrote newer server-side edits. The server now stores
        // whole modified subchunks, so it is the only writer.
        const isServerBacked = this._worldIsServerBacked;

        try {
            const seed = this.world.getSeed();
            const saveData = {
                name: '',
                seedLow: seed && typeof seed === 'object' ? seed.low : 0,
                seedHigh: seed && typeof seed === 'object' ? seed.high : 0,
                worldType: provider.worldType || 'normal',
                spawnX: this.world.spawn.x,
                spawnY: this.world.spawn.y,
                spawnZ: this.world.spawn.z,
                time: this.world.time,
                chunks: modifiedData
            };

            if (Object.keys(modifiedData).length > 0) {
                for (const sections of dirtySections) {
                    for (const section of sections) {
                        section.isDirty = false;
                    }
                }
            }

            if (this.world.blockInventories && this.world.blockInventories.size > 0) {
                const inventories = [];
                for (const [key, inv] of this.world.blockInventories) {
                    const state = inv.toNetworkState();
                    for (const prop of Object.keys(inv)) {
                        if (prop !== 'items' && typeof inv[prop] !== 'function') {
                            state[prop] = inv[prop];
                        }
                    }
                    inventories.push({ key, state });
                }
                saveData.blockInventories = inventories;
            }

            if (this.player && this.player.inventory) {
                saveData.playerInventory = this.player.inventory.toNetworkState();
            }

            if (this.player) {
                saveData.playerPos = { x: this.player.x, y: this.player.y, z: this.player.z };
                saveData.playerRot = { yaw: this.player.rotationYaw, pitch: this.player.rotationPitch };
                saveData.playerHealth = this.player.health;
                saveData.playerGameMode = {
                    creative: this.player.creative,
                    spectator: this.player.spectator,
                    flying: this.player.flying,
                };
            }

            // Save dropped items
            const itemEntities = [];
            if (this.world.entities) {
                for (const entity of this.world.entities) {
                    if (entity.constructor.name === 'ItemEntity') {
                        itemEntities.push({
                            blockId: entity.getBlockId(),
                            x: entity.x,
                            y: entity.y,
                            z: entity.z,
                            motionX: entity.motionX,
                            motionY: entity.motionY,
                            motionZ: entity.motionZ,
                        });
                    }
                }
            }
            if (itemEntities.length > 0) {
                saveData.itemEntities = itemEntities;
            }

            // A world the server already owns only needs its index metadata
            // refreshed; the blocks go through the server's own save.
            if (!isServerBacked) {
                await this._saveWorldToDB(this.currentWorldKey, saveData);
            }

            // Update world index metadata
            const index = await this._loadWorldIndex();
            const entry = index.find(e => e.key === this.currentWorldKey);
            if (entry) {
                if (!entry.name && saveData.name) entry.name = saveData.name;
                entry.lastPlayed = Date.now();
                entry.time = this.world.time;
                entry.spawnX = this.world.spawn.x;
                entry.spawnY = this.world.spawn.y;
                entry.spawnZ = this.world.spawn.z;
                if (this.player) {
                    entry.gameMode = this.player.creative ? 'creative' : this.player.spectator ? 'spectator' : 'survival';
                }
                await this._saveWorldIndex(index);
            }
        } catch (err) {
            console.error('Failed to save world:', err);
        }
    }

    async loadWorldSave(world, worldKey) {
        if (!this.isSingleplayer()) return;

        try {
            const saveData = await this._loadWorldFromDB(worldKey);
            if (!saveData) return;
            const provider = world.getChunkProvider();

            if (saveData.seedLow !== undefined) {
                const currentSeed = world.getSeed();
                if (currentSeed && typeof currentSeed === 'object') {
                    if (currentSeed.low !== saveData.seedLow || currentSeed.high !== saveData.seedHigh) {
                        return;
                    }
                }
            }

            for (const key in saveData.chunks) {
                const chunkData = saveData.chunks[key];
                const chunk = Chunk.deserialize(world, chunkData);
                provider.getChunks().set(parseInt(key), chunk);
                world.group.add(chunk.group);
            }

            if (saveData.spawnX !== undefined) {
                world.spawn.x = saveData.spawnX;
                world.spawn.y = saveData.spawnY;
                world.spawn.z = saveData.spawnZ;
            }
            if (saveData.time !== undefined) {
                world.time = saveData.time;
            }

            if (saveData.blockInventories) {
                if (!world.blockInventories) {
                    world.blockInventories = new Map();
                }
                for (const entry of saveData.blockInventories) {
                    const inv = new InventoryBasic(entry.state.size || 1);
                    inv.applyNetworkState(entry.state);
                    world.blockInventories.set(entry.key, inv);
                }
            }

            if (saveData.playerInventory && this.player && this.player.inventory) {
                this.player.inventory.applyNetworkState(saveData.playerInventory);
            }
        } catch (err) {
            console.error('Failed to load world save:', err);
        }
    }

    async loadSavedWorld(worldKey) {
        this.currentWorldKey = worldKey;

        // Prefer the world's own serverconfig.conf (the source of truth for
        // re-entered worlds); fall back to the legacy IndexedDB index for
        // worlds that have not been migrated to the server layout yet.
        const serverWorlds = await listServerWorlds();
        const serverEntry = serverWorlds.find(w => w.key === worldKey);

        const index = await this._loadWorldIndex();
        const entry = index.find(e => e.key === worldKey);

        const seedSource = serverEntry || entry;
        this.currentWorldSeed = seedSource
            ? { low: seedSource.seedLow || 0, high: seedSource.seedHigh || 0 }
            : null;

        // A world that already has server files is server-authoritative: the
        // client must not write a competing chunk copy (see saveWorld).
        this._worldIsServerBacked = Boolean(serverEntry);

        // A legacy IndexedDB save (from before the integrated server) is
        // migrated into server files the first time the world is entered.
        const saveData = await this._loadWorldFromDB(worldKey);

        this.displayScreen(new GuiLoadingIntegratedServer(this.currentScreen));
        this.setLoadingStatus("Loading world data...");
        await startIntegratedServer({
            worldKey: worldKey,
            name: (serverEntry && serverEntry.name) || (entry && entry.name) || undefined,
            seedLow: serverEntry ? serverEntry.seedLow : (entry ? entry.seedLow : 0),
            seedHigh: serverEntry ? serverEntry.seedHigh : (entry ? entry.seedHigh : 0),
            worldType: (serverEntry && serverEntry.worldType) || (entry && entry.worldType) || 'normal',
            gameMode: (serverEntry && serverEntry.gameMode) || (entry && entry.gameMode) || 'creative',
            username: this.getSession().getProfile().getUsername(),
            migrateData: saveData || null,
            clientMods: this.modLoader ? await this.modLoader.getServerModPayload() : [],
        });

        // Once migrated, drop the IndexedDB copy so it never overwrites the
        // server's (newer) save files on a later entry.
        if (saveData) {
            await this._deleteWorldFromDB(worldKey);
        }

        this.setLoadingStatus("Connecting to world...");
        this.connectToIntegratedServer();
        return true;
    }

    _deleteWorldFromDB(worldKey) {
        const db = this._getWorldDB();
        return db.then((database) => new Promise((resolve, reject) => {
            const tx = database.transaction('saves', 'readwrite');
            tx.objectStore('saves').delete(worldKey);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        }));
    }

    // Refresh the world index metadata (time, spawn, gamemode, lastPlayed)
    // when leaving a singleplayer integrated-server world. The server owns the
    // actual save; this keeps the world-selection list up to date.
    async _updateWorldIndexOnQuit() {
        if (!this.currentWorldKey || !this.world || !this.player) return;

        const index = await this._loadWorldIndex();            let entry = index.find(e => e.key === this.currentWorldKey);
            if (!entry) {
                // Newly created worlds may not have an index entry yet; create
                // one so the screenshot taken on exit is not dropped.
                entry = { key: this.currentWorldKey, name: '' };
                index.push(entry);
            }

            // Keep the icon stored on exit; _storeWorldIcon writes it while
            // the world is still alive so it does not depend on this path.
            entry.lastPlayed = Date.now();
        entry.time = this.world.time || 0;
        entry.spawnX = this.world.spawn ? this.world.spawn.x : 0;
        entry.spawnY = this.world.spawn ? this.world.spawn.y : 0;
        entry.spawnZ = this.world.spawn ? this.world.spawn.z : 0;
        entry.gameMode = this.player.creative ? 'creative' : this.player.spectator ? 'spectator' : 'survival';
        await this._saveWorldIndex(index);
    }



    async deleteWorld(worldKey) {
        // Stop the integrated server if it is running this world
        if (isIntegratedRunning() && getIntegratedServerName() === serverNameForKey(worldKey)) {
            stopIntegratedServer();
        }
        // Remove the server's save files for this world
        deleteServerWorld(worldKey);

        const db = await this._getWorldDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('saves', 'readwrite');
            tx.objectStore('saves').delete(worldKey);
            tx.oncomplete = () => resolve();
            tx.onerror = (e) => reject(e.target.error);
        });

        const index = await this._loadWorldIndex();
        const filtered = index.filter(e => e.key !== worldKey);
        await this._saveWorldIndex(filtered);
    }

    hasInGameFocus() {
        if (this.settings.tvmode) {
            return this.currentScreen === null && this.isInGame();
        }
        return this.window.isLocked() && this.currentScreen === null;
    }

    isInGame() {
        return this.world !== null && this.worldRenderer !== null && this.player !== null;
    }

    /**
     * Publishes window.GAMESTATE: a single JSON-safe object describing what the
     * game is currently doing, kept up to date once per frame by
     * updateGameState(). Remote support / controller polyfills poll it to know
     * whether they should drive a relative mouse (camera look) or an absolute
     * on-screen cursor (menus).
     */
    initGameState() {
        this.gameState = {
            // boot | menu | loading | gui | ingame | paused
            state: "boot",
            inGame: false,
            guiOpen: false,
            screen: null,        // class name of the current screen, e.g. "GuiChat"
            loading: false,
            pointerLock: false,  // browser cursor is locked to the canvas
            focusLocked: false, // game considers itself cursor-locked
            hasFocus: false,    // player accepts mouse look / input
            paused: false,
            hudHidden: false,
            world: null,
            singleplayer: false,
            tvmode: false,
            mobile: false,
            fps: 0,
            maxFps: 0,
            time: Date.now(),
            player: { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 0 }
        };

        // Live handle: always up to date, never stale.
        this.gameState.snapshot = () => JSON.parse(JSON.stringify(this.gameState));

        // Signature of the last state pushed to the Electron host, so the
        // per-frame update only forwards real transitions.
        this.lastPublishedGameState = null;

        if (typeof window !== "undefined") {
            window.GAMESTATE = this.gameState;
        }
    }

    updateGameState() {
        if (this.gameState === undefined) {
            this.initGameState();
        }

        const gs = this.gameState;
        const inGame = this.isInGame();
        const screen = this.currentScreen;
        const loading = this.loadingScreen !== null;
        const guiOpen = screen !== null;
        const paused = inGame && this.isPaused();

        let state = "boot";
        if (inGame) {
            state = guiOpen ? "gui" : (paused ? "paused" : "ingame");
        } else if (guiOpen) {
            state = loading ? "loading" : "menu";
        }

        gs.state = state;
        gs.inGame = inGame;
        gs.guiOpen = guiOpen;
        gs.screen = guiOpen ? screen.constructor.name : null;
        gs.loading = loading;
        gs.pointerLock = !!this.window.isCursorLockedToCanvas();
        gs.focusLocked = !!this.window.isLocked();
        gs.hasFocus = this.hasInGameFocus();
        gs.paused = paused;
        gs.hudHidden = GuiFunctions.isGuiHidden();
        gs.world = this.currentWorldKey;
        gs.singleplayer = inGame && this.isSingleplayer();
        gs.tvmode = !!this.settings.tvmode;
        gs.mobile = !!this.window.mobileDevice;
        gs.fps = this.fps;
        gs.maxFps = this.maxFps;
        gs.time = Date.now();

        if (inGame && this.player !== null) {
            const p = gs.player;
            p.x = this.player.x;
            p.y = this.player.y;
            p.z = this.player.z;
            p.yaw = this.player.rotationYaw;
            p.pitch = this.player.rotationPitch;
            p.health = this.player.health;
        }

        this.publishGameStateToHost();
    }

    /**
     * Tell the Electron host what the game is doing, for the Discord Rich
     * Presence. The host cannot read this state itself (the window is context
     * isolated), so the renderer pushes it whenever it changes.
     *
     * `gs.singleplayer` is deliberately not used here: a singleplayer world is
     * served by the in-page integrated server, so isSingleplayer() is false and
     * only isLocalSession() tells a local world apart from a remote server.
     */
    publishGameStateToHost() {
        const bridge = typeof window !== "undefined" ? window.modsBridge : null;
        if (!bridge || typeof bridge.reportGameState !== "function") return;

        const gs = this.gameState;
        const session = this.getSession();
        const username = session ? session.getProfile().getUsername() : "";

        const state = {
            state: gs.state,
            // An open screen still counts as being in the world (inventory,
            // chat), so this must not be derived from `inGame`.
            singleplayer: this.isLocalSession(),
            paused: gs.paused,
            username: username,
            world: this.currentWorldKey || null
        };

        // updateGameState() runs every frame; only forward real transitions so
        // the host does not push a Discord update 60 times a second.
        const key = JSON.stringify(state);
        if (key === this.lastPublishedGameState) return;
        this.lastPublishedGameState = key;

        try {
            bridge.reportGameState(state);
        } catch {
            // Host not listening (running in a plain browser) - ignore.
        }
    }

    addMessageToChat(message) {
        this.ingameOverlay.chatOverlay.addMessage(message);
    }

    requestNextFrame() {
        requestAnimationFrame(() => {
            if (this.running) {
                this.requestNextFrame();
                this.onLoop();
            }
        });
    }

    onLoop() {
        // Update the timer
        if (this.isPaused() && this.isInGame()) {
            let prevPartialTicks = this.timer.partialTicks;
            this.timer.advanceTime();
            this.timer.partialTicks = prevPartialTicks;
        } else {
            this.timer.advanceTime();
        }

        // Call the tick to reach updates 20 per seconds
        for (let i = 0; i < this.timer.ticks; i++) {
            this.onTick();
        }

        // Render the game
        this.onRender(this.timer.partialTicks);

        // Increase rendered frame
        this.frames++;

        // Loop if a second passed
        while (Date.now() >= this.lastTime + 1000) {
            this.fps = this.frames;
            this.maxFps = Math.max(this.maxFps, this.fps);
            this.lastTime += 1000;
            this.frames = 0;
        }

        // Publish window.GAMESTATE for external tooling (remote support)
        this.updateGameState();
    }

    onRender(partialTicks) {
        if (this.isInGame()) {
            // Player rotation
            if (this.hasInGameFocus()) {
                let deltaX = this.window.pullMouseMotionX();
                let deltaY = this.window.pullMouseMotionY();
                if (deltaX !== 0 || deltaY !== 0) {
                    this.player.turn(deltaX, deltaY);
                }

                // Remotes (gamepad/TV) look with their own sensitivity.
                let remoteX = this.window.pullRemoteMotionX();
                let remoteY = this.window.pullRemoteMotionY();
                if (remoteX !== 0 || remoteY !== 0) {
                    this.player.turn(remoteX, remoteY, this.settings.getRemoteSensitivity());
                }
            }

            // Update lights (limit iterations to prevent freezing)
            let lightIterations = 0;
            const lightDeadline = performance.now() + 6;
            while (this.world.updateLights() && lightIterations < 500 && performance.now() < lightDeadline) {
                lightIterations++;
            }

            if (this.player) {
                this.world.cloudTexture.offset.x =  this.player.x * 0.0001 + this.world.cloudOffset;
                this.world.cloudTexture.offset.y = -this.player.z * 0.0001;
                
                this.world.clouds.position.x = this.player.x; // / 2 * 1.5;
                this.world.clouds.position.z = this.player.z; // / 2 * 1.5;
            }

            // Render the game
            if (!this.isPaused()) {
                this.worldRenderer.render(partialTicks);
            }
        }

        // Render items in GUI
        this.itemRenderer.render(partialTicks);

        // Render current screen
        this.screenRenderer.render(partialTicks);
    }

    isElectron() {
        // Renderer process
        if (typeof window !== 'undefined' && typeof window.process === 'object' && window.process.type === 'renderer') {
            return true;
        }

        // Main process
        if (typeof process !== 'undefined' && typeof process.versions === 'object' && !!process.versions.electron) {
            return true;
        }

        // Renderer process with nodeIntegration disabled
        if (typeof navigator === 'object' && typeof navigator.userAgent === 'string' && navigator.userAgent.indexOf('Electron') >= 0) {
            return true;
        }

        return false;
    }

    displayScreen(screen) {
        if (screen === this.currentScreen) {
            return;
        }

        if (typeof screen === "undefined") {
            console.error("Tried to display an undefined screen");
            return;
        }

        if (screen && (screen.constructor.name === "GuiPrelaunch" || screen.constructor.name === "GuiLicense")) {
            document.title = "Breakmine | Pre-launch Environment";
        } else {
            document.title = "Breakmine";
        }

        if (Boolean(window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' || window.location.hostname === '[::1]' )) {
            document.title = document.title + " (localhost)";
        }

        if (this.isElectron()) {
            document.title = "Breakmine" + " (" + Version.VERSION + ", " + Version.TIMESTAMP + ")";
        }

        // Fallback screen
        if (screen === null && !this.isInGame()) {
            screen = new GuiMainMenu();
        }

        // Close previous screen
        if (this.currentScreen !== null) {
            this.currentScreen.onClose();
        }

        // Switch screen
        this.currentScreen = screen;

        // Update window size
        this.window.updateWindowSize();

        // Initialize new screen
        if (screen === null) {
            this.window.updateFocusState(FocusStateType.REQUEST_LOCK);
        } else {
            this.window.updateFocusState(FocusStateType.REQUEST_EXIT);
            screen.setup(this, this.window.width, this.window.height);

            // Play menu music when any screen is shown outside of a world
            if (!this.isInGame()) {
                this.musicManager.playMusic('menu');
            }
        }

        // Update items
        this.itemRenderer.rebuildAllItems();

        // Publish window.GAMESTATE immediately so listeners see the new screen
        this.updateGameState();
    }

    onTick() {
        if (this.isInGame() && !this.isPaused()) {
            // Tick mining
            this.handleMiningTicks();

            // Tick overlay
            this.ingameOverlay.onTick();

            // Tick world
            this.world.onTick();

            // Tick renderer
            this.worldRenderer.onTick();

            // Tick particle renderer
            this.particleRenderer.onTick();

            // Tick voice chat (announce/prune/volume upkeep)
            if (this.voiceChat) {
                this.voiceChat.onTick();
            }
        }

        // Tick the screen
        if (this.currentScreen !== null) {
            this.currentScreen.updateScreen();
        }

        // Update loading progress (sync provider only; worker uses _loadWorldAsync)
        if (this.loadingScreen !== null && this.isInGame()
            && !(this.world.getChunkProvider() instanceof ChunkProviderGenerateWorker)) {
            let cameraChunkX = Math.floor(this.player.x) >> 4;
            let cameraChunkZ = Math.floor(this.player.z) >> 4;

            let renderDistance = this.settings.viewDistance;
            let requiredChunks = Math.pow(renderDistance * 2 - 1, 2);
            let loadedChunks = this.world.getChunkProvider().getChunks().size;

            // Drain queued light before the world is shown: the queue refills
            // as chunks arrive, so this runs on every loading tick and the
            // screen only closes once it is empty.
            let pendingLight = this.propagateLight(this.world, 6);
            if (pendingLight > 0) {
                this.loadingScreen.setTitle("Propagating Light");
            }

            // Terrain chunks are arriving now: the stream/load phase is over
            // and the client is building the visible world.
            if (loadedChunks > 0 && pendingLight === 0) {
                this.loadingScreen.setTitle("Building terrain...");
            }

            // Track chunk arrival for timeout detection
            if (loadedChunks !== this.lastChunkCount) {
                this.lastChunkCount = loadedChunks;
                this.lastChunkArrivalTime = Date.now();
            }

            // Load chunks and count
            setTimeout(() => {
                for (let x = -renderDistance + 1; x < renderDistance; x++) {
                    for (let z = -renderDistance + 1; z < renderDistance; z++) {
                        this.world.getChunkAt(cameraChunkX + x, cameraChunkZ + z);
                    }
                }
            }, 0);

            // Update progress. Light propagation is part of loading, so the
            // bar holds just below full while anything is still queued.
            let progress = 1 / requiredChunks * Math.max(0, loadedChunks - this.world.lightUpdateQueue.length / 1000);
            if (pendingLight > 0) {
                progress = Math.min(progress, 0.98);
            }
            this.loadingScreen.setProgress(progress);

            // The player must only become active once the terrain under and
            // around them is actually loaded; the plain chunk count also
            // includes spawn chunks elsewhere, so it can read "done" while the
            // player's own column is still missing (and they fall through).
            let terrainReady = this._chunksLoadedAround(cameraChunkX, cameraChunkZ, 2);

            // Finish loading when enough chunks are loaded, or fall back after a timeout
            // to prevent getting stuck on slow connections
            let timeoutElapsed = this.lastChunkArrivalTime > 0
                && Date.now() - this.lastChunkArrivalTime > 5000
                && loadedChunks >= 9;

            if ((progress >= 0.99 || timeoutElapsed) && terrainReady && pendingLight === 0) {
                this.world.loadSpawnChunks();
                // In multiplayer the server already restored the player's saved
                // position/health via the playerState packet; respawning here
                // would reset health to 20 (and teleport to the world spawn),
                // clobbering the restore and reporting full health to the server.
                if (this.isSingleplayer()) {
                    this.player.respawn();
                }
                this.musicManager.playMusic(this.player && this.player.creative ? 'creative' : 'game');
                this.loadingScreen = null;
                this.displayScreen(null);
            }
        }

        // Worker provider: request chunks around player during gameplay
        if (this.isInGame() && this.world !== null
            && this.world.getChunkProvider() instanceof ChunkProviderGenerateWorker
            && this.loadingScreen === null) {
            let cameraChunkX = Math.floor(this.player.x) >> 4;
            let cameraChunkZ = Math.floor(this.player.z) >> 4;
            let renderDistance = this.settings.viewDistance;

            this.world.getChunkProvider().requestChunksInRadius(cameraChunkX, cameraChunkZ, renderDistance);
        }

        // Auto-save world every 30 seconds
        if (this.isInGame() && this.isSingleplayer() && this.loadingScreen === null) {
            if (Date.now() - this.lastSaveTime > this.saveInterval) {
                this.lastSaveTime = Date.now();
                this.saveWorld();
            }
        }
    }

    /**
     * Drain queued light updates for at most budgetMs milliseconds. Each
     * queued update is sliced internally, so this never blocks for long.
     * Returns the number of updates still queued.
     */
    propagateLight(world, budgetMs = 8) {
        if (world === null || world.lightUpdateQueue === undefined) {
            return 0;
        }

        const queue = world.lightUpdateQueue;
        const deadline = performance.now() + budgetMs;

        while (queue.length > 0 && performance.now() < deadline) {
            if (queue[0].updateBlockLightning(world, 4000)) {
                queue.shift();
            }
        }

        return queue.length;
    }

    /**
     * Update the status line of whichever loading screen is visible. Used by
     * the world loader, the chunk stream and the server-mod importer so the
     * screen describes the phase that is actually running.
     */
    setLoadingStatus(status) {
        if (!status) return;

        if (this.loadingScreen) {
            this.loadingScreen.setTitle(status);
            return;
        }

        if (this.currentScreen && typeof this.currentScreen.setStatus === 'function') {
            this.currentScreen.setStatus(status);
        }
    }

    showLoadingScreen(title) {
        this.loadingScreen = new GuiLoadingScreen();
        this.loadingScreen.setTitle(title || "Loading terrain...");
        this.displayScreen(this.loadingScreen);
        this.lastChunkCount = 0;
        this.lastChunkArrivalTime = 0;
    }

    _chunksLoadedAround(chunkX, chunkZ, radius) {
        const provider = this.world.getChunkProvider();
        for (let x = chunkX - radius; x <= chunkX + radius; x++) {
            for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
                if (!provider.chunkExists(x, z)) {
                    return false;
                }
                // A worker-backed chunk exists as an empty shell before its
                // packet has been decoded. Keep the loading screen up until
                // the real terrain is installed so the player cannot fall
                // through it.
                if (typeof provider.isChunkReady === "function" && !provider.isChunkReady(x, z)) {
                    return false;
                }
            }
        }
        return true;
    }

    handleMiningTicks() {
        this.miningProgress = 0;
        if (!this.window.isLocked() || this.player.creative === true || this.player.spectator === true) {
            this.miningTimer = 0;
            this.lastBlockPos = null;
            return;
        }

        let isLeftClickHeld = !!(this.window.mouseButtons && this.window.mouseButtons[0]);
        let hitResult = this.player.rayTrace(5, this.timer.partialTicks);

        if (!isLeftClickHeld || hitResult === null) {
            this.miningTimer = 0;
            this.lastBlockPos = null;
            return;
        }

        if (this.lastBlockPos !== null &&
            (this.lastBlockPos.x !== hitResult.x ||
            this.lastBlockPos.y !== hitResult.y ||
            this.lastBlockPos.z !== hitResult.z)) {
            
            this.lastBlockPos = { x: hitResult.x, y: hitResult.y, z: hitResult.z };
            this.miningTimer = 0;
            return;
        }

        if (this.lastBlockPos === null) {
            this.lastBlockPos = { x: hitResult.x, y: hitResult.y, z: hitResult.z };
        }

        // A hit on the summoned field addresses cells in the field's local
        // space - read the cell from the field so hardness and drops follow
        // the summoned block, not whatever real terrain sits at the grid key.
        let miningField = hitResult.fieldCell && this.world.offGridField
            ? this.world.offGridField : null;
        let typeId = miningField
            ? miningField.getBlockAt(hitResult.x, hitResult.y, hitResult.z)
            : this.world.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
        if (typeId < 0) typeId = 0;
        if (typeId === 0) {
            this.miningTimer = 0;
            this.lastBlockPos = null;
            return;
        }

        this.miningTimer++;

        if (this.miningTimer % 5 === 0) {
            this.player.swingArm();
            let block = Block.getById(typeId);
            let soundName = block.getSound().getBreakSound();

            this.soundManager.playSoundMono(soundName, 0.5, 1.0);
        }

        let block = Block.getById(typeId);
        let requiredTicks = Math.ceil(block.getHardness() * 30);

        let heldItem = this.player.inventory.getItemInSelectedSlot()
        let heldTypeId = heldItem ? heldItem.getType() : null
        let heldBlock = heldTypeId ? Block.getById(heldTypeId) : null
        let tool = heldBlock instanceof ItemTool ? heldBlock : null

        let minLevel = block.minimumToolLevel()
        if (minLevel) {
            let toolMaterial = tool ? tool.material : null
            if (!toolMaterial || ItemTool.materials.indexOf(toolMaterial) < ItemTool.materials.indexOf(minLevel)) {
                requiredTicks *= 5
            }
        }

        let preferredType = block.getPreferredToolType()
        if (tool && (!preferredType || tool.toolType === preferredType)) {
            let eff = tool.efficiency() || 1
            requiredTicks = Math.ceil(requiredTicks / eff)
        } else {
            requiredTicks = Math.ceil(requiredTicks * Block.handHardnessMultiplier)
        }

        this.miningProgress = Math.min(1, this.miningTimer / Math.max(1, requiredTicks));
        if (this.miningTimer >= requiredTicks) {
            this.breakTargetBlock(hitResult, typeId);
            this.miningTimer = 0;
            this.lastBlockPos = null;
            this.miningProgress = 0;
        }
    }

    /**
     * Fire cancelable mod hooks for a player block action.
     * `pos` is the block being changed (the destination for placement); the
     * clicked block is exposed separately as `clickedPos`/`clickedBlock`.
     */
    isInteractiveBlock(block) {
        return !!block &&
            typeof block.onMouseButton === 'function' &&
            block.onMouseButton !== Block.prototype.onMouseButton;
    }

    emitBlockAction(action, x, y, z, options = {}) {
        const world = options.world || this.world;
        let targetBlockId = 0;
        let targetMetadata = 0;
        if (world) {
            targetBlockId = world.getBlockAt(x, y, z) ?? 0;
            targetMetadata = world.getBlockDataAt(x, y, z) ?? 0;
        }

        const heldItem = this.player?.inventory?.getItemInSelectedSlot?.();
        const currentBlockId = options.currentBlockId ?? (heldItem ? (heldItem.getType() || 0) : 0);
        const clicked = options.clickedPos || { x, y, z };
        const clickedBlockId = world
            ? (world.getBlockAt(clicked.x, clicked.y, clicked.z) ?? 0)
            : targetBlockId;

        return this.modLoader?.emitBlockAction?.(action, {
            action,
            username: this.player?.username || '',
            x, y, z,
            pos: { x, y, z },
            currentBlock: Block.getById(currentBlockId),
            currentBlockId,
            targetBlock: Block.getById(targetBlockId),
            targetBlockId,
            clickedBlock: Block.getById(clickedBlockId),
            clickedBlockId,
            clickedPos: { x: clicked.x, y: clicked.y, z: clicked.z },
            placePos: { x, y, z },
            face: options.face ?? null,
            metadata: options.metadata ?? targetMetadata,
            offGrid: !!options.offGrid,
            world,
            minecraft: this
        }) || { action, canceled: false };
    }

    breakTargetBlock(hitResult, typeId) {
        // Summoned cells live in the field's local grid, not in server chunk
        // storage: a dig/drop packet at those coordinates would make the
        // server break real terrain (or spawn server items) there. The cell
        // removal itself is synced by OffGridClientSync.
        let isFieldHit = !!(hitResult.fieldCell && this.world.offGridField);
        const actionWorld = isFieldHit ? this.world.offGridField.createLocalWorld() : this.world;
        const breakAction = this.emitBlockAction('break', hitResult.x, hitResult.y, hitResult.z, {
            world: actionWorld,
            metadata: actionWorld.getBlockDataAt(hitResult.x, hitResult.y, hitResult.z),
            offGrid: isFieldHit
        });
        if (breakAction.canceled) {
            this.miningProgress = 0;
            this.miningTimer = 0;
            this.lastBlockPos = null;
            return;
        }

        let block = Block.getById(typeId);
        let drops = [];

        let heldItem = this.player.inventory.getItemInSelectedSlot()
        let heldTypeId = heldItem ? heldItem.getType() : null
        let heldBlock = heldTypeId ? Block.getById(heldTypeId) : null
        let tool = heldBlock instanceof ItemTool ? heldBlock : null

        let minLevel = block.minimumToolLevel()
        if (!minLevel) {
            drops = Block.normalizeDrops(block.getDrop(this.world, hitResult.x, hitResult.y, hitResult.z));
        } else if (tool) {
            let toolMaterial = tool.material
            if (ItemTool.materials.indexOf(toolMaterial) >= ItemTool.materials.indexOf(minLevel)) {
                drops = Block.normalizeDrops(block.getDrop(this.world, hitResult.x, hitResult.y, hitResult.z));
            }
        }

        let soundName = block.getSound().getBreakSound();

        this.soundManager.playSoundMono(soundName, 1.0, 1.0);

        this.particleRenderer.spawnBlockBreakParticle(this.world, hitResult.x, hitResult.y, hitResult.z,
            hitResult.fieldCell && this.world.offGridField
                ? this.world.offGridField.getParticlePose()
                : null,
            isFieldHit ? block : null);

        // Play drop sound
        this.soundManager.playSoundMono('random.pop', 1.0, 1.0);

        this.world.setBlockAt(hitResult.x, hitResult.y, hitResult.z, 0);
        for (const [dropId, dropCount] of drops) {
            for (let index = 0; index < dropCount; index++) {
                if (this.isSingleplayer() || isFieldHit) {
                    // Singleplayer or summoned cell: create entity locally
                    this.world.addEntity(new ItemEntity(this, this.world, dropId, hitResult.x, hitResult.y, hitResult.z));
                } else {
                    // Multiplayer: tell server to spawn item for all players at the
                    // broken block's position
                    this.playerController.getNetworkHandler().sendPacket(new ClientDropItemPacket(dropId, hitResult.x, hitResult.y, hitResult.z));
                }
            }
        }
        this.player.swingArm();

        if (!this.isSingleplayer() && !isFieldHit) {
            let blockPos = new BlockPosition(hitResult.x, hitResult.y, hitResult.z);
            this.playerController.sendBlockDiggingPacket(2, blockPos, 0);
        }

        this.worldRenderer.flushRebuild = true;
    }

    onKeyPressed(button) {
        // TV mode: color button actions
        if (this.settings.tvmode && this.hasInGameFocus()) {
            if (button === 'ColorRed') {
                this.onMouseClicked(0);
            }
            if (button === 'ColorGreen') {
                this.onMouseClicked(2);
            }
            if (button === 'ColorYellow') {
                this.displayScreen(this.player.creative ? new GuiContainerCreative(this.player) : new GuiPlayerInventory(this.player));
            }
            if (button === 'ColorBlue') {
                this.player.inventory.shiftSelectedSlot(1);
            }
        }

        // Select hotbar slot
        for (let i = 1; i <= 9; i++) {
            if (button === this.settings['keyHotbar' + i]) {
                this.player.inventory.selectedSlotIndex = i - 1;
            }
        }

        // Road builder controls while its tool is held
        if (this.roadBuilder && this.roadBuilder.isToolSelected()) {
            if (button === "Equal" || button === "NumpadAdd") {
                this.roadBuilder.adjustWidth(1);
                return;
            }
            if (button === "Minus" || button === "NumpadSubtract") {
                this.roadBuilder.adjustWidth(-1);
                return;
            }
            if (button === "KeyR") {
                this.roadBuilder.cycleVariant();
                return;
            }
        }

        // Toggle perspective
        if (button === this.settings.keyTogglePerspective) {
            this.settings.thirdPersonView = (this.settings.thirdPersonView + 1) % 3;
            this.settings.save();
        }

        // Open chat
        if (button === this.settings.keyOpenChat) {
            this.displayScreen(new GuiChat(this));
            this.ingameOverlay.chatOverlay.setDirty();
        }

        // Open chat commands
        if (button === this.settings.keyOpenCommands) {
            const chatScreen = new GuiChat(this);
            chatScreen.inputField.setText("/");
            this.displayScreen(chatScreen);
            this.ingameOverlay.chatOverlay.setDirty();
        }

        // Toggle debug overlay
        if (button === this.settings.keyDebug) {
            this.settings.debugOverlay = !this.settings.debugOverlay;
            this.settings.save();
        }

        // Toggle chunk boundaries with Debug + G
        if (button === "KeyG" && Keyboard.isKeyDown(this.settings.keyDebug)) {
            this.settings.showChunkBoundaries = !this.settings.showChunkBoundaries;
            this.settings.save();
        }

        // Toggle entity bounding boxes with Debug + B
        if (button === "KeyB" && Keyboard.isKeyDown(this.settings.keyDebug)) {
            this.settings.showEntityBoundingBoxes = !this.settings.showEntityBoundingBoxes;
            this.settings.save();
        }

        // Toggle GUI visibility - only in-game, not in menus
        if (button === this.settings.keyToggleGui) {
            if (this.currentScreen === null && this.isInGame()) {
                GuiFunctions.toggleGui();
                if (GuiFunctions.isGuiHidden() && this.itemRenderer) {
                    this.itemRenderer.destroy("hotbar");
                }
            }
        }

        // Take screenshot
        if (button === this.settings.keyScreenshot) {
            GuiFunctions.takeScreenshot(this.window.canvas);
        }

        // Drop held item
        if (button === this.settings.keyDrop) {
            if (this.player.spectator) return;
            if (this.player.inventory.getItemInSelectedSlot() !== 0 && this.player.inventory.getItemInSelectedSlot() !== null && this.player.inventory.getItemInSelectedSlot()?.isEmpty() === false) {
                let itemStack = this.player.inventory.getItemInSelectedSlot();

                if (this.isSingleplayer()) {
                    // Singleplayer: create entity locally. Items dropped with Q
                    // keep the pickup delay so they aren't instantly re-picked.
                    let itemEntity = new ItemEntity(this, this.world, itemStack.typeId, this.player.x, this.player.y, this.player.z);
                    itemEntity.hasPickupDelay = true;
                    this.world.addEntity(itemEntity);
                } else {
                    // Multiplayer: tell server to spawn item for all players at
                    // the player's position
                    this.playerController.getNetworkHandler().sendPacket(new ClientDropItemPacket(itemStack.typeId, this.player.x, this.player.y, this.player.z, true));
                }

                // Play drop sound
                this.soundManager.playSound('random.pop', this.player.x, this.player.y, this.player.z, 1.0, 1.0);

                // Decrease stack count by 1, or clear if only 1 item
                if (itemStack.count > 1) {
                    itemStack.count--;
                    this.player.inventory.setItemInSelectedSlot(itemStack);
                } else {
                    this.player.inventory.setItemInSelectedSlot(0);
                }
                this.itemRenderer.destroy("inventory");
                this.itemRenderer.scheduleDirty("hotbar");
            }
        }

        // Open inventory
        if (button === this.settings.keyOpenInventory) {
            if (this.player.spectator) return;
            this.displayScreen(this.player.creative ? new GuiContainerCreative(this.player) : new GuiPlayerInventory(this.player));
        }

        // Voice chat push-to-talk begins on key-down (ends on key-up)
        if (button === this.settings.keyVoiceChat) {
            if (this.voiceChat) {
                this.voiceChat.onKeyPressed();
            }
        }
    }

    /** Key released while in game (no screen open). Used e.g. by push-to-talk. */
    onKeyReleased(button) {
        if (this.voiceChat && button === this.settings.keyVoiceChat) {
            this.voiceChat.onKeyReleased();
        }
    }

    onMouseClicked(button) {
        if (this.window.isLocked()) {
            // Spectators cannot interact with the world
            if (this.player.spectator) return;

            let hitResult = this.player.rayTrace(5, this.timer.partialTicks);

            // Attack entity
            if (button === 0) {
                let entity = this.rayTraceEntity(5, this.timer.partialTicks);
                if (entity && entity !== this.player && entity instanceof PlayerEntity && !entity.creative && !entity.spectator) {
                    if (this.player.attackCooldown > 0) {
                        return;
                    }
                    if (entity.renderer) {
                        entity.renderer.hurtTimestamp = performance.now();
                    }
                    let damage = this.getAttackDamage();
                    entity.damageEntity(damage, this.player.username);
                    this.player.attackCooldown = 30;
                    if (!this.isSingleplayer()) {
                        const nm = this.playerController.getNetworkHandler().getNetworkManager();
                        if (nm) nm.sendJson({ type: 'attack', target: entity.id, damage: damage, attacker: this.player.username });
                    }
                    this.player.swingArm();
                    return;
                }

                if (hitResult != null) {
                    if (this.player.creative) {
                        // A hit on the posed summoned field addresses cells in
                        // the field's local space: destroy the cell in the field
                        // and never touch the real world grid. The field's own
                        // cell-sync hook tells the server about the removal.
                        let field = hitResult.fieldCell && this.world.offGridField
                            ? this.world.offGridField : null;

                        if (field) {
                            let cellId = field.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
                            let cellBlock = Block.getById(cellId);
                            if (cellId !== 0 && cellBlock !== null) {
                                let fieldWorld = field.createLocalWorld();
                                let face = this.getFaceValue(hitResult.face);
                                let metadata = fieldWorld.getBlockDataAt(hitResult.x, hitResult.y, hitResult.z);

                                if (typeof cellBlock.onMouseButton === 'function' &&
                                    cellBlock.onMouseButton(fieldWorld, hitResult.x, hitResult.y, hitResult.z, button)) {
                                    return;
                                }

                                let breakAction = this.emitBlockAction('break', hitResult.x, hitResult.y, hitResult.z, {
                                    world: fieldWorld,
                                    face,
                                    metadata,
                                    offGrid: true
                                });
                                if (breakAction.canceled) return;
                            }

                            let sound = cellBlock ? cellBlock.getSound().getBreakSound() : null;
                            if (sound) this.soundManager.playSoundMono(sound, 1.0, 1.0);

                            this.particleRenderer.spawnBlockBreakParticle(this.world, hitResult.x, hitResult.y, hitResult.z,
                                field.getParticlePose(), cellBlock);

                            field.applyWrite(hitResult.x, hitResult.y, hitResult.z, 0);
                            this.player.swingArm();
                            return;
                        }

                        // Get previous block
                        let typeId = this.world.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
                        let block = Block.getById(typeId);
                        // The type can read 0 (air) with a valid hit (e.g. field
                        // edge cases or raced chunk updates) and unregisterd ids
                        // resolve to null - guard the interaction call.
                        if (block != null && block.onMouseButton(this.world, hitResult.x, hitResult.y, hitResult.z, button)) return;

                        if (typeId !== 0 && block != null) {
                            let breakAction = this.emitBlockAction('break', hitResult.x, hitResult.y, hitResult.z, {
                                face: this.getFaceValue(hitResult.face),
                                metadata: this.world.getBlockDataAt(hitResult.x, hitResult.y, hitResult.z)
                            });
                            if (breakAction.canceled) return;

                            let soundName = block.getSound().getBreakSound();

                            // Play sound
                            this.soundManager.playSoundMono(soundName, 1.0, 1.0);

                            // Get block ID before destroying
                            let blockId = this.world.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
                            let droppedBlock = Block.getById(blockId).getDrop(this.world, hitResult.x, hitResult.y, hitResult.z)

                            this.particleRenderer.spawnBlockBreakParticle(this.world, hitResult.x, hitResult.y, hitResult.z, null);

                            // Destroy block
                            this.world.setBlockAt(hitResult.x, hitResult.y, hitResult.z, 0);

                            // Drop items (add to player inventory)
                            if (!this.player.creative) {
                                for (const [dropId, dropCount] of Block.normalizeDrops(droppedBlock)) {
                                    this.player.inventory.addItem(dropId, dropCount);
                                }
                            }

                            // Send block digging packet in multiplayer
                            if (!this.isSingleplayer()) {
                                let blockPos = new BlockPosition(hitResult.x, hitResult.y, hitResult.z);
                                let face = 0; // Default face
                                this.playerController.sendBlockDiggingPacket(2, blockPos, face);
                            }
                        }
                    }
                }
                this.player.swingArm();
            }

            // Pick block
            if (button === 1 && this.player.creative) {
                if (hitResult != null) {
                    // A summoned-cell hit is reported in the field's LOCAL
                    // coordinates, so the real world usually reads air there.
                    // Pick the cell's block instead.
                    let field = hitResult.fieldCell && this.world.offGridField
                        ? this.world.offGridField : null;
                    let typeId = field
                        ? field.getBlockAt(hitResult.x, hitResult.y, hitResult.z)
                        : this.world.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
                    if (typeId > 0) {
                        let block = Block.getById(typeId);
                        if (block === null) return;
                        let pickedItemId = block.pickedItem();
                        if (pickedItemId === null) return;
                        // Switch to slot if item is already in hotbar
                        for (let i = 0; i < 9; i++) {
                            let itemStack = this.player.inventory.getItemInSlot(i);
                            if (!itemStack.isEmpty() && itemStack.getType() === pickedItemId) {
                                this.player.inventory.selectedSlotIndex = i;
                                if (this.player.inventory.itemRenderer) {
                                    this.player.inventory.itemRenderer.scheduleDirty("hotbar");
                                }
                                return;
                            }
                        }

                        // Set item in hotbar
                        this.player.inventory.setItemInSelectedSlot(typeId);
                    }
                }
            }

            // Use item / eat
            if (button === 2) {
                let heldItem = this.player.inventory.getItemInSelectedSlot();

                if (heldItem && !heldItem.isEmpty() && Block.getById(heldItem.getType())?.isItem()) {
                    let x = undefined;
                    let y = undefined;
                    let z = undefined;
                    if (hitResult != null) {
                        x = hitResult.x + hitResult.face.x;
                        y = hitResult.y + hitResult.face.y;
                        z = hitResult.z + hitResult.face.z;
                    }
                    // hitResult can be null (using an item while aiming at the
                    // sky): x/y/z are undefined then, and so is the face -
                    // reading hitResult.face here crashed the click handler.
                    // A hit on the summoned field addresses cells in the
                    // field's LOCAL space, so placer items must read and
                    // write through the field's proxy world instead of the
                    // real one (which would write to the world grid at the
                    // local coordinates and packet the server about a
                    // placement that never rendered there).
                    let itemWorld = this.world;
                    if (hitResult != null && hitResult.fieldCell && this.world.offGridField) {
                        itemWorld = this.world.offGridField.createLocalWorld();
                    }

                    let heldBlock = Block.getById(heldItem.getType());
                    if (hitResult != null && typeof heldBlock?.onUseOnBlockServer === 'function') {
                        let interactAction = this.emitBlockAction('interact', hitResult.x, hitResult.y, hitResult.z, {
                            world: itemWorld,
                            currentBlockId: heldItem.getType(),
                            face: this.getFaceValue(hitResult.face),
                            metadata: itemWorld.getBlockDataAt(hitResult.x, hitResult.y, hitResult.z),
                            offGrid: !!hitResult.fieldCell
                        });
                        if (interactAction.canceled) return;
                    }

                    heldBlock.onUse(itemWorld, x, y, z, heldItem,
                        hitResult != null ? hitResult.face : undefined);
                    return;
                }

                if (hitResult != null) {
                    let x = hitResult.x + hitResult.face.x;
                    let y = hitResult.y + hitResult.face.y;
                    let z = hitResult.z + hitResult.face.z;

                    // A hit on the posed summoned field addresses cells in the
                    // field's local space - edit the field directly instead of
                    // writing the real world at those (grid) coordinates.
                    let field = hitResult.fieldCell ? this.world.offGridField : null;
                    let queryWorld = field ? field.createLocalWorld() : this.world;

                    let blockCheck = Block.getById(queryWorld.getBlockAt(hitResult.x, hitResult.y, hitResult.z));
                    if (this.isInteractiveBlock(blockCheck)) {
                        let interactAction = this.emitBlockAction('interact', hitResult.x, hitResult.y, hitResult.z, {
                            world: queryWorld,
                            face: this.getFaceValue(hitResult.face),
                            metadata: queryWorld.getBlockDataAt(hitResult.x, hitResult.y, hitResult.z),
                            offGrid: !!field
                        });
                        if (interactAction.canceled) return;

                        if (blockCheck.onMouseButton(queryWorld, hitResult.x, hitResult.y, hitResult.z, button)) {
                            // In multiplayer, tell the server so the interaction
                            // (e.g. door toggle) is applied authoritatively and
                            // broadcast to all players. A summoned cell's data
                            // write is synced through OffGridClientSync instead,
                            // so the vanilla packet must not use local coordinates.
                            if (!field && !this.isSingleplayer()) {
                                let blockPos = new BlockPosition(hitResult.x, hitResult.y, hitResult.z);
                                this.playerController.sendBlockPlacementPacket(blockPos, 255, { id: -1 });
                            }
                            return;
                        }
                    }

                    let blockedByPlayer;
                    if (field) {
                        // Test against the cell's posed world bounds - local grid
                        // coordinates say nothing about where the block sits.
                        let cellBounds = field.cellWorldBounds(x, y, z);
                        blockedByPlayer = !!cellBounds && cellBounds.intersects(this.player.boundingBox);
                    } else {
                        let placedBoundingBox = new BoundingBox(x, y, z, x + 1, y + 1, z + 1);
                        blockedByPlayer = placedBoundingBox.intersects(this.player.boundingBox);
                    }

                    // Don't place blocks if the player is standing there
                    if (!blockedByPlayer) {
                        let typeId = this.player.inventory.getItemInSelectedSlot();
                        typeId = typeId.getType() || 0;

                        // Get previous block
                        let prevTypeId = queryWorld.getBlockAt(x, y, z);
                        let prevBlock = Block.getById(prevTypeId);
                        let isReplaceable = (prevBlock && prevBlock.isReplaceable(queryWorld, x, y, z)) || prevTypeId === 0;

                        // Only real blocks can be placed. An empty hand or a
                        // non-block item (bucket, flint, ...) has no block to put
                        // in the world, and guessing one here would push an id the
                        // server cannot resolve into the save file.
                        let block = Block.getById(typeId);

                        // Clicking the top of an existing pavement slope adds
                        // a layer to it instead of placing a layer one cell
                        // above, matching snow-layer behavior.
                        if (!field && block?.isPavementSlope === true && hitResult.face.y === 1) {
                            const clickedX = hitResult.x;
                            const clickedY = hitResult.y;
                            const clickedZ = hitResult.z;
                            const clickedId = queryWorld.getBlockAt(clickedX, clickedY, clickedZ);
                            if (clickedId === typeId) {
                                const layerData = queryWorld.getBlockDataAt(clickedX, clickedY, clickedZ) & 7;
                                if (layerData < 7) {
                                    let placeAction = this.emitBlockAction('place', clickedX, clickedY, clickedZ, {
                                        world: queryWorld,
                                        clickedPos: { x: hitResult.x, y: hitResult.y, z: hitResult.z },
                                        face: this.getFaceValue(hitResult.face),
                                        metadata: queryWorld.getBlockDataAt(clickedX, clickedY, clickedZ)
                                    });
                                    if (placeAction.canceled) return;

                                    queryWorld.setBlockDataAt(clickedX, clickedY, clickedZ, layerData + 1);

                                    if (!this.player.creative) {
                                        this.player.inventory.removeItem(typeId, 1, this.player.inventory.selectedSlotIndex);
                                    }
                                    this.player.swingArm();

                                    if (!this.isSingleplayer() &&
                                        typeof this.playerController.sendBlockPlacementPacket === "function") {
                                        this.playerController.sendBlockPlacementPacket(
                                            new BlockPosition(clickedX, clickedY, clickedZ),
                                            255,
                                            { id: typeId }
                                        );
                                    }
                                    return;
                                }
                            }
                        }

                        let placeable = typeId !== 0 && isReplaceable && block !== null && !block.isItem() &&
                            (typeof block.canPlaceAt !== "function" ||
                                block.canPlaceAt(queryWorld, x, y, z, hitResult.face));

                        if (placeable) {
                            // Calculate block data for rotation
                            let blockData = 0;

                            // Set rotation data for logs based on placement face
                            if (block.constructor.name === 'BlockLog') {
                                if (hitResult.face.isXAxis()) {
                                    blockData = 1; // East-west
                                } else if (hitResult.face.isZAxis()) {
                                    blockData = 2; // North-south
                                }
                            }

                            // Slab top/bottom based on placement face
                            if (block.constructor.name === 'BlockSlab') {
                                if (hitResult.face.y === -1) {
                                    blockData = 1; // Top slab
                                }
                            }

                            // Chest/furnace facing based on player yaw
                            if (block.constructor.name === 'BlockChest' || block.constructor.name === 'BlockFurnace' ||
                                block.constructor.name === 'BlockCounterDrawer' || block.constructor.name === 'BlockCounterOven' ||
                                block.constructor.name === 'BlockTrafficBarrier') {
                                let dirIndex = Math.floor((this.player.rotationYaw * 4 / 360) + 0.5) & 3;
                                blockData = [2, 5, 3, 4][dirIndex]; // 2=N, 3=S, 4=W, 5=E - front faces player
                            }

                            let placeAction = this.emitBlockAction('place', x, y, z, {
                                world: queryWorld,
                                clickedPos: { x: hitResult.x, y: hitResult.y, z: hitResult.z },
                                face: this.getFaceValue(hitResult.face),
                                metadata: queryWorld.getBlockDataAt(x, y, z),
                                offGrid: !!field
                            });
                            if (placeAction.canceled) return;

                            // Place block into the summoned field when the hit
                            // was on it: its cells use their own coordinate
                            // space and sync through the field's cell hook, so
                            // the real world grid is never written here.
                            if (field) {
                                field.applyWrite(x, y, z, typeId, blockData);
                            } else {
                                this.world.setBlockAt(x, y, z, typeId, blockData);
                            }

                            // Remove from inventory in survival mode
                            if (!this.player.creative) {
                                this.player.inventory.removeItem(typeId, 1, this.player.inventory.selectedSlotIndex);
                            }

                            // Swing player arm
                            this.player.swingArm();

                            // Handle block abilities
                            block.onBlockPlaced(queryWorld, x, y, z, hitResult.face);

                            // Play sound (at the posed world position of the
                            // target cell when editing the summoned field)
                            let sound = block.getSound();
                            let soundName = sound.getStepSound();
                            let soundPos = field
                                ? field.localToWorld({ x: x + 0.5, y: y + 0.5, z: z + 0.5 })
                                : { x: hitResult.x + 0.5, y: hitResult.y + 0.5, z: hitResult.z + 0.5 };
                            this.soundManager.playSound(
                                soundName,
                                soundPos.x,
                                soundPos.y,
                                soundPos.z,
                                1.0,
                                sound.getPitch() * 0.8
                            );

                            // Send the vanilla placement packet only for real
                            // world blocks. Field edits already went through
                            // applyWrite(), whose cell-sync hook sends the
                            // local-grid edit to the server.
                            if (!field && !this.isSingleplayer()) {
                                let blockPos = new BlockPosition(hitResult.x, hitResult.y, hitResult.z);
                                let direction = this.getFaceValue(hitResult.face);
                                let heldItem = { id: typeId };
                                this.playerController.sendBlockPlacementPacket(blockPos, direction, heldItem);
                            }
                        }
                    }
                }
            }

            // Rebuild multiple chunk sections
            this.worldRenderer.flushRebuild = true;
        }
    }

    onMouseScroll(delta) {
        if (this.isInGame()) {
            this.player.inventory.shiftSelectedSlot(delta);
        }
    }

    isPaused() {
        if (this.currentScreen) {
            // In multiplayer, menus never pause the game
            if (!this.isSingleplayer()) {
                return false;
            }
            if (this.currentScreen.pauseGame === false) {
                return false;
            }
            if (this.currentScreen.pauseGame === true) {
                return true;
            }
        }
        return !this.hasInGameFocus() && this.loadingScreen === null && this.isSingleplayer();
    }

    setSession(session, save = false) {
        this.session = session;

        const profile = session && session.getProfile ? session.getProfile() : null;
        if (profile && profile.username) {
            this.settings.username = profile.username;
        } else if (!session) {
            this.settings.username = "";
        }

        // Save session
        if (save) {
            this.settings.session = session ? session.toJson() : null;
            this.settings.save();
        }
    }

    updateAccessToken(token) {
        this.session.setAccessToken(token);
        this.setSession(this.session, true);
    }

    getSession() {
        return this.session;
    }

    isSingleplayer() {
        return this.isInGame() && !(this.playerController instanceof PlayerControllerMultiplayer);
    }

    /**
     * True for a local (singleplayer) session. Singleplayer is served by the
     * in-page integrated server over the loopback transport, so the client uses
     * a PlayerControllerMultiplayer there too and isSingleplayer() is false.
     */
    isLocalSession() {
        return this.isInGame() && (this.isSingleplayer() || this.isConnectedToIntegratedServer);
    }

    /**
     * Seed of the local world, or null when unknown (e.g. a remote multiplayer
     * server never discloses its seed). The value comes from the seed handed to
     * the integrated server, since the client-side WorldClient has no generator.
     */
    getLocalSeed() {
        if (!this.isLocalSession()) return null;
        const seed = this.currentWorldSeed;
        if (seed) {
            const low = BigInt(seed.low >>> 0);
            const high = BigInt(seed.high >>> 0);
            let value = (high << 32n) | low;
            if (high & 0x80000000n) value -= 1n << 64n;
            return value.toString();
        }
        if (this.world) {
            const worldSeed = this.world.getSeed();
            if (worldSeed) return String(worldSeed);
        }
        return null;
    }

    stop() {
        if (this.currentScreen !== null) {
            this.currentScreen.onClose();
        }
        this.running = false;
        this.worldRenderer.reset();
        this.itemRenderer.reset();
        this.screenRenderer.reset();
        this.window.close();
    }

    getThreeTexture(id) {
        if (!(id in this.resources)) {
            console.error("Texture not found: " + id);
            return;
        }

        let image = this.resources[id];
        let canvas = document.createElement('canvas');
        let context = canvas.getContext("2d");
        canvas.width = image.width;
        canvas.height = image.height;
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 0, 0, image.width, image.height);
        return new THREE.CanvasTexture(canvas);
    }

    rayTraceEntity(reach, partialTicks) {
        let from = this.player.getPositionEyes(partialTicks);
        let look = this.player.getLook(partialTicks);
        let to = new Vector3(
            from.x + look.x * reach,
            from.y + look.y * reach,
            from.z + look.z * reach
        );

        let closest = null;
        let closestDist = reach;

        for (let entity of this.world.entities) {
            if (entity === this.player || !entity.boundingBox) continue;

            let bb = entity.boundingBox.grow(0.1, 0.1, 0.1);
            let hit = this.intersectRayAABB(from, to, bb);
            if (hit !== null) {
                let dist = from.distanceTo(hit);
                if (dist < closestDist) {
                    closestDist = dist;
                    closest = entity;
                }
            }
        }

        return closest;
    }

    intersectRayAABB(from, to, bb) {
        let dir = new Vector3(to.x - from.x, to.y - from.y, to.z - from.z);

        let tMin = -Infinity;
        let tMax = Infinity;

        if (dir.x !== 0) {
            let tx1 = (bb.minX - from.x) / dir.x;
            let tx2 = (bb.maxX - from.x) / dir.x;
            tMin = Math.max(tMin, Math.min(tx1, tx2));
            tMax = Math.min(tMax, Math.max(tx1, tx2));
        } else if (from.x < bb.minX || from.x > bb.maxX) {
            return null;
        }

        if (dir.y !== 0) {
            let ty1 = (bb.minY - from.y) / dir.y;
            let ty2 = (bb.maxY - from.y) / dir.y;
            tMin = Math.max(tMin, Math.min(ty1, ty2));
            tMax = Math.min(tMax, Math.max(ty1, ty2));
        } else if (from.y < bb.minY || from.y > bb.maxY) {
            return null;
        }

        if (dir.z !== 0) {
            let tz1 = (bb.minZ - from.z) / dir.z;
            let tz2 = (bb.maxZ - from.z) / dir.z;
            tMin = Math.max(tMin, Math.min(tz1, tz2));
            tMax = Math.min(tMax, Math.max(tz1, tz2));
        } else if (from.z < bb.minZ || from.z > bb.maxZ) {
            return null;
        }

        if (tMin > tMax || tMax < 0) return null;

        let t = tMin < 0 ? tMax : tMin;
        return new Vector3(from.x + dir.x * t, from.y + dir.y * t, from.z + dir.z * t);
    }

    getFaceValue(face) {
        // Minecraft protocol face values (version 47)
        // 0: Bottom (Y-), 1: Top (Y+), 2: North (Z-), 3: South (Z+), 4: West (X-), 5: East (X+)
        if (face.y === -1) return 0; // Bottom
        if (face.y === 1) return 1;  // Top
        if (face.z === -1) return 2; // North
        if (face.z === 1) return 3;  // South
        if (face.x === -1) return 4; // West
        if (face.x === 1) return 5;  // East
        return 0; // Default
    }

    getAttackDamage() {
        let heldItem = this.player.inventory.getItemInSelectedSlot();
        if (heldItem.isEmpty()) {
            return 1;
        }
        let item = Block.getById(heldItem.getType());
        if (item && item.isTool && item.toolType) {
            let materialLevel = ItemTool.materials.indexOf(item.material);
            if (item.toolType === 'sword') {
                return 1 + materialLevel;
            }
            if (item.toolType === 'axe') {
                return 0.5 + materialLevel;
            }
        }
        return 1;
    }
}