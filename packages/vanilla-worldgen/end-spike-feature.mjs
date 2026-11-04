import { blockName, requireContext } from './feature-world.mjs';
import { createJavaLegacyRandom, shuffled, worldSeed } from './java-legacy-random.mjs';

export function endSpikesForSeed(seed) {
    const key = createJavaLegacyRandom(worldSeed(seed)).nextLong() & 65535n;
    const order = shuffled(Array.from({ length: 10 }, (_, i) => i), createJavaLegacyRandom(key));
    return order.map((rank, i) => {
        const angle = 2 * (-Math.PI + Math.PI / 10 * i);
        return { centerX: Math.floor(42 * Math.cos(angle)) + 0, centerZ: Math.floor(42 * Math.sin(angle)) + 0,
            radius: 2 + Math.trunc(rank / 3), height: 76 + rank * 3, guarded: rank === 1 || rank === 2 };
    });
}

export function placeEndSpike(feature, origin, random, { context, directState, setBlock }) {
    if (!Number.isInteger(context?.minY)) throw new TypeError('End spike requires context.minY');
    if (!Array.isArray(feature.spikes)) throw new TypeError('End spike requires spikes');
    const spikes = feature.spikes.length ? feature.spikes : endSpikesForSeed(context.seed);
    const state = name => directState(`minecraft:${name}`);
    for (const spike of spikes) {
        const { centerX: cx = 0, centerZ: cz = 0, radius = 0, height = 0, guarded = false } = spike;
        if (![cx, cz, radius, height].every(Number.isInteger) || radius < 0 || radius > 64) throw new RangeError('Malformed End spike');
        if (Math.floor(cx / 16) !== Math.floor(origin.x / 16) || Math.floor(cz / 16) !== Math.floor(origin.z / 16)) continue;
        for (let z = cz - radius; z <= cz + radius; z++) for (let y = context.minY; y <= height + 10; y++) for (let x = cx - radius; x <= cx + radius; x++) {
            const pos = { x, y, z };
            if ((x - cx) ** 2 + (z - cz) ** 2 <= radius ** 2 + 1 && y < height) setBlock(state('obsidian'), pos, 3);
            else if (y > 65) setBlock(state('air'), pos, 3);
        }
        if (guarded) {
            const bars = requireContext(context, 'getDefaultBlockState')('minecraft:iron_bars');
            for (let x = -2; x <= 2; x++) for (let z = -2; z <= 2; z++) for (let y = 0; y <= 3; y++) {
                if (Math.abs(x) !== 2 && Math.abs(z) !== 2 && y !== 3) continue;
                const connectX = Math.abs(x) === 2 || y === 3, connectZ = Math.abs(z) === 2 || y === 3;
                setBlock(directState({ id: blockName(bars), properties: { ...bars.properties,
                    north: String(connectX && z !== -2), south: String(connectX && z !== 2), west: String(connectZ && x !== -2), east: String(connectZ && x !== 2) } }),
                { x: cx + x, y: height + y, z: cz + z }, 3);
            }
        }
        if (requireContext(context, 'canCreateEndCrystal')()) {
            const beam = feature.crystal_beam_target ?? null;
            if (beam != null && (!Array.isArray(beam) || beam.length !== 3 || !beam.every(Number.isInteger))) throw new TypeError('Invalid End crystal beam target');
            requireContext(context, 'spawnEndCrystal')({ x: cx + 0.5, y: height + 1, z: cz + 0.5, yaw: Math.fround(random.nextFloat() * 360), pitch: 0,
                beamTarget: beam, invulnerable: feature.crystal_invulnerable ?? false, reason: 'structure' });
            setBlock(state('bedrock'), { x: cx, y: height, z: cz }, 3);
            const pos = { x: cx, y: height + 1, z: cz }, fire = requireContext(context, 'getFireState')(pos);
            setBlock(directState({ id: blockName(fire), properties: fire.properties ?? {} }), pos, 3);
        }
    }
    return true;
}
