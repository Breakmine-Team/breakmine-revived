function resourceName(identifier) {
    if (typeof identifier !== 'string' || identifier.length === 0) throw new TypeError('Expected a worldgen resource identifier');
    const value = identifier.includes(':') ? identifier : `minecraft:${identifier}`;
    if (!value.startsWith('minecraft:')) throw new Error(`Unsupported worldgen namespace: ${value}`);
    return value;
}

function resourcePath(kind, identifier) {
    const name = resourceName(identifier).slice('minecraft:'.length);
    return `data/minecraft/worldgen/${kind}/${name}.json`;
}

export function createWorldgenFeatureRegistry(data) {
    if (!data || typeof data !== 'object') throw new TypeError('Expected imported vanilla worldgen resources');
    const features = new Map();
    const placedFeatures = new Map();
    for (const [path, value] of Object.entries(data)) {
        const match = /^data\/minecraft\/worldgen\/(feature|placed_feature)\/(.+)\.json$/.exec(path);
        if (!match) continue;
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`Malformed feature resource: ${path}`);
        const registry = match[1] === 'feature' ? features : placedFeatures;
        registry.set(`minecraft:${match[2]}`, value);
    }
    return {
        featureCount: features.size,
        placedFeatureCount: placedFeatures.size,
        getFeature(identifier) {
            const name = resourceName(identifier);
            const feature = features.get(name);
            if (!feature) throw new Error(`Missing vanilla feature resource: ${name}`);
            return feature;
        },
        getPlacedFeature(identifier) {
            const name = resourceName(identifier);
            const placed = placedFeatures.get(name);
            if (!placed) throw new Error(`Missing vanilla placed-feature resource: ${name}`);
            const featureName = resourceName(placed.feature);
            const placement = placed.placement ?? [];
            if (!Array.isArray(placement) || placement.some(modifier => !modifier || typeof modifier.type !== 'string')) {
                throw new Error(`Malformed placement modifiers for ${name}`);
            }
            return { name, featureName, feature: this.getFeature(featureName), placement };
        },
        validatePlacedFeatures() {
            for (const name of placedFeatures.keys()) this.getPlacedFeature(name);
            return { features: features.size, placedFeatures: placedFeatures.size };
        }
    };
}
