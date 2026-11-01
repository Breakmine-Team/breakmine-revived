const DEFAULT_STORE = () => ({ version: 1, nextId: 1, plots: [] });
const CHUNK_SIZE = 16;
const MAX_PLOT_SIZE = 16; // chunks along one axis (256 blocks)
const MAX_AREA = MAX_PLOT_SIZE * MAX_PLOT_SIZE;
const DEFAULT_RADIUS = 1; // chunks

function blockToChunk(value) {
    return Math.floor(Number(value) / CHUNK_SIZE);
}

function chunkMinBlock(chunk) {
    return chunk * CHUNK_SIZE;
}

function chunkMaxBlock(chunk) {
    return chunk * CHUNK_SIZE + CHUNK_SIZE - 1;
}

function selectionChunk(pos) {
    const chunkX = blockToChunk(pos.x);
    const chunkZ = blockToChunk(pos.z);
    return {
        chunkX,
        chunkZ,
        x: chunkMinBlock(chunkX),
        z: chunkMinBlock(chunkZ)
    };
}

function normalizeUsername(value) {
    const name = String(value ?? '').trim();
    return /^[A-Za-z0-9_]{1,32}$/.test(name) ? name : null;
}

function normalizePlotName(value) {
    const name = String(value ?? '').trim().replace(/\s+/g, ' ');
    return /^[A-Za-z0-9 _.-]{1,32}$/.test(name) ? name : null;
}

function sameName(a, b) {
    return String(a ?? '').toLowerCase() === String(b ?? '').toLowerCase();
}

function normalizePlot(plot) {
    if (!plot || typeof plot !== 'object') return null;

    // Chunk coordinates are the source of truth. Older saves only have block
    // bounds, so snap those outward to the chunks they touch.
    let minChunkX = Math.floor(Number(plot.minChunkX));
    let maxChunkX = Math.floor(Number(plot.maxChunkX));
    let minChunkZ = Math.floor(Number(plot.minChunkZ));
    let maxChunkZ = Math.floor(Number(plot.maxChunkZ));

    if (![minChunkX, maxChunkX, minChunkZ, maxChunkZ].every(Number.isFinite)) {
        const minX = Math.floor(Number(plot.minX));
        const maxX = Math.floor(Number(plot.maxX));
        const minZ = Math.floor(Number(plot.minZ));
        const maxZ = Math.floor(Number(plot.maxZ));
        if (![minX, maxX, minZ, maxZ].every(Number.isFinite)) return null;

        minChunkX = Math.min(blockToChunk(minX), blockToChunk(maxX));
        maxChunkX = Math.max(blockToChunk(minX), blockToChunk(maxX));
        minChunkZ = Math.min(blockToChunk(minZ), blockToChunk(maxZ));
        maxChunkZ = Math.max(blockToChunk(minZ), blockToChunk(maxZ));
    } else {
        const chunkMinX = Math.min(minChunkX, maxChunkX);
        const chunkMaxX = Math.max(minChunkX, maxChunkX);
        const chunkMinZ = Math.min(minChunkZ, maxChunkZ);
        const chunkMaxZ = Math.max(minChunkZ, maxChunkZ);
        minChunkX = chunkMinX;
        maxChunkX = chunkMaxX;
        minChunkZ = chunkMinZ;
        maxChunkZ = chunkMaxZ;
    }

    const owner = normalizeUsername(plot.owner);
    if (!owner) return null;

    const name = normalizePlotName(plot.name) || 'Unnamed';
    const members = Array.isArray(plot.members)
        ? [...new Set(plot.members.map(normalizeUsername).filter(Boolean))]
        : [];

    return {
        id: String(plot.id || `plot_${Date.now().toString(36)}`),
        name,
        owner,
        members: members.filter((member) => !sameName(member, owner)),
        minChunkX,
        maxChunkX,
        minChunkZ,
        maxChunkZ,
        // Block bounds are always full chunks, kept for display and for code
        // that still reads minX/maxX.
        minX: chunkMinBlock(minChunkX),
        maxX: chunkMaxBlock(maxChunkX),
        minZ: chunkMinBlock(minChunkZ),
        maxZ: chunkMaxBlock(maxChunkZ),
        createdAt: Number(plot.createdAt) || Date.now()
    };
}

