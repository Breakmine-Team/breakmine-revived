import test from 'node:test';
import assert from 'node:assert/strict';
import { ReloadProgress, LoadingOverlayState, smoothLoadingProgress, loadingBarFillWidth, loadingBarBounds } from '../src/js/loading/LoadingProgress.mjs';
import TextureAtlas from '../src/js/net/minecraft/client/render/TextureAtlas.js';
import { startupLoading } from '../src/js/loading/LoadingOverlay.js';

test('26.3 task weights include apply work and listener readiness', () => {
    const reload = new ReloadProgress(2, 3, ['ui', 'atlas']);
    reload.finishPrepare();
    reload.finishPrepare();
    reload.finishListener('ui');
    assert.equal(reload.getActualProgress(), Math.fround(5 / 12));
    assert.equal(reload.isDone(), false);
    for (let i = 0; i < 3; i++) reload.finishApply();
    assert.equal(reload.isDone(), false);
    reload.finishListener('atlas');
    assert.equal(reload.isDone(), true);
    assert.equal(reload.getActualProgress(), 1);
});

test('26.3 smoothing uses float arithmetic and follows changing actual progress', () => {
    assert.equal(smoothLoadingProgress(0, 1), Math.fround(.050000012));
    assert.equal(smoothLoadingProgress(0, .5), Math.fround(.025000006));
    assert.ok(smoothLoadingProgress(.8, .4) < .8);
    let current = 0;
    for (let frame = 0; frame < 60; frame++) current = smoothLoadingProgress(current, 1);
    assert.ok(current > .95 && current < .96);
});

test('overlay waits for real completion then fades bar for 1s and overlay for 1s', () => {
    const reload = new ReloadProgress(1, 1, ['client']);
    const overlay = new LoadingOverlayState(reload);
    assert.equal(overlay.frame(100).opacity, 1);
    reload.finishPrepare();
    assert.equal(overlay.frame(500).barOpacity, 1);
    assert.equal(overlay.fadeOutStart, -1);
    reload.finishApply();
    reload.finishListener('client');
    assert.equal(overlay.frame(1000).barOpacity, 1);
    assert.equal(overlay.frame(1500).barOpacity, .5);
    assert.equal(overlay.frame(2000).opacity, 1);
    assert.equal(overlay.frame(2500).opacity, .5);
    assert.equal(overlay.frame(2999).removed, false);
    assert.equal(overlay.frame(3000).removed, true);
});

test('resource reload fade-in enforces the 1s readiness gate', () => {
    const overlay = new LoadingOverlayState(new ReloadProgress(0, 0, []), { fadeIn: true });
    overlay.frame(100);
    overlay.frame(1099);
    assert.equal(overlay.fadeOutStart, -1);
    overlay.frame(1100);
    assert.equal(overlay.fadeOutStart, 1100);
});

test('fatal startup failure cannot publish completion or fade away', () => {
    const reload = new ReloadProgress(0, 0, []);
    reload.error = new Error('atlas construction failed');
    const overlay = new LoadingOverlayState(reload);
    assert.equal(reload.isDone(), false);
    assert.equal(overlay.frame(5000).removed, false);
    assert.equal(overlay.fadeOutStart, -1);
});

test('bar fill matches JAR ceil and two-pixel inset geometry', () => {
    assert.equal(loadingBarFillWidth(100, 0), 0);
    assert.equal(loadingBarFillWidth(100, .5), 47);
    assert.equal(loadingBarFillWidth(100, 1), 96);
});

test('bar placement matches integer JAR geometry at odd window sizes', () => {
    assert.deepEqual(loadingBarBounds(1367, 769), { left: 299, top: 635, width: 768, height: 10 });
    assert.deepEqual(loadingBarBounds(400, 900), { left: 50, top: 744, width: 300, height: 10 });
});

test('late discovered mod work changes the denominator and gates completion', () => {
    const reload = new ReloadProgress(1, 1, ['client']);
    reload.finishPrepare();
    reload.addApplyTasks(2);
    reload.finishApply();
    reload.finishListener('client');
    assert.equal(reload.getActualProgress(), Math.fround(5 / 9));
    assert.equal(reload.isDone(), false);
    reload.finishApply();
    reload.finishApply();
    assert.equal(reload.isDone(), true);
});

test('actual atlas completion reports decoded/applied entries including optional fallback', async t => {
    const oldDocument = globalThis.document;
    globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }) }) };
    t.after(() => { globalThis.document = oldDocument; });
    const atlas = new TextureAtlas({});
    atlas.getTextureFiles = async () => ['ok.png', 'optional.png'];
    let release;
    atlas.loadImage = path => path === 'ok.png'
        ? new Promise(resolve => { release = resolve; })
        : Promise.reject(new Error('optional texture missing'));
    const reload = new ReloadProgress(2, 2, ['atlas']);
    const loading = atlas.loadTextures(reload);
    await Promise.resolve();
    assert.equal(reload.getActualProgress(), 0);
    assert.equal(reload.isDone(), false);
    release({});
    await loading;
    assert.equal(reload.prepared, 2);
    assert.equal(reload.applied, 2);
    assert.equal(reload.isDone(), true);
    assert.equal(atlas.loaded, true);
    atlas.texture.dispose();
});

test('DOM overlay uses JAR bounds and releases its observer/animation after completion', t => {
    const saved = { document: globalThis.document, ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame };
    t.after(() => Object.assign(globalThis, saved));
    const callbacks = [];
    let removed = false, disconnected = false;
    const fill = { style: {} };
    const bar = { style: {}, setAttribute() {} };
    const overlay = {
        style: {}, clientWidth: 1367, clientHeight: 769,
        querySelector: selector => selector === '.loading-progress' ? bar : fill,
        remove() { removed = true; }
    };
    globalThis.document = { getElementById: () => overlay };
    globalThis.ResizeObserver = class {
        observe() {}
        disconnect() { disconnected = true; }
    };
    globalThis.requestAnimationFrame = callback => callbacks.push(callback);
    startupLoading.attach(new ReloadProgress(0, 0, []));
    assert.equal(bar.style.left, '299px');
    assert.equal(bar.style.width, '768px');
    callbacks.shift()(1000);
    callbacks.shift()(2000);
    assert.equal(removed, false);
    callbacks.shift()(3000);
    assert.equal(removed, true);
    assert.equal(disconnected, true);
    assert.equal(callbacks.length, 0);
});
