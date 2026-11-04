import VanillaPreviewWorld from '../VanillaPreviewWorld.js';
import VanillaPreviewChunkProvider from '../provider/VanillaPreviewChunkProvider.js';
import VanillaChunkProvider from '../provider/VanillaChunkProvider.js';
import PlayerController from '../../network/controller/PlayerController.js';
import { prepareVanillaTerrainAtlas, registerVanillaRenderedBlockItems } from '../../render/VanillaTerrainRenderer.js';
import CraftingRegistry from '../../crafting/CraftingRegistry.js';
import SmeltingRegistry from '../../smelting/SmeltingRegistry.js';
import { VANILLA_SOURCE_SHA } from '../../../../../../../packages/vanilla-worldgen/chunk-session.mjs';
import { GuiVanillaPreviewLoading, GuiVanillaPreviewError } from '../../gui/screens/GuiVanillaPreview.js';
import { obfuscateBiomeZoomSeed } from '../../../../../../../packages/vanilla-worldgen/biome-tint.mjs';
import { findNearestDrySpawn } from './VanillaWorldSpawn.js';
import { auditVanillithChunks } from './VanillithChunkAudit.js';
import { summonVanillithMob } from './VanillithEntityPreview.js';
import { VANILLITH_VERSION_LABEL } from './VanillaWorldgenStatus.js';

