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
import CctvManager from "./CctvManager.js";
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
    static PROTOCOL_VERSION = 47; 

    static PROXY = {
        "url": "ws://127.0.0.1:25565"
    };

    
    constructor(canvasWrapperId, resources) {
        this.resources = resources;

        this.currentScreen = null;
        this.loadingScreen = null;
        this.world = null;
        this.player = null;
        this.currentWorldKey = null;
        this.currentWorldSeed = null;
        this.isConnectedToIntegratedServer = false;
        this.playerController = null;
        this.serverRules = { allowTNT: true, allowLiquidFlow: true };
        this.fps = 0;
        this.maxFps = 0;

        this.timer = new Timer(20);

        this.settings = new GameSettings();
        this.settings.load();
        this.settings.language = I18n.setLanguage(this.settings.language);

        AuthLib.setApiBaseUrl(this.settings.apiUrl);

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

        if (this.settings.session === null) {
            if (!this.settings.username) this.loggedIn = false;
            let username = this.settings.username || generateUsername();
            let profile = new GameProfile(UUID.randomUUID(), username);
            this.setSession(new Session(profile, ""));
        } else {
            this.setSession(Session.fromJson(this.settings.session));
        }

        this.window = new GameWindow(this, canvasWrapperId);

        this.worldRenderer = new WorldRenderer(this, this.window);
        this.screenRenderer = new ScreenRenderer(this, this.window);
        this.itemRenderer = new ItemRenderer(this, this.window);

        this.ingameOverlay = new IngameOverlay(this, this.window);

        this.commandHandler = new CommandHandler(this);

        this.frames = 0;
        this.lastTime = Date.now();

        BlockRegistry.create();
        BiomeRegistry.create();
        CraftingRegistry.reset();
        SmeltingRegistry.reset();

        this.blockList = BlockRegistry.getAllBlocks();
        this.roadBuilder = new RoadBuilder(this);

        window.__ModBlockClass__ = Block;

        this.initGameState();

        this.registerBlockClass = (id, name, blockClass) => {
            return BlockRegistry.registerBlockClass(id, name, blockClass);
        };

        this.modLoader = new ModLoader(this);

        this.capeManager = new CapeManager(this);
        this.cctvManager = new CctvManager(this);

        this.movementLocks = new Set();

        this.tunnelLib = new TunnelLib(this.settings.tunnelServer);


        this.blockList = BlockRegistry.getAllBlocks();

        this.itemRenderer.initialize();

        this.fontRenderer = new FontRenderer(this);

        this.grassColorizer = new GrassColorizer(this);

        this.particleRenderer = new ParticleRenderer(this);

        this.window.updateWindowSize();

        this.soundManager = new SoundManager();
        this.musicManager = new MusicManager();

        this.voiceChat = new VoiceChatManager(this);

        Sound.init(this);

        this.filesystem = new FileSystem('TexturePackDB', 'texture_packs');

        if (window.isPreLaunch) {
            console.log("Prelaunch mode; game won't start until menu is exited.");
            this.displayScreen(new GuiPrelaunch(this));
        } else {
            this.displayScreen(new GuiMainMenu());
        }

        this.fs = new FileSystem();

        this.lastSaveTime = Date.now();
        this.saveInterval = 30000;

        this.miningTimer = 0;
        this.maxMiningTicks = 30;
        this.lastBlockPos = null;
        this.isMining = false;
        this.miningProgress = 0;

        this.lastChunkCount = 0;
        this.lastChunkArrivalTime = 0;

        this.init();

        this.addMixinHandlers();
    }

    async shareWorld() {
        let code = await this.tunnelLib.createTunnel("ws://loopback");
        this.addMessageToChat("Share code: " + code);
    }
    
    addMixinHandlers() {

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

        Mixin.registerFunction('game:getLookedAtBlock', (reach = 5) => {
            if (!this.world || !this.player) {
                return undefined;
            }

            const hit = this.player.rayTrace(reach, this.timer.partialTicks);
            if (!hit) {
                return null;
            }

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
        this.running = true;
        this.requestNextFrame();
    }

    async loadWorld(world) {
        this.miningTimer = 0;
        this.lastBlockPos = null;
        this.musicManager.stopMusic();

        if (world === null) {
            if (this.world !== null && this.currentWorldKey && this.isLocalSession()) {
                const icon = this._captureWorldIcon();
                if (icon) {
                    await this._storeWorldIcon(this.currentWorldKey, icon);
                    saveWorldIcon(this.currentWorldKey, Minecraft.pngBytesFromDataUrl(icon))
                        .catch((err) => console.error('Failed to save world icon:', err));
                }
            }

            this.modLoader?.unloadServerMods?.();
            this.worldLoadPromise = Promise.resolve();
            if (this.world !== null && this.isSingleplayer()) {
                await this.saveWorld();
            }

            this.isConnectedToIntegratedServer = false;
            this.currentWorldSeed = null;
            this.serverRules = { allowTNT: true, allowLiquidFlow: true };

            this.worldRenderer.reset();
            this.itemRenderer.reset();

            if (this.playerController instanceof PlayerControllerMultiplayer) {
                let networkHandler = this.playerController.getNetworkHandler();
                if (networkHandler.getNetworkManager().isConnected()) {
                    networkHandler.getNetworkManager().close();
                }

                this.ingameOverlay.playerListOverlay.setHeader(null);
                this.ingameOverlay.playerListOverlay.setFooter(null);

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

                this.itemRenderer.reset();
            }
            this.displayScreen(new GuiMainMenu());
        } else {
            if (!(this.playerController instanceof PlayerControllerMultiplayer)) {
                this.displayScreen(new GuiLoadingIntegratedServer(this.currentScreen));
                await new Promise(resolve => setTimeout(resolve, 500));
            }

            this.loadingScreen = new GuiLoadingScreen();
            this.loadingScreen.setTitle("Loading terrain...");
            this.displayScreen(this.loadingScreen);

            this.lastChunkCount = 0;
            this.lastChunkArrivalTime = 0;

            if (this.world !== null) {
                this.world.getChunkProvider().getChunks().clear();
                this.world.clearEntities();
                this.worldRenderer.reset();
                this.itemRenderer.reset();
            }

            this.world = world;
            this.worldRenderer.scene.add(this.world.group);

            if (this.settings.selectedTexturePack && this.worldRenderer.textureAtlas) {
                this.setLoadingStatus("Loading textures...");
                this.worldRenderer.textureAtlas.texturePath = `texture_packs/${this.settings.selectedTexturePack}/`;
                await this.worldRenderer.textureAtlas.loadTextures();
                this.setLoadingStatus("Loading terrain...");
            }

            this.player = this.playerController.createPlayer(this.world);
            this.player.username = this.session.getProfile().getUsername();
            this.world.addEntity(this.player);

            if (this.player.renderer) {
                this.player.renderer.rebuild(this.player);
            }

            if (this.world.getChunkProvider() instanceof ChunkProviderGenerateWorker) {
                this._loadWorldAsync(world);
            } else {
            }
        }
    }

    async _loadWorldAsync(world) {
        this.setLoadingStatus("Loading world data...");

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

        this.setLoadingStatus("Propagating Light");

        while (world.lightUpdateQueue.length > 0) {
            this.propagateLight(world, 12);
            await new Promise(r => setTimeout(r, 0));
        }

        world.spawn.y = world.getHeightAt(world.spawn.x, world.spawn.z) + 1;
        this.player.respawn();

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

    async getWorldList() {
        const index = await this._loadWorldIndex();
        const byKey = new Map(index.map(e => [e.key, e]));
        const serverWorlds = await listServerWorlds();
        const seen = new Set();

        const list = [];
        for (const sw of serverWorlds) {
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
                icon: (idx && idx.icon) || sw.icon || null,
            });
        }

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

    connectToIntegratedServer() {
        const networkManager = new NetworkManager(this);
        networkManager.setNetworkHandler(new NetworkLoginHandler(networkManager));
        networkManager.connect('loopback', 0, { url: 'ws://loopback' });
        this.isConnectedToIntegratedServer = true;

        const mods = this.modLoader ? this.modLoader.getHandshakeMods() : [];
        networkManager.sendPacket(new HandshakePacket(Minecraft.PROTOCOL_VERSION, ProtocolState.LOGIN, mods));
        networkManager.sendPacket(new LoginStartPacket(this.getSession().getProfile().getUsername()));
    }


    
    _captureWorldIcon() {
        if (!this.isInGame() || !this.worldRenderer) return null;

        try {
            this.worldRenderer.render(this.timer ? this.timer.partialTicks : 0);

            const source = this.window.canvasWorld;
            const width = source.width;
            const height = source.height;
            if (!width || !height) return null;

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

            if (!isServerBacked) {
                await this._saveWorldToDB(this.currentWorldKey, saveData);
            }

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

        const serverWorlds = await listServerWorlds();
        const serverEntry = serverWorlds.find(w => w.key === worldKey);

        const index = await this._loadWorldIndex();
        const entry = index.find(e => e.key === worldKey);

        const seedSource = serverEntry || entry;
        this.currentWorldSeed = seedSource
            ? { low: seedSource.seedLow || 0, high: seedSource.seedHigh || 0 }
            : null;

        this._worldIsServerBacked = Boolean(serverEntry);

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

    async _updateWorldIndexOnQuit() {
        if (!this.currentWorldKey || !this.world || !this.player) return;

        const index = await this._loadWorldIndex();            let entry = index.find(e => e.key === this.currentWorldKey);
            if (!entry) {
                entry = { key: this.currentWorldKey, name: '' };
                index.push(entry);
            }

            entry.lastPlayed = Date.now();
        entry.time = this.world.time || 0;
        entry.spawnX = this.world.spawn ? this.world.spawn.x : 0;
        entry.spawnY = this.world.spawn ? this.world.spawn.y : 0;
        entry.spawnZ = this.world.spawn ? this.world.spawn.z : 0;
        entry.gameMode = this.player.creative ? 'creative' : this.player.spectator ? 'spectator' : 'survival';
        await this._saveWorldIndex(index);
    }



    async deleteWorld(worldKey) {
        if (isIntegratedRunning() && getIntegratedServerName() === serverNameForKey(worldKey)) {
            stopIntegratedServer();
        }
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

    
    initGameState() {
        this.gameState = {
            state: "boot",
            inGame: false,
            guiOpen: false,
            screen: null,        
            loading: false,
            pointerLock: false,  
            focusLocked: false, 
            hasFocus: false,    
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

        this.gameState.snapshot = () => JSON.parse(JSON.stringify(this.gameState));

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

    
    publishGameStateToHost() {
        const bridge = typeof window !== "undefined" ? window.modsBridge : null;
        if (!bridge || typeof bridge.reportGameState !== "function") return;

        const gs = this.gameState;
        const session = this.getSession();
        const username = session ? session.getProfile().getUsername() : "";

        const state = {
            state: gs.state,
            singleplayer: this.isLocalSession(),
            paused: gs.paused,
            username: username,
            world: this.currentWorldKey || null
        };

        const key = JSON.stringify(state);
        if (key === this.lastPublishedGameState) return;
        this.lastPublishedGameState = key;

        try {
            bridge.reportGameState(state);
        } catch {
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
        if (this.isPaused() && this.isInGame()) {
            let prevPartialTicks = this.timer.partialTicks;
            this.timer.advanceTime();
            this.timer.partialTicks = prevPartialTicks;
        } else {
            this.timer.advanceTime();
        }

        for (let i = 0; i < this.timer.ticks; i++) {
            this.onTick();
        }

        this.onRender(this.timer.partialTicks);

        this.frames++;

        while (Date.now() >= this.lastTime + 1000) {
            this.fps = this.frames;
            this.maxFps = Math.max(this.maxFps, this.fps);
            this.lastTime += 1000;
            this.frames = 0;
        }

        this.updateGameState();
    }

    onRender(partialTicks) {
        if (this.isInGame()) {
            if (this.hasInGameFocus()) {
                let deltaX = this.window.pullMouseMotionX();
                let deltaY = this.window.pullMouseMotionY();
                if (deltaX !== 0 || deltaY !== 0) {
                    this.player.turn(deltaX, deltaY);
                }

                let remoteX = this.window.pullRemoteMotionX();
                let remoteY = this.window.pullRemoteMotionY();
                if (remoteX !== 0 || remoteY !== 0) {
                    this.player.turn(remoteX, remoteY, this.settings.getRemoteSensitivity());
                }
            }

            let lightIterations = 0;
            const lightDeadline = performance.now() + 6;
            while (this.world.updateLights() && lightIterations < 500 && performance.now() < lightDeadline) {
                lightIterations++;
            }

            if (this.player) {
                this.world.cloudTexture.offset.x =  this.player.x * 0.0001 + this.world.cloudOffset;
                this.world.cloudTexture.offset.y = -this.player.z * 0.0001;
                
                this.world.clouds.position.x = this.player.x; 
                this.world.clouds.position.z = this.player.z; 
            }

            if (!this.isPaused()) {
                this.worldRenderer.render(partialTicks);
            }
        }

        this.itemRenderer.render(partialTicks);

        this.screenRenderer.render(partialTicks);
    }

    isElectron() {
        if (typeof window !== 'undefined' && typeof window.process === 'object' && window.process.type === 'renderer') {
            return true;
        }

        if (typeof process !== 'undefined' && typeof process.versions === 'object' && !!process.versions.electron) {
            return true;
        }

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

        if (screen === null && !this.isInGame()) {
            screen = new GuiMainMenu();
        }

        if (this.currentScreen !== null) {
            this.currentScreen.onClose();
        }

        this.currentScreen = screen;

        this.window.updateWindowSize();

        if (screen === null) {
            this.window.updateFocusState(FocusStateType.REQUEST_LOCK);
        } else {
            this.window.updateFocusState(FocusStateType.REQUEST_EXIT);
            screen.setup(this, this.window.width, this.window.height);

            if (!this.isInGame()) {
                this.musicManager.playMusic('menu');
            }
        }

        this.itemRenderer.rebuildAllItems();

        this.updateGameState();
    }

    
    prohibitMovement(source = "default") {
        this.movementLocks.add(String(source));
        this.player?.clearMovementInput?.();
    }

    allowMovement(source = "default") {
        this.movementLocks.delete(String(source));
    }

    isMovementProhibited() {
        return this.movementLocks.size > 0;
    }

    
    setStatusText(text, durationMs = 0) {
        this.ingameOverlay?.setStatusText(text, durationMs);
    }

    clearStatusText() {
        this.ingameOverlay?.clearStatusText();
    }

    onTick() {
        if (this.isInGame() && !this.isPaused()) {
            this.handleMiningTicks();

            this.ingameOverlay.onTick();

            this.cctvManager.onTick();

            this.world.onTick();

            this.worldRenderer.onTick();

            this.particleRenderer.onTick();

            if (this.voiceChat) {
                this.voiceChat.onTick();
            }
        }

        if (this.currentScreen !== null) {
            this.currentScreen.updateScreen();
        }

        if (this.loadingScreen !== null && this.isInGame()
            && !(this.world.getChunkProvider() instanceof ChunkProviderGenerateWorker)) {
            let cameraChunkX = Math.floor(this.player.x) >> 4;
            let cameraChunkZ = Math.floor(this.player.z) >> 4;

            let renderDistance = this.settings.viewDistance;
            let requiredChunks = Math.pow(renderDistance * 2 - 1, 2);
            let loadedChunks = this.world.getChunkProvider().getChunks().size;

            let pendingLight = this.propagateLight(this.world, 6);
            if (pendingLight > 0) {
                this.loadingScreen.setTitle("Propagating Light");
            }

            if (loadedChunks > 0 && pendingLight === 0) {
                this.loadingScreen.setTitle("Building terrain...");
            }

            if (loadedChunks !== this.lastChunkCount) {
                this.lastChunkCount = loadedChunks;
                this.lastChunkArrivalTime = Date.now();
            }

            setTimeout(() => {
                for (let x = -renderDistance + 1; x < renderDistance; x++) {
                    for (let z = -renderDistance + 1; z < renderDistance; z++) {
                        this.world.getChunkAt(cameraChunkX + x, cameraChunkZ + z);
                    }
                }
            }, 0);

            let progress = 1 / requiredChunks * Math.max(0, loadedChunks - this.world.lightUpdateQueue.length / 1000);
            if (pendingLight > 0) {
                progress = Math.min(progress, 0.98);
            }
            this.loadingScreen.setProgress(progress);

            let terrainReady = this._chunksLoadedAround(cameraChunkX, cameraChunkZ, 2);

            let timeoutElapsed = this.lastChunkArrivalTime > 0
                && Date.now() - this.lastChunkArrivalTime > 5000
                && loadedChunks >= 9;

            if ((progress >= 0.99 || timeoutElapsed) && terrainReady && pendingLight === 0) {
                this.world.loadSpawnChunks();
                if (this.isSingleplayer()) {
                    this.player.respawn();
                }
                this.musicManager.playMusic(this.player && this.player.creative ? 'creative' : 'game');
                this.loadingScreen = null;
                this.displayScreen(null);
            }
        }

        if (this.isInGame() && this.world !== null
            && this.world.getChunkProvider() instanceof ChunkProviderGenerateWorker
            && this.loadingScreen === null) {
            let cameraChunkX = Math.floor(this.player.x) >> 4;
            let cameraChunkZ = Math.floor(this.player.z) >> 4;
            let renderDistance = this.settings.viewDistance;

            this.world.getChunkProvider().requestChunksInRadius(cameraChunkX, cameraChunkZ, renderDistance);

            const cctvPos = this.cctvManager?.isViewing()
                ? this.cctvManager.getViewPosition()
                : null;
            if (cctvPos) {
                this.world.getChunkProvider().requestChunksInRadius(
                    Math.floor(cctvPos.x) >> 4,
                    Math.floor(cctvPos.z) >> 4,
                    renderDistance
                );
            }
        }

        if (this.isInGame() && this.isSingleplayer() && this.loadingScreen === null) {
            if (Date.now() - this.lastSaveTime > this.saveInterval) {
                this.lastSaveTime = Date.now();
                this.saveWorld();
            }
        }
    }

    
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

        this.soundManager.playSoundMono('random.pop', 1.0, 1.0);

        this.world.setBlockAt(hitResult.x, hitResult.y, hitResult.z, 0);
        for (const [dropId, dropCount] of drops) {
            for (let index = 0; index < dropCount; index++) {
                if (this.isSingleplayer() || isFieldHit) {
                    this.world.addEntity(new ItemEntity(this, this.world, dropId, hitResult.x, hitResult.y, hitResult.z));
                } else {
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
        this.modLoader?.handleKeyPressed(button);

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

        for (let i = 1; i <= 9; i++) {
            if (button === this.settings['keyHotbar' + i]) {
                this.player.inventory.selectedSlotIndex = i - 1;
            }
        }

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

        if (button === this.settings.keyTogglePerspective) {
            this.settings.thirdPersonView = (this.settings.thirdPersonView + 1) % 3;
            this.settings.save();
        }

        if (button === this.settings.keyOpenChat) {
            this.displayScreen(new GuiChat(this));
            this.ingameOverlay.chatOverlay.setDirty();
        }

        if (button === this.settings.keyOpenCommands) {
            const chatScreen = new GuiChat(this);
            chatScreen.inputField.setText("/");
            this.displayScreen(chatScreen);
            this.ingameOverlay.chatOverlay.setDirty();
        }

        if (button === this.settings.keyDebug) {
            this.settings.debugOverlay = !this.settings.debugOverlay;
            this.settings.save();
        }

        if (button === "KeyG" && Keyboard.isKeyDown(this.settings.keyDebug)) {
            this.settings.showChunkBoundaries = !this.settings.showChunkBoundaries;
            this.settings.save();
        }

        if (button === "KeyB" && Keyboard.isKeyDown(this.settings.keyDebug)) {
            this.settings.showEntityBoundingBoxes = !this.settings.showEntityBoundingBoxes;
            this.settings.save();
        }

        if (button === this.settings.keyToggleGui) {
            if (this.currentScreen === null && this.isInGame()) {
                GuiFunctions.toggleGui();
                if (GuiFunctions.isGuiHidden() && this.itemRenderer) {
                    this.itemRenderer.destroy("hotbar");
                }
            }
        }

        if (button === this.settings.keyScreenshot) {
            GuiFunctions.takeScreenshot(this.window.canvas);
        }

        if (button === this.settings.keyDrop) {
            if (this.player.spectator) return;
            if (this.player.inventory.getItemInSelectedSlot() !== 0 && this.player.inventory.getItemInSelectedSlot() !== null && this.player.inventory.getItemInSelectedSlot()?.isEmpty() === false) {
                let itemStack = this.player.inventory.getItemInSelectedSlot();

                if (this.isSingleplayer()) {
                    let itemEntity = new ItemEntity(this, this.world, itemStack.typeId, this.player.x, this.player.y, this.player.z);
                    itemEntity.hasPickupDelay = true;
                    this.world.addEntity(itemEntity);
                } else {
                    this.playerController.getNetworkHandler().sendPacket(new ClientDropItemPacket(itemStack.typeId, this.player.x, this.player.y, this.player.z, true));
                }

                this.soundManager.playSound('random.pop', this.player.x, this.player.y, this.player.z, 1.0, 1.0);

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

        if (button === this.settings.keyOpenInventory) {
            if (this.player.spectator) return;
            this.displayScreen(this.player.creative ? new GuiContainerCreative(this.player) : new GuiPlayerInventory(this.player));
        }

        if (button === this.settings.keyVoiceChat) {
            if (this.voiceChat) {
                this.voiceChat.onKeyPressed();
            }
        }
    }

    
    onKeyReleased(button) {
        this.modLoader?.handleKeyReleased(button);

        if (this.voiceChat && button === this.settings.keyVoiceChat) {
            this.voiceChat.onKeyReleased();
        }
    }

    onMouseClicked(button) {
        if (this.window.isLocked()) {
            if (this.player.spectator) return;

            let hitResult = this.player.rayTrace(5, this.timer.partialTicks);

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

                        let typeId = this.world.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
                        let block = Block.getById(typeId);
                        if (block != null && block.onMouseButton(this.world, hitResult.x, hitResult.y, hitResult.z, button)) return;

                        if (typeId !== 0 && block != null) {
                            let breakAction = this.emitBlockAction('break', hitResult.x, hitResult.y, hitResult.z, {
                                face: this.getFaceValue(hitResult.face),
                                metadata: this.world.getBlockDataAt(hitResult.x, hitResult.y, hitResult.z)
                            });
                            if (breakAction.canceled) return;

                            let soundName = block.getSound().getBreakSound();

                            this.soundManager.playSoundMono(soundName, 1.0, 1.0);

                            let blockId = this.world.getBlockAt(hitResult.x, hitResult.y, hitResult.z);
                            let droppedBlock = Block.getById(blockId).getDrop(this.world, hitResult.x, hitResult.y, hitResult.z)

                            this.particleRenderer.spawnBlockBreakParticle(this.world, hitResult.x, hitResult.y, hitResult.z, null);

                            this.world.setBlockAt(hitResult.x, hitResult.y, hitResult.z, 0);

                            if (!this.player.creative) {
                                for (const [dropId, dropCount] of Block.normalizeDrops(droppedBlock)) {
                                    this.player.inventory.addItem(dropId, dropCount);
                                }
                            }

                            if (!this.isSingleplayer()) {
                                let blockPos = new BlockPosition(hitResult.x, hitResult.y, hitResult.z);
                                let face = 0; 
                                this.playerController.sendBlockDiggingPacket(2, blockPos, face);
                            }
                        }
                    }
                }
                this.player.swingArm();
            }

            if (button === 1 && this.player.creative) {
                if (hitResult != null) {
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

                        this.player.inventory.setItemInSelectedSlot(typeId);
                    }
                }
            }

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
                            if (!field && !this.isSingleplayer()) {
                                let blockPos = new BlockPosition(hitResult.x, hitResult.y, hitResult.z);
                                this.playerController.sendBlockPlacementPacket(blockPos, 255, { id: -1 });
                            }
                            return;
                        }
                    }

                    let blockedByPlayer;
                    if (field) {
                        let cellBounds = field.cellWorldBounds(x, y, z);
                        blockedByPlayer = !!cellBounds && cellBounds.intersects(this.player.boundingBox);
                    } else {
                        let placedBoundingBox = new BoundingBox(x, y, z, x + 1, y + 1, z + 1);
                        blockedByPlayer = placedBoundingBox.intersects(this.player.boundingBox);
                    }

                    if (!blockedByPlayer) {
                        let typeId = this.player.inventory.getItemInSelectedSlot();
                        typeId = typeId.getType() || 0;

                        let prevTypeId = queryWorld.getBlockAt(x, y, z);
                        let prevBlock = Block.getById(prevTypeId);
                        let isReplaceable = (prevBlock && prevBlock.isReplaceable(queryWorld, x, y, z)) || prevTypeId === 0;

                        let block = Block.getById(typeId);

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
                            let blockData = 0;

                            if (block.constructor.name === 'BlockLog') {
                                if (hitResult.face.isXAxis()) {
                                    blockData = 1; 
                                } else if (hitResult.face.isZAxis()) {
                                    blockData = 2; 
                                }
                            }

                            if (block.constructor.name === 'BlockSlab') {
                                if (hitResult.face.y === -1) {
                                    blockData = 1; 
                                }
                            }

                            if (block.constructor.name === 'BlockChest' || block.constructor.name === 'BlockFurnace' ||
                                block.constructor.name === 'BlockCounterDrawer' || block.constructor.name === 'BlockCounterOven' ||
                                block.constructor.name === 'BlockTrafficBarrier') {
                                let dirIndex = Math.floor((this.player.rotationYaw * 4 / 360) + 0.5) & 3;
                                blockData = [2, 5, 3, 4][dirIndex]; 
                            }

                            let placeAction = this.emitBlockAction('place', x, y, z, {
                                world: queryWorld,
                                clickedPos: { x: hitResult.x, y: hitResult.y, z: hitResult.z },
                                face: this.getFaceValue(hitResult.face),
                                metadata: queryWorld.getBlockDataAt(x, y, z),
                                offGrid: !!field
                            });
                            if (placeAction.canceled) return;

                            if (field) {
                                field.applyWrite(x, y, z, typeId, blockData);
                            } else {
                                this.world.setBlockAt(x, y, z, typeId, blockData);
                            }

                            if (!this.player.creative) {
                                this.player.inventory.removeItem(typeId, 1, this.player.inventory.selectedSlotIndex);
                            }

                            this.player.swingArm();

                            block.onBlockPlaced(queryWorld, x, y, z, hitResult.face);

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

    
    isLocalSession() {
        return this.isInGame() && (this.isSingleplayer() || this.isConnectedToIntegratedServer);
    }

    
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
        if (face.y === -1) return 0; 
        if (face.y === 1) return 1;  
        if (face.z === -1) return 2; 
        if (face.z === 1) return 3;  
        if (face.x === -1) return 4; 
        if (face.x === 1) return 5;  
        return 0; 
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