function normalizeStore(value) {
    const store = DEFAULT_STORE();
    if (!value || typeof value !== 'object') return store;

    store.nextId = Math.max(1, Math.floor(Number(value.nextId) || 1));
    if (Array.isArray(value.plots)) {
        for (const raw of value.plots) {
            const plot = normalizePlot(raw);
            if (plot) store.plots.push(plot);
        }
    }

    for (const plot of store.plots) {
        const match = /^plot_(\d+)$/.exec(plot.id);
        if (match) store.nextId = Math.max(store.nextId, Number(match[1]) + 1);
    }
    return store;
}

function usernamesEqual(a, b) {
    return sameName(a, b);
}

function isOwner(plot, username) {
    return usernamesEqual(plot.owner, username);
}

function canBuild(plot, username) {
    return isOwner(plot, username) ||
        plot.members.some((member) => usernamesEqual(member, username));
}

function getPlotAt(plots, x, z) {
    const chunkX = blockToChunk(x);
    const chunkZ = blockToChunk(z);
    for (const plot of plots) {
        if (chunkX >= plot.minChunkX && chunkX <= plot.maxChunkX &&
            chunkZ >= plot.minChunkZ && chunkZ <= plot.maxChunkZ) {
            return plot;
        }
    }
    return null;
}

function findPlotByName(plots, name) {
    return plots.find((plot) => sameName(plot.name, name)) || null;
}

function overlaps(a, b) {
    return a.minChunkX <= b.maxChunkX && a.maxChunkX >= b.minChunkX &&
        a.minChunkZ <= b.maxChunkZ && a.maxChunkZ >= b.minChunkZ;
}

export default class ModLoad {

