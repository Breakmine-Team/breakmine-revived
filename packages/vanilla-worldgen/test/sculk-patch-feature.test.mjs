import { test } from 'node:test';
import assert from 'node:assert/strict';
import registry from '../generated/block-states.json' with { type: 'json' };
import { placeSculkPatch } from '../sculk-patch-feature.mjs';

test('sculk patch emits the exact 26.3 sculk_sensor phase property name', () => {
    const placed = [];
    const origin = { x: 0, y: 20, z: 0 };
    const context = {
        getBlockState(pos) {
            if (pos.y === origin.y && Math.abs(pos.x) <= 3 && Math.abs(pos.z) <= 3) {
                return { name: 'minecraft:sculk', properties: {} };
            }
            return { name: 'minecraft:air', properties: {} };
        },
        getFluidState: () => ({ id: 'minecraft:empty', empty: true, source: false }),
        isBlockInTag: () => false,
        isReplaceable: () => false,
        isBlockSupportFaceFull: () => false,
        isCollisionFaceFull: () => false,
        getDefaultBlockState: name => ({ name, properties: {} }),
        isFaceSturdy: () => false,
        markPosForPostProcessing: () => {}
    };
    const random = {
        nextInt(bound) {
            if (bound === 5) return 0;
            if (bound === 10) return 1;
            if (bound === 50) return 0;
            if (bound === 11) return 1;
            return 0;
        }
    };
    const directState = value => {
        const properties = { ...value.properties };
        const state = registry.states.find(candidate => candidate.name === value.id &&
            Object.keys(candidate.properties).length === Object.keys(properties).length &&
            Object.entries(candidate.properties).every(([key, item]) => properties[key] === item));
        assert.ok(state, `missing exact registry state for ${value.id} ${JSON.stringify(properties)}`);
        return { name: value.id, properties, stateId: state.id };
    };

    placeSculkPatch({ charge_count: 1, amount_per_charge: 50, spread_attempts: 4,
        spread_rounds: 1, growth_rounds: 0 }, origin, random, {
        context,
        directState,
        setBlock: (state, pos) => placed.push({ state, pos })
    });

    const sensor = placed.find(entry => entry.state.name === 'minecraft:sculk_sensor');
    assert.ok(sensor, 'seeded fixture should grow a sculk sensor');
    assert.deepEqual(sensor.state.properties, {
        power: '0', sculk_sensor_phase: 'inactive', waterlogged: 'false'
    });
});
