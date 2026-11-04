import { sampleIntProvider } from './value-providers.mjs';
import { requireContext, relative, javaPositionSetOrder } from './feature-world.mjs';
import { placeTrunkVineDecorator, placeShelfMushroomDecorator, placeAttachedToLogsDecorator } from './tree-decorators.mjs';

export function placeFallenTree(feature, origin, random, { context, sampleState, directState, setBlock, stateIdFor }) {
    const supported = new Set(['minecraft:trunk_vine', 'minecraft:shelf_mushroom', 'minecraft:attached_to_logs']);
    for (const decorator of [...feature.stump_decorators, ...feature.log_decorators]) {
        if (!supported.has(decorator.type)) throw new Error(`Unsupported fallen-tree decorator: ${decorator.type}`);
    }
    const air = requireContext(context, 'isAir');
    const valid = pos => air(pos) || requireContext(context, 'isBlockInTag')(requireContext(context, 'getBlockState')(pos), 'minecraft:replaceable_by_trees');
    const grounded = pos => requireContext(context, 'isFaceSturdy')(relative(pos, 'down'), 'up', pos);
    const placeLog = (pos, axis) => {
        let state = sampleState(feature.trunk_provider, pos);
        if (axis && Object.hasOwn(state.properties, 'axis')) state = directState({ id: state.name, properties: { ...state.properties, axis } });
        setBlock(state, pos, 3);
        for (let i = 1; i <= 2; i++) {
            const above = relative(pos, 'up', i);
            if (air(above)) break;
            requireContext(context, 'markPosForPostProcessing')(above);
        }
    };
    const decorate = (logs, decorators) => {
        const sorted = javaPositionSetOrder(logs).sort((a, b) => a.y - b.y);
        for (const decorator of decorators) {
            const options = { context, sampleState, setBlock, stateIdFor };
            if (decorator.type === 'minecraft:trunk_vine') placeTrunkVineDecorator(sorted, random, options);
            else if (decorator.type === 'minecraft:shelf_mushroom') placeShelfMushroomDecorator(decorator, sorted, random, options);
            else placeAttachedToLogsDecorator(decorator, sorted, random, options);
        }
    };
    placeLog(origin);
    decorate([origin], feature.stump_decorators);
    const direction = ['north', 'east', 'south', 'west'][random.nextInt(4)];
    const length = sampleIntProvider(feature.log_length, random) - 2;
    let start = relative(relative(origin, direction, 2 + random.nextInt(2)), 'up');
    for (let i = 0; i < 6; i++) {
        if (valid(start) && grounded(start)) break;
        start = relative(start, 'down');
    }
    let gap = 0;
    for (let i = 0; i < length; i++) {
        const pos = relative(start, direction, i);
        if (!valid(pos)) return true;
        gap = grounded(pos) ? 0 : gap + 1;
        if (gap > 2) return true;
    }
    const logs = [];
    for (let i = 0; i < length; i++) {
        const pos = relative(start, direction, i);
        placeLog(pos, ['east', 'west'].includes(direction) ? 'x' : 'z'); logs.push(pos);
    }
    decorate(logs, feature.log_decorators);
    return true;
}