export async function startVanillaTerrainPreview(minecraft, seedLong, {
    worldKey, worldName = 'Vanillith World', gameMode = 'survival', savedPlayer = null, savedNativeChunks = []
} = {}) {
    if (minecraft.world) throw new Error('Leave the current world before opening a Vanillith world');
    const parent = minecraft.currentScreen;
    const token = {};
    minecraft.vanillaPreviewLaunch = token;
    let world;
    let source;
    const active = () => minecraft.vanillaPreviewLaunch === token;
    const cancel = async () => {
        if (!active()) return;
        minecraft.vanillaPreviewLaunch = null;
        if (world && minecraft.world === world) await minecraft.loadWorld(null);
        else if (world) { world.cleanup(); await world.chunkProvider.terminate(); }
        else await source?.terminate();
        minecraft.loadingScreen = null;
        if (parent) parent.createClicked = false;
        minecraft.displayScreen(parent);
    };
    const loading = new GuiVanillaPreviewLoading(cancel);
    loading.setTitle(`Creating ${VANILLITH_VERSION_LABEL} world...`);
    minecraft.loadingScreen = loading;
    minecraft.displayScreen(loading);
    try {
        source = new VanillaChunkProvider(seedLong.toString(), 'overworld', { decorationDraft: true, worldKey,
            warmCache: minecraft.settings.vanillithWarmCache, memoryPreset: minecraft.settings.vanillithMemoryPreset });
        const initialChunkX = savedPlayer?.position ? Math.floor(savedPlayer.position.x / 16) : 0;
        const initialChunkZ = savedPlayer?.position ? Math.floor(savedPlayer.position.z / 16) : 0;
        const centerReady = source.getTerrainChunkAtAsync(initialChunkX, initialChunkZ);
        centerReady.catch(() => {});
        const decorationServiceReady = source.prepareDecorationService();
        const atlas = minecraft.worldRenderer.textureAtlas;
        const deadline = Date.now() + 15000;
        while (!atlas.loaded) {
            if (!active()) return;
            if (Date.now() > deadline) throw new Error('Texture atlas did not finish loading');
            await new Promise(resolve => setTimeout(resolve, 50));
        }
        const stateMap = await prepareVanillaTerrainAtlas(atlas);
        if (!active()) return;
        const renderedItems = registerVanillaRenderedBlockItems();
        CraftingRegistry.setVanillaRenderedItems(renderedItems.items);
        CraftingRegistry.refreshVanillaRecipes();
        SmeltingRegistry.refreshVanillaRecipes();
        world = new VanillaPreviewWorld(minecraft);
        world.biomeZoomSeed = await obfuscateBiomeZoomSeed(source.seed);
        for (const payload of savedNativeChunks ?? []) {
            if (payload?.format === 'breakmine:vanilla-chunk-v1') world.vanillithDirtyChunks.set(`${payload.chunkX},${payload.chunkZ}`, payload);
        }
        if (!active()) return;
        world.setChunkProvider(new VanillaPreviewChunkProvider(world, source,
            { protocol: 1, source: VANILLA_SOURCE_SHA, token: 1, settings: 'overworld', minY: -64, height: 384 }, stateMap,
            { onProgress: progress => loading.setProgress(progress) }));
        minecraft.currentWorldKey = worldKey ?? null;
        world.worldName = worldName;
        world.gameMode = gameMode;
        minecraft.playerController = new PlayerController(minecraft);
        let auditRunning = false;
        minecraft.playerController.sendChatMessage = message => {
            const [command, subcommand, ...args] = message.trim().split(/\s+/);
            if (command?.toLowerCase() !== '/vanillith') {
                minecraft.commandHandler.handleMessage(message.replace(/^\//, ''));
                return;
            }
            if (subcommand === 'summon') {
                if (args.length !== 1 && args.length !== 4) {
                    minecraft.addMessageToChat('Usage: /vanillith summon <mob> [x y z]');
                    return;
                }
                const result = summonVanillithMob(minecraft, world, args[0], args.slice(1));
                if (!result.ok) {
                    minecraft.addMessageToChat(result.reason === 'unknown_type'
                        ? `Unknown preview mob: ${args[0]}. Available: zombie, husk, drowned, skeleton, stray, wither_skeleton.`
                        : result.reason === 'limit'
                            ? 'Vanillith preview mob limit reached (32).'
                            : 'Invalid summon position. Use /vanillith summon <mob> [x y z].');
                    return;
                }
                minecraft.addMessageToChat(`Spawned ${result.type} at ${result.x.toFixed(1)} ${result.y.toFixed(1)} ${result.z.toFixed(1)}.`);
                return;
            }
            if (subcommand === 'combat') {
                if (world.vanillithPlayable) {
                    minecraft.addMessageToChat('Vanillith is already running as a playable world; use the selected game mode from the world settings.');
                    return;
                }
                if (args.length !== 1 || !['on', 'off'].includes(args[0].toLowerCase())) {
                    minecraft.addMessageToChat('Usage: /vanillith combat <on|off>');
                    return;
                }
                const enabled = args[0].toLowerCase() === 'on';
                world.mobCombatEnabled = enabled;
                if (minecraft.player) {
                    minecraft.player.spectator = !enabled;
                    minecraft.player.creative = false;
                    minecraft.player.flying = !enabled;
                    if (enabled && minecraft.player.health <= 0) {
                        minecraft.player.health = 20;
                        minecraft.player.isDead = false;
                        minecraft.player.setPosition(world.spawn.x, world.spawn.y, world.spawn.z);
                    }
                }
                minecraft.addMessageToChat(enabled
                    ? 'Mob combat enabled.'
                    : 'Mob combat disabled.');
                return;
            }
            const [rawRadius, ...extra] = args;
            if (extra.length || (rawRadius !== undefined && (!/^\d+$/.test(rawRadius) || Number(rawRadius) > 2))) {
                minecraft.addMessageToChat('Usage: /vanillith audit [radius 0-2] | /vanillith status | /vanillith summon <mob> [x y z] | /vanillith combat <on|off> | /vanillith help');
                return;
            }
            if (subcommand === 'help' || !subcommand) {
                minecraft.addMessageToChat('/vanillith audit [0-2] checks chunks; /vanillith status shows streaming; /vanillith summon <mob> [x y z] spawns a mob.');
                return;
            }
            const provider = world?.getChunkProvider?.();
            if (subcommand === 'status') {
                const snapshot = provider?.streamingSnapshot?.() ?? {};
                minecraft.addMessageToChat(`Vanillith ${source.seed} | loaded ${world?.nativeChunks?.chunks?.size ?? 0} | desired ${snapshot.desired ?? 0} | generating ${snapshot.generationInFlight ?? 0} terrain / ${snapshot.terrainInFlight ?? 0} dependencies | errors ${provider?.error?.message ?? 'none'}`);
                return;
            }
            if (subcommand !== 'audit') {
                minecraft.addMessageToChat('Unknown Vanillith command. Try /vanillith help.');
                return;
            }
            if (auditRunning) {
                minecraft.addMessageToChat('Vanillith audit is already running.');
                return;
            }
            const radius = rawRadius === undefined ? 1 : Number(rawRadius);
            auditRunning = true;
            minecraft.addMessageToChat(`Auditing nearby chunks (radius ${radius}) with independent diagnostic workers…`);
            auditVanillithChunks(minecraft, radius).then(lines => {
                for (const line of lines) minecraft.addMessageToChat(line);
            }, error => minecraft.addMessageToChat(`Vanillith audit failed: ${error.message}`)).finally(() => { auditRunning = false; });
        };
        await minecraft.loadWorld(world);
        if (!active() || minecraft.world !== world) return;
        minecraft.loadingScreen = loading;
        minecraft.displayScreen(loading);
        const player = minecraft.player;
        player.spectator = gameMode === 'spectator';
        player.creative = gameMode === 'creative';
        player.flying = gameMode === 'spectator' || gameMode === 'creative';
        player.setPositionAndRotation(8, 200, 8, 0, 20);
        const centerNative = await centerReady;
        await decorationServiceReady;
        if (!active()) return;
        const spawn = savedPlayer?.position
            ? { x: Math.floor(savedPlayer.position.x), y: Math.floor(savedPlayer.position.y), z: Math.floor(savedPlayer.position.z),
                chunk: { chunkX: initialChunkX, chunkZ: initialChunkZ } }
            : await findNearestDrySpawn(source, centerNative, {
            maxChunkRadius: 16,
            onSearch: () => loading.setTitle('Loading world...')
        });
        if (!active() || minecraft.world !== world) return;
        if (world.chunkProvider.error) throw world.chunkProvider.error;
        if (!active() || minecraft.world !== world) return;
        const spawnX = savedPlayer?.position?.x ?? spawn.x + 0.5;
        const spawnZ = savedPlayer?.position?.z ?? spawn.z + 0.5;
        const spawnY = savedPlayer?.position?.y ?? spawn.y;
        if (![spawnX, spawnY, spawnZ].every(Number.isFinite)) throw new Error(`Invalid dry spawn position: ${spawnX}, ${spawnY}, ${spawnZ}`);
        Object.assign(world.spawn, { x: spawnX, y: spawnY, z: spawnZ });
        if (Number.isFinite(savedPlayer?.spawn?.x)) world.spawn.x = savedPlayer.spawn.x;
        if (Number.isFinite(savedPlayer?.spawn?.y)) world.spawn.y = savedPlayer.spawn.y;
        if (Number.isFinite(savedPlayer?.spawn?.z)) world.spawn.z = savedPlayer.spawn.z;
        if (Number.isFinite(savedPlayer?.time)) world.time = savedPlayer.time;
        player.setPositionAndRotation(spawnX, spawnY, spawnZ,
            savedPlayer?.rotation?.yaw ?? 0, savedPlayer?.rotation?.pitch ?? 20);
        if (![player.x, player.y, player.z, player.prevX, player.prevY, player.prevZ,
            player.rotationYaw, player.rotationPitch, player.prevRotationYaw, player.prevRotationPitch].every(Number.isFinite)) {
            throw new Error('Preview player transform contains a non-finite value');
        }
        const provider = world.getChunkProvider();
        await provider.requestRadius(spawn.chunk.chunkX, spawn.chunk.chunkZ, 2);
        if (!active() || minecraft.world !== world) return;
        if (provider.error) throw provider.error;
        if (savedPlayer?.inventory) player.inventory.applyNetworkState(savedPlayer.inventory);
        if (savedPlayer?.food) player.foodData.restore(savedPlayer.food);
        if (Number.isFinite(savedPlayer?.health)) player.health = savedPlayer.health;
        player.spectator = gameMode === 'spectator';
        player.creative = gameMode === 'creative';
        player.flying = gameMode === 'spectator' || gameMode === 'creative';
        minecraft.loadingScreen = null;
        minecraft.displayScreen(null);
        minecraft.addMessageToChat(`${VANILLITH_VERSION_LABEL} world: ${worldName}. ${gameMode === 'creative' ? 'Creative' : gameMode === 'spectator' ? 'Spectator' : 'Survival'} mode; world and player progress save on quit.`);
        minecraft.addMessageToChat(`Seed: ${source.seed}. WASD to move; mine/place blocks; nearby chunks generate with vanilla decoration.`);
    } catch (error) {
        if (!active()) return;
        if (world && minecraft.world === world) await minecraft.loadWorld(null);
        else if (world) { world.cleanup(); await world.chunkProvider.terminate(); }
        else await source?.terminate();
        minecraft.loadingScreen = null;
        if (parent) parent.createClicked = false;
        const details = [];
        for (let current = error; current; current = current.cause) {
            details.push(current.stack || `${current.name || 'Error'}: ${current.message || current}`);
        }
        minecraft.displayScreen(new GuiVanillaPreviewError(parent, details.join('\n\nCaused by:\n')));
    }
}
