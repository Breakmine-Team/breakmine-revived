import Minecraft from './net/minecraft/client/Minecraft.js';
import * as aesjs from '../../libraries/aes.js';
import MixinEngine from './net/minecraft/client/mixin/MixinEngine.js';
import { base64Assets } from '../resources.js';
import { uiTextures } from './assetManifest.js';

window.addEventListener('unhandledrejection', event => {
    // Suppress the default console noise, but never silently: a rejected
    // promise inside an async init() leaves a screen half-built, and with no
    // log there is nothing on screen or in the console to explain it.
    const reason = event.reason;
    console.warn('[Client] Unhandled promise rejection:', reason && reason.stack || reason);
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

export function require(module) {
    return window[module];
}