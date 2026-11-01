import Minecraft from './net/minecraft/client/Minecraft.js';
import * as aesjs from '../../libraries/aes.js';
import MixinEngine from './net/minecraft/client/mixin/MixinEngine.js';
import { base64Assets } from '../resources.js';
import { uiTextures } from './assetManifest.js';
import { Version } from '../resources/version.js';

// Expose the inlined assets so non-module UI code (e.g. TinyTools) can use
// them in the singlefile build, where separate files are not available.
window.base64Assets = base64Assets;
// Read the version from its own module rather than from Minecraft.VERSION: the
// class binding is only initialized once Minecraft.js has finished evaluating,
// and touching it here throws "Cannot access 'Minecraft' before initialization"
// whenever the module graph happens to reach this file first.
window.GAME_VERSION = Version.VERSION;

window.addEventListener('unhandledrejection', event => {
    // Suppress the default console noise, but never silently: a rejected
    // promise inside an async init() leaves a screen half-built, and with no
    // log there is nothing on screen or in the console to explain it.
    const reason = event.reason;
    //console.warn('[Client] Unhandled promise rejection:', reason && reason.stack || reason);
    event.preventDefault();
});

class Start {

    loadTextures(textures) {
        let resources = [];

        return Promise.all(textures.map((texturePath) => {
            return new Promise((resolve) => {
                let image = new Image;

                const base64Data = base64Assets[texturePath];

                if (base64Data) {
                    image.src = base64Data;
                } else {
                    console.warn(`Missing Base64 asset for: ${texturePath}`);
                    resolve();
                    return;
                }

                image.onload = () => {
                    resources[texturePath] = image;
                    resolve();
                };

                image.onerror = () => {
                    console.warn(`Failed to decode Base64 texture: ${texturePath}`);
                    resolve();
                };
            });
        })).then(() => {
            return resources;
        });
    }

    launch(canvasWrapperId) {
        this.loadTextures(uiTextures).then((resources) => {
            window.app = new Minecraft(canvasWrapperId, resources);
            if (window.hideLoadingScreen) {
                window.hideLoadingScreen();
            }
        });
    }
}

window.addEventListener('pageshow', function (event) {
    if (window.app) {
        if (!window.app.running) {
            window.location.reload();
        }
    } else {
        new Start().launch("canvas-container");
    }
});

// The network modules import this helper from its own leaf module so that
// Start.js is not part of their import graph (see Require.js); keep the export
// here for anything that still expects it on the entry point.
export { require } from './net/minecraft/client/network/util/Require.js';