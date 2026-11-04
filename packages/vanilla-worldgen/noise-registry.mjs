export function createNoiseRegistry(kernel, seed, data) {
    const random = kernel.random(seed);
    const factory = random.forkPositional();
    random.dispose();
    const noises = new Map();
    let disposed = false;
    return {
        sample(id, x, y, z) {
            if (disposed) throw new Error('Noise registry has been disposed');
            if (typeof id !== 'string' || !/^minecraft:[a-z0-9_/]+$/.test(id)) throw new TypeError('Expected a Minecraft noise identifier');
            let noise = noises.get(id);
            if (!noise) {
                const parameters = data[`data/minecraft/worldgen/noise/${id.slice(10)}.json`];
                if (!parameters) throw new Error(`Missing noise definition: ${id}`);
                const source = factory.fromHashOf(id);
                try { noise = source.normalNoise(parameters); }
                finally { source.dispose(); }
                noises.set(id, noise);
            }
            return noise.sample(x, y, z);
        },
        dispose() {
            for (const noise of noises.values()) noise.dispose();
            noises.clear();
            factory.dispose();
            disposed = true;
        }
    };
}