    static onLoad(world, minecraft, modLoader) {
        const isServer = !!ModAPI.isServer;
        const client = ModAPI.minecraft;
        const selections = new Map(); // username -> { pos1, pos2 }

        let store = DEFAULT_STORE();
        let loaded = false;
        let hasServerState = false;
        let lastSyncRequest = 0;

        const ready = ModAPI.loadJson('plots', DEFAULT_STORE())
            .then((value) => {
                // A server sync may win the race; never overwrite fresher state
                // with the local fallback copy.
                if (!hasServerState) store = normalizeStore(value);
                loaded = true;
                if (isServer) broadcastState();
            })
            .catch((error) => {
                loaded = true;
                ModAPI.warn('Could not load plot data:', error);
            });

        function save() {
            return ModAPI.saveJson('plots', store).catch((error) => {
                ModAPI.warn('Could not save plot data:', error);
            });
        }

        function broadcastState() {
            if (!isServer) return;
            ModAPI.broadcast({ action: 'state', plots: store.plots });
        }

        function refresh() {
            save();
            broadcastState();
        }

        function usernameOf(context) {
            return normalizeUsername(context?._player?.username || context?.player?.username) || '';
        }

        function positionOf(context) {
            const entity = context?._player || context?.player;
            if (!entity) return null;
            return {
                x: Math.floor(Number(entity.x) || 0),
                y: Math.floor(Number(entity.y) || 0),
                z: Math.floor(Number(entity.z) || 0)
            };
        }

        function say(context, message) {
            context?.addMessageToChat?.(`§e[Plots] §f${message}`);
        }

        function usage(context) {
            say(context, 'Subcommands: pos1, pos2, create <name> [radius in chunks], delete [name], rename <name>, owner <player>, trust <player>, untrust <player>, info, list, cancel');
        }

        function selectionFor(username) {
            const key = username.toLowerCase();
            if (!selections.has(key)) selections.set(key, { pos1: null, pos2: null });
            return selections.get(key);
        }

        function plotAtPlayer(context) {
            const username = usernameOf(context);
            const pos = positionOf(context);
            if (!pos) return { username, pos: null, plot: null };
            return {
                username,
                pos,
                plot: getPlotAt(store.plots, pos.x, pos.z)
            };
        }

        function denyBuild(username, plot) {
            ModAPI.sendToPlayer(username, {
                action: 'notice',
                text: `§cThis plot belongs to ${plot.owner}.`
            });
        }

        function guardBuild(event) {
            if (!loaded) return;
            const plot = getPlotAt(store.plots, event.x, event.z);
            if (!plot || canBuild(plot, event.username)) return;
            event.cancel();
            denyBuild(event.username, plot);
        }

        function guardClientBuild(event) {
            if (!loaded) return;
            const plot = getPlotAt(store.plots, event.x, event.z);
            if (!plot || canBuild(plot, event.username)) return;
            event.cancel();
            client.addMessageToChat(`§cThis plot belongs to ${plot.owner}.`);
        }

        function createPlot(context, nameArg, radiusArg) {
            const username = usernameOf(context);
            if (!username) {
                say(context, '§cCould not determine your username.');
                return true;
            }

            const name = normalizePlotName(nameArg);
            if (!name) {
                say(context, '§cPlot name invalid.');
                return true;
            }
            if (findPlotByName(store.plots, name)) {
                say(context, `§cA plot named "${name}" already exists.`);
                return true;
            }

            const pos = positionOf(context);
            if (!pos) return true;

            const selection = selectionFor(username);
            const playerChunk = selectionChunk(pos);
            let minChunkX;
            let maxChunkX;
            let minChunkZ;
            let maxChunkZ;

            if (selection.pos1 || selection.pos2) {
                const first = selection.pos1 || playerChunk;
                const second = selection.pos2 || playerChunk;
                minChunkX = Math.min(first.chunkX, second.chunkX);
                maxChunkX = Math.max(first.chunkX, second.chunkX);
                minChunkZ = Math.min(first.chunkZ, second.chunkZ);
                maxChunkZ = Math.max(first.chunkZ, second.chunkZ);
            } else {
                const radius = Math.max(1, Math.min(MAX_PLOT_SIZE, Math.floor(Number(radiusArg) || DEFAULT_RADIUS)));
                minChunkX = playerChunk.chunkX - radius;
                maxChunkX = playerChunk.chunkX + radius;
                minChunkZ = playerChunk.chunkZ - radius;
                maxChunkZ = playerChunk.chunkZ + radius;
            }

            const widthChunks = maxChunkX - minChunkX + 1;
            const depthChunks = maxChunkZ - minChunkZ + 1;
            if (widthChunks > MAX_PLOT_SIZE || depthChunks > MAX_PLOT_SIZE || widthChunks * depthChunks > MAX_AREA) {
                say(context, `§cThat plot is too large. Maximum is ${MAX_PLOT_SIZE}x${MAX_PLOT_SIZE} chunks!`);
                return true;
            }

            const candidate = { minChunkX, maxChunkX, minChunkZ, maxChunkZ };
            const collision = store.plots.find((plot) => overlaps(candidate, plot));
            if (collision) {
                say(context, `§cThat area overlaps the plot "${collision.name}" owned by ${collision.owner}!`);
                return true;
            }

            const plot = {
                id: `plot_${store.nextId++}`,
                name,
                owner: username,
                members: [],
                minChunkX,
                maxChunkX,
                minChunkZ,
                maxChunkZ,
                minX: chunkMinBlock(minChunkX),
                maxX: chunkMaxBlock(maxChunkX),
                minZ: chunkMinBlock(minChunkZ),
                maxZ: chunkMaxBlock(maxChunkZ),
                createdAt: Date.now()
            };
            store.plots.push(plot);
            selections.delete(username.toLowerCase());
            refresh();

            say(context, `Created "${plot.name}" for ${plot.owner}.`);
            return true;
        }

        function deletePlot(context, nameArg) {
            const username = usernameOf(context);
            const named = nameArg ? findPlotByName(store.plots, nameArg) : null;
            if (nameArg && !named) {
                say(context, `§cNo plot named "${nameArg}" exists.`);
                return true;
            }
            const plot = named || plotAtPlayer(context).plot;

            if (!plot) {
                say(context, '§cStand inside a plot or name one to delete it.');
                return true;
            }
            if (!isOwner(plot, username)) {
                say(context, `§cOnly ${plot.owner} can delete this plot.`);
                return true;
            }

            store.plots = store.plots.filter((entry) => entry !== plot);
            refresh();
            say(context, `Deleted plot "${plot.name}".`);
            return true;
        }

        function renamePlot(context, nameArg) {
            const { username, plot } = plotAtPlayer(context);
            if (!plot) {
                say(context, '§cStand inside the plot you want to rename.');
                return true;
            }
            if (!isOwner(plot, username)) {
                say(context, `§cOnly ${plot.owner} can rename this plot.`);
                return true;
            }

            const name = normalizePlotName(nameArg);
            if (!name) {
                say(context, '§cPlot name invalid.');
                return true;
            }
            const existing = findPlotByName(store.plots, name);
            if (existing && existing !== plot) {
                say(context, `§cA plot named "${name}" already exists.`);
                return true;
            }

            const oldName = plot.name;
            plot.name = name;
            refresh();
            say(context, `Renamed "${oldName}" to "${plot.name}".`);
            return true;
        }

        function transferPlot(context, targetArg) {
            const { username, plot } = plotAtPlayer(context);
            if (!plot) {
                say(context, '§cStand inside the plot you want to transfer.');
                return true;
            }
            if (!isOwner(plot, username)) {
                say(context, `§cOnly ${plot.owner} can transfer this plot.`);
                return true;
            }

            const target = normalizeUsername(targetArg);
            if (!target) {
                say(context, '§cEnter a valid player name.');
                return true;
            }
            if (usernamesEqual(target, plot.owner)) {
                say(context, '§cThat player already owns this plot.');
                return true;
            }

            const oldOwner = plot.owner;
            plot.members = plot.members.filter((member) => !usernamesEqual(member, target));
            if (!plot.members.some((member) => usernamesEqual(member, oldOwner))) {
                plot.members.push(oldOwner);
            }
            plot.owner = target;
            refresh();
            say(context, `Transferred "${plot.name}" from ${oldOwner} to ${target}.`);
            return true;
        }

        function trustPlayer(context, targetArg, trusted) {
            const { username, plot } = plotAtPlayer(context);
            if (!plot) {
                say(context, '§cStand inside the plot you want to manage.');
                return true;
            }
            if (!isOwner(plot, username)) {
                say(context, `§cOnly ${plot.owner} can manage members.`);
                return true;
            }

            const target = normalizeUsername(targetArg);
            if (!target) {
                say(context, '§cEnter a valid player name.');
                return true;
            }
            if (usernamesEqual(target, plot.owner)) {
                say(context, '§cThe owner already has access.');
                return true;
            }

            if (trusted) {
                if (plot.members.some((member) => usernamesEqual(member, target))) {
                    say(context, `§e${target} is already trusted on "${plot.name}".`);
                    return true;
                }
                plot.members.push(target);
                refresh();
                say(context, `Trusted ${target} on "${plot.name}".`);
            } else {
                plot.members = plot.members.filter((member) => !usernamesEqual(member, target));
                refresh();
                say(context, `Removed ${target} from "${plot.name}".`);
            }
            return true;
        }

        function showInfo(context) {
            const { plot } = plotAtPlayer(context);
            if (!plot) {
                say(context, '§7No plot here.');
                return true;
            }

            say(context, `§e${plot.name} §7- owner §f${plot.owner}`);
            say(context, `§7Members: §f${plot.members.length ? plot.members.join(', ') : 'none'}`);
            say(context, `§7Chunks: §f${plot.minChunkX},${plot.minChunkZ} §7to §f${plot.maxChunkX},${plot.maxChunkZ}`);
            say(context, `§7Blocks: §f${plot.minX},${plot.minZ} §7to §f${plot.maxX},${plot.maxZ}`);
            return true;
        }

        function listPlots(context) {
            if (store.plots.length === 0) {
                say(context, '§7No plots have been created.');
                return true;
            }

            say(context, `§e${store.plots.length} plot(s):`);
            const shown = store.plots.slice(0, 20);
            for (const plot of shown) {
                say(context, `§e${plot.name} §7- ${plot.owner} §8[chunks ${plot.minChunkX},${plot.minChunkZ} -> ${plot.maxChunkX},${plot.maxChunkZ}]`);
            }
            if (store.plots.length > shown.length) {
                say(context, `§7...and ${store.plots.length - shown.length} more.`);
            }
            return true;
        }

        function runCommand(context, args) {
            const sub = String(args[0] || 'help').toLowerCase();
            const username = usernameOf(context);
            const pos = positionOf(context);

            if (sub === 'help') {
                usage(context);
                return true;
            }

            if (sub === 'pos1' || sub === 'pos2') {
                if (!username || !pos) {
                    say(context, '§cCould not determine your position.');
                    return true;
                }
                const selection = selectionFor(username);
                const chunk = selectionChunk(pos);
                selection[sub] = chunk;
                say(context, `Set ${sub} to chunk ${chunk.chunkX},${chunk.chunkZ} (blocks ${chunk.x},${chunk.z}).`);
                return true;
            }

            if (sub === 'cancel') {
                if (username) selections.delete(username.toLowerCase());
                say(context, 'Selection cleared.');
                return true;
            }

            if (sub === 'create') {
                const rest = args.slice(1);
                let radiusArg = null;
                if (rest.length > 1 && /^\d+$/.test(rest[rest.length - 1])) {
                    radiusArg = rest.pop();
                }
                const nameArg = rest.join(' ').trim();
                if (!nameArg) {
                    say(context, '§cUsage: /plot create <name> [radius in chunks]');
                    return true;
                }
                return createPlot(context, nameArg, radiusArg);
            }

            if (sub === 'delete' || sub === 'destroy') {
                return deletePlot(context, args.slice(1).join(' ').trim() || null);
            }

            if (sub === 'rename') {
                const nameArg = args.slice(1).join(' ').trim();
                if (!nameArg) {
                    say(context, '§cUsage: /plot rename <name>');
                    return true;
                }
                return renamePlot(context, nameArg);
            }

            if (sub === 'owner' || sub === 'transfer') {
                const target = args.slice(1).join(' ').trim();
                if (!target) {
                    say(context, '§cUsage: /plot owner <player>');
                    return true;
                }
                return transferPlot(context, target);
            }

            if (sub === 'trust' || sub === 'add') {
                const target = args.slice(1).join(' ').trim();
                if (!target) {
                    say(context, '§cUsage: /plot trust <player>');
                    return true;
                }
                return trustPlayer(context, target, true);
            }

            if (sub === 'untrust' || sub === 'remove') {
                const target = args.slice(1).join(' ').trim();
                if (!target) {
                    say(context, '§cUsage: /plot untrust <player>');
                    return true;
                }
                return trustPlayer(context, target, false);
            }

            if (sub === 'info' || sub === 'here') {
                return showInfo(context);
            }

            if (sub === 'list') {
                return listPlots(context);
            }

            say(context, `§cUnknown subcommand "${sub}".`);
            usage(context);
            return true;
        }

        // Server-side authority: plot protection and sync requests.
        if (isServer) {
            ModAPI.onBlockAction('place', guardBuild);
            ModAPI.onBlockAction('break', guardBuild);
            ModAPI.onBlockAction('interact', guardBuild);

            ModAPI.onMessage((event) => {
                if (event.payload?.action === 'sync') {
                    event.send({ action: 'state', plots: store.plots });
                }
            });
        }

        // Client-side display: ask the server for state, then render whenever
        // the local player is standing inside a plot.
        if (!isServer && client) {
            // Cancel locally as well so an unauthorized placement does not
            // consume the held block before the server rejects it.
            ModAPI.onBlockAction('place', guardClientBuild);
            ModAPI.onBlockAction('break', guardClientBuild);
            ModAPI.onBlockAction('interact', guardClientBuild);

            ModAPI.registerService('plots', {
                handleNetworkMessage(payload) {
                    if (payload?.type !== 'modMessage' || payload.modId !== 'plots') return;
                    const message = payload.payload;
                    if (!message) return;

                    if (message.action === 'state' && Array.isArray(message.plots)) {
                        store = normalizeStore({ version: 1, nextId: store.nextId, plots: message.plots });
                        loaded = true;
                        hasServerState = true;
                    } else if (message.action === 'notice' && typeof message.text === 'string') {
                        client.addMessageToChat(message.text);
                    }
                }
            });

            ModAPI.registerRenderHook('onTick', () => {
                const now = Date.now();
                // Periodic resync also picks up a new server when a locally
                // installed copy outlives the connection it was synced on.
                if (now - lastSyncRequest < (hasServerState ? 10000 : 3000)) return;
                lastSyncRequest = now;
                ModAPI.sendModMessage({ action: 'sync' });
            });

            ModAPI.registerOverlayText((ctx) => {
                const player = ctx.minecraft?.player;
                if (!player) return;

                const blockX = Math.floor(player.x);
                const blockZ = Math.floor(player.z);
                const chunkX = blockToChunk(blockX);
                const chunkZ = blockToChunk(blockZ);
                const plot = getPlotAt(store.plots, blockX, blockZ);

                const lines = [plot ? `${plot.name} (${plot.owner})` : 'Empty Plot'];
                lines.push(`Plot: ${chunkX}, ${chunkZ}`);

                const hudOffset = (ctx.minecraft.settings?.showFps || ctx.minecraft.settings?.showVersion) ? 24 : 4;
                ctx.text(
                    lines.join('\n'),
                    4,
                    hudOffset,
                    {
                        background: '#00000000',
                        padding: 0,
                        noColor: false,
                        shadow: true
                    }
                );
            }, { priority: 100 });
        }

        ModAPI.registerCommand(
            'plot',
            '<create|delete|rename|owner|trust|untrust|pos1|pos2|info|list>',
            'Create and manage plots',
            (context, args) => {
                if (!loaded) {
                    ready.then(() => runCommand(context, args));
                    return true;
                }
                return runCommand(context, args);
            }
        );

        if (isServer) {
            ModAPI.log('Plot manager ready.');
        } else {
            ModAPI.log('Plot HUD ready.');
        }
    }
}
