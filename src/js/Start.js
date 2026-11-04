import Minecraft from './net/minecraft/client/Minecraft.js';
import * as aesjs from '../../libraries/aes.js';
import MixinEngine from './net/minecraft/client/mixin/MixinEngine.js';
import { base64Assets } from '../resources.js';
import { uiTextures, atlasBlockTextures, atlasItemTextures } from './assetManifest.js';
import { ReloadProgress } from './loading/LoadingProgress.mjs';
import { startupLoading } from './loading/LoadingOverlay.js';

window.addEventListener('unhandledrejection', event => {
    event.preventDefault();
});

class Start {

    loadTextures(textures, onProgress = () => {}) {
        let resources = [];
        let completed = 0;

        const finish = (resolve) => {
            completed++;
            onProgress(textures.length ? completed / textures.length : 1);
            resolve();
        };

        return Promise.all(textures.map((texturePath) => {
            return new Promise((resolve) => {
                let image = new Image();
                
                const base64Data = base64Assets[texturePath];

                if (!base64Data) {
                    console.warn(`Missing Base64 asset for: ${texturePath}`);
                    finish(resolve);
                    return;
                }

                image.onload = () => {
                    resources[texturePath] = image;
                    finish(resolve);
                };

                image.onerror = () => {
                    console.warn(`Failed to decode Base64 texture: ${texturePath}`);
                    finish(resolve);
                };
                image.src = base64Data;
            });
        })).then(() => {
            return resources;
        });
    }

    launch(canvasWrapperId) {
        // TextureAtlas.getTextureFiles() deduplicates block and item names
        // independently, so progress totals must use those same unique counts.
        const atlasCount = Math.min(
            new Set(atlasBlockTextures).size + new Set(atlasItemTextures).size,
            64 * 64
        );
        // loadTextures() calls onProgress once for every UI texture, while the
        // atlas loader deduplicates its block/item manifests before preparing.
        const reload = new ReloadProgress(uiTextures.length + atlasCount, atlasCount + 3, ['ui', 'atlas', 'client']);
        startupLoading.attach(reload);
        this.loadTextures(uiTextures, () => {
            // A missing optional texture is settled using the existing fallback.
            reload.finishPrepare();
        }).then(async (resources) => {
            reload.finishListener('ui');
            window.app = new Minecraft(canvasWrapperId, resources, reload);
            reload.finishApply();
            reload.finishListener('client');
            // Includes atlas build, enabled mods, texture binding and a frame
            // rendered after initialization, rather than only construction.
            await window.app.ready;
            reload.finishApply();
            window.app.startupReload = null;
        }).catch((error) => {
            reload.error = error;
            console.error('Breakmine startup failed:', error);
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
