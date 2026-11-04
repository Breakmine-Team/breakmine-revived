import test from 'node:test';
import assert from 'node:assert/strict';
import GameSettings, { HARDWARE_PRESETS } from '../../../src/js/net/minecraft/client/GameSettings.js';
import GuiOptions from '../../../src/js/net/minecraft/client/gui/screens/GuiOptions.js';

test('hardware presets scale work and memory without enabling worldgen experiments', () => {
    const settings = new GameSettings();
    for (const name of ['low', 'balanced', 'high']) {
        settings.applyHardwarePreset(name);
        for (const [key, value] of Object.entries(HARDWARE_PRESETS[name])) assert.equal(settings[key], value);
        assert.equal(settings.vanillithPriorityStreaming, false);
        assert.equal(settings.vanillithFrameBudget, true);
        assert.equal(settings.vanillithWarmCache, true);
    }
    const before = settings.viewDistance;
    settings.applyHardwarePreset('custom');
    assert.equal(settings.viewDistance, before);
    assert.throws(() => settings.applyHardwarePreset('unknown'), /Unknown hardware preset/);
});

test('individual tuning becomes Custom and saved legacy settings are preserved', () => {
    const settings = new GameSettings();
    settings.viewDistance = 12;
    settings.syncHardwarePreset();
    assert.equal(settings.hardwarePreset, 'custom');
    const storage = new Map();
    const previous = globalThis.localStorage;
    globalThis.localStorage = { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) };
    try {
        settings.save();
        const restored = new GameSettings(); restored.load();
        assert.equal(restored.hardwarePreset, 'custom'); assert.equal(restored.viewDistance, 12);
        storage.set('breakmine_settings', JSON.stringify({ viewDistance: 7, ambientOcclusion: false }));
        restored.load();
        assert.equal(restored.viewDistance, 7); assert.equal(restored.ambientOcclusion, false);
        assert.equal(restored.hardwarePreset, 'custom');
        settings.applyHardwarePreset('high'); settings.save(); restored.load();
        assert.equal(restored.hardwarePreset, 'high'); assert.equal(restored.vanillithMemoryPreset, 'high');
    } finally { if (previous === undefined) delete globalThis.localStorage; else globalThis.localStorage = previous; }
});

test('actual performance controls update live cache budgets and refresh preset labels', () => {
    const screen = new GuiOptions(null);
    const settings = new GameSettings();
    const calls = [];
    screen.minecraft = { settings, world: { chunkProvider: { setMemoryPreset: name => calls.push(name) } }, worldRenderer: { rebuildAll: () => calls.push('rebuild') } };
    screen._buildPage = () => {};
    const items = screen.pages[0].items;
    assert.equal(screen.pages[0].title, 'Performance');
    const profile = screen._createItemButton(items[0], 0, 0, 200, 20, settings);
    screen.buttonList = [profile];
    profile.setValue('low'); profile.callback();
    assert.equal(settings.hardwarePreset, 'low');
    assert.deepEqual(calls, ['low', 'rebuild']);
    const budget = screen._createItemButton(items[2], 0, 0, 200, 20, settings);
    budget.value = 3; budget.callback();
    assert.equal(settings.vanillithFrameBudgetMs, 3);
    assert.equal(settings.hardwarePreset, 'custom'); assert.equal(profile.value, 'custom');
    const memory = screen._createItemButton(items[3], 0, 0, 200, 20, settings);
    memory.value = 3072; memory.callback();
    assert.equal(calls.at(-1), 'low'); assert.equal(settings.vanillithMemoryMiB, 3072);
    assert.equal(settings.vanillithMemoryCustom, true);
    screen.buttonList = [memory]; screen.mouseScrolled(10, 10, -1);
    assert.equal(settings.vanillithMemoryMiB, 2944);
});
