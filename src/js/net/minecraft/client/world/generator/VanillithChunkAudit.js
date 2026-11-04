import registry from '../../../../../../../packages/vanilla-worldgen/generated/block-states.json' with { type: 'json' };

const arrays = ['blocks', 'biomes', 'heightmap', 'fluidUpdates'];
const airStates = new Set(registry.states.filter(state =>
    ['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'].includes(state.name)).map(state => state.id));

function equalArray(left, right) {
    if (left == null || right == null) return left == null && right == null;
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i++) if (left[i] !== right[i]) return false;
    return true;
}

function compareChunks(left, right) {
    const differences = [];
    for (const field of arrays) {
        if (!equalArray(left[field], right[field])) {
            let first = -1;
            const a = left[field], b = right[field];
            for (let i = 0; i < Math.max(a?.length ?? 0, b?.length ?? 0); i++) {
                if (a?.[i] !== b?.[i]) { first = i; break; }
            }
            differences.push(`${field}${first >= 0 ? `@${first}` : ''}`);
        }
    }
    return differences;
}

function inspectLoadedChunk(chunk) {
    const issues = [];
    if (!chunk || !(chunk.blocks instanceof Uint32Array) || !(chunk.biomes instanceof Uint16Array) ||
        !(chunk.heightmap instanceof Int32Array) || chunk.heightmap.length !== 256) {
        return ['malformed chunk arrays'];
    }
    let unknownState = -1;
    for (const id of chunk.blocks) if (!registry.states[id]) { unknownState = id; break; }
    if (unknownState >= 0) issues.push(`unknown block-state ${unknownState}`);
    const maxY = chunk.minY + chunk.height;
    for (let i = 0; i < chunk.heightmap.length; i++) {
        const y = chunk.heightmap[i];
        if (!Number.isInteger(y) || y < chunk.minY || y > maxY) {
            issues.push(`heightmap[${i}]=${y} outside ${chunk.minY}..${maxY}`);
            break;
        }
        const x = i & 15, z = i >> 4;
        let expected = chunk.minY;
        for (let dy = chunk.height - 1; dy >= 0; dy--) {
            if (!airStates.has(chunk.blocks[dy * 256 + z * 16 + x])) {
                expected = chunk.minY + dy + 1;
                break;
            }
        }
        if (y !== expected) {
            issues.push(`heightmap[${i}] is ${y}, block column implies ${expected}`);
            break;
        }
    }
    if (chunk.fluidUpdates && !(chunk.fluidUpdates instanceof Uint8Array)) issues.push('invalid fluid-update array');
    else if (chunk.fluidUpdates) {
        for (const value of chunk.fluidUpdates) if (value > 1) { issues.push(`invalid fluid-update flag ${value}`); break; }
    }
    return issues;
}

async function regenerate(source, coords, workerIndex) {
    const chunks = [];
    for (let offset = 0; offset < coords.length; offset += 4) {
        chunks.push(...await source.requestTerrainChunksAtAsync(coords.slice(offset, offset + 4), workerIndex));
    }
    return chunks;
}

export async function auditVanillithChunks(minecraft, radius = 1) {
    const world = minecraft.world;
    const provider = world?.getChunkProvider?.();
    const source = provider?.source;
    const player = minecraft.player;
    if (!world?.vanillaPreview || !source || !player) throw new Error('This command only works in the Vanillith terrain preview.');

    const centerX = Math.floor(player.x / 16), centerZ = Math.floor(player.z / 16);
    const loaded = [...(world.nativeChunks?.chunks?.values?.() ?? [])]
        .filter(chunk => Math.max(Math.abs(chunk.chunkX - centerX), Math.abs(chunk.chunkZ - centerZ)) <= radius)
        .sort((a, b) => Math.max(Math.abs(a.chunkX - centerX), Math.abs(a.chunkZ - centerZ)) -
            Math.max(Math.abs(b.chunkX - centerX), Math.abs(b.chunkZ - centerZ)))
        .slice(0, 25);
    if (!loaded.length) return ['Vanillith audit: no loaded chunks in that radius.'];

    const started = performance.now();
    const coords = loaded.map(chunk => [chunk.chunkX, chunk.chunkZ]);
    // Worker slots 4 and 5 are reserved for diagnostics; normal streaming uses 0..3.
    const [replicaA, replicaB] = await Promise.all([
        regenerate(source, coords, 4),
        regenerate(source, coords, 5)
    ]);
    const problems = [];
    let terrainCompared = 0;
    for (let i = 0; i < loaded.length; i++) {
        const key = `${coords[i][0]},${coords[i][1]}`;
        const structural = inspectLoadedChunk(loaded[i]);
        for (const issue of structural) problems.push(`${key}: ${issue}`);

        const replicaDiff = compareChunks(replicaA[i], replicaB[i]);
        if (replicaDiff.length) problems.push(`${key}: independent terrain workers differ (${replicaDiff.join(', ')})`);
        else terrainCompared++;

        if (!source.decorationDraft) {
            const loadedDiff = compareChunks(loaded[i], replicaA[i]);
            if (loadedDiff.length) problems.push(`${key}: loaded chunk differs from fresh terrain (${loadedDiff.join(', ')})`);
        }
    }

    const elapsed = Math.round(performance.now() - started);
    const lines = [
        `Vanillith audit: ${loaded.length} loaded chunk(s), ${terrainCompared} exact terrain replica match(es), ${elapsed} ms.`,
        source.decorationDraft
            ? 'Decoration draft: terrain determinism + chunk structure checked; decoration replay parity is not claimed.'
            : `Loaded chunk data compared against a fresh worker using seed ${source.seed} / ${source.settings}.`,
        problems.length ? `Found ${problems.length} issue(s):` : 'No generation mismatch or structural issue detected.'
    ];
    lines.push(...problems.slice(0, 8));
    if (problems.length > 8) lines.push(`…and ${problems.length - 8} more; run /vanillith audit with a smaller radius.`);
    return lines;
}
