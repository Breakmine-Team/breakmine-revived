import Minecraft from './net/minecraft/client/Minecraft.js';
import * as aesjs from '../../libraries/aes.js';
import MixinEngine from './net/minecraft/client/mixin/MixinEngine.js';
import { base64Assets } from '../resources.js';
import { uiTextures } from './assetManifest.js';
import { Version } from '../resources/version.js';
import { initLauncherApi, isLauncherMode } from './net/minecraft/client/launcher/LauncherApi.js';
// Side effect: exposes window.MediaEncryptor for the index.html easter egg.
// It lives inside src/ so every deployment has it next to the module graph: the
// raw public/ tree serves src/ wholesale, and Vite bundles this import.
import './MediaEncryptor.js';



window.base64Assets = base64Assets;




window.GAME_VERSION = Version.VERSION;

window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
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
            if (isLauncherMode()) {
                initLauncherApi(window.app);
            }
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




export { require } from './net/minecraft/client/network/util/Require.js';