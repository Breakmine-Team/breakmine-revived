import Block from "../world/block/Block.js";
import * as THREE from "../../../../../../libraries/three.module.js";
import { base64Assets } from "../../../../../resources.js";
import { clickSound } from "../../../../assetManifest.js";

export default class SoundManager {

    constructor() {
        this.audioListener = null;
        this.soundPool = {};

        this.disabled = false;

        this._soundsUnavailable = false;

        this._consecutiveFailures = 0;
        this._failureLimit = 8;

        this.clickReady = false;
        this.clickAudio = null;
        try {
            this.audioLoader = new THREE.AudioLoader();
        } catch (e) {
            console.warn('SoundManager: AudioLoader unavailable, disabling sounds:', e);
            this.disabled = true;
            this.audioLoader = null;
        }

        try {
            const clickSrc = this.resolveAsset(clickSound);
            this.clickAudio = new Audio(clickSrc);
            this.clickAudio.addEventListener('canplaythrough', () => {
                this.clickReady = true;
            }, { once: true });
        } catch (e) {
            console.warn('SoundManager: Failed to preload click sound:', e);
        }
    }

    resolveAsset(assetKey) {
        return (typeof base64Assets !== 'undefined' && base64Assets[assetKey])
            ? base64Assets[assetKey]
            : `src/resources/${assetKey}`;
    }

    create(worldRenderer) {
        if (this.disabled) return;

        try {
            this.scene = worldRenderer.scene;

            this.audioListener = new THREE.AudioListener();
            worldRenderer.camera.add(this.audioListener);

            if (this.audioListener.context.state === 'suspended') {
                this.audioListener.context.resume().catch(err => {
                    console.warn('SoundManager: Failed to resume audio context:', err);
                });
            }

            for (let i in Block.sounds) {
                let sound = Block.sounds[i];

                this.loadSoundPool(sound.getStepSound());
            }

            this.loadSoundPool("random.pop");
        } catch (e) {
            console.warn('SoundManager: Failed to initialize audio, disabling sounds:', e);
            this.audioListener = null;
            this.disabled = true;
        }
    }

    loadSoundPool(name) {
        if (this.disabled || this._soundsUnavailable) {
            return;
        }

        let pool = [];
        let amount = 4;

        let path = name.replace(".", "/");
        for (let i = 0; i < amount; i++) {
            const assetKey = `sound/${path}${i + 1}.ogg`;
            let sound;
            try {
                sound = this.loadSound(this.resolveAsset(assetKey));
            } catch (e) {
                sound = null;
            }
            if (sound) {
                pool.push(sound);
            }
        }

        if (pool.length === 0) {
            const assetKey = `sound/${path}.ogg`;
            let sound;
            try {
                sound = this.loadSound(this.resolveAsset(assetKey));
            } catch (e) {
                sound = null;
            }
            if (sound) {
                pool.push(sound);
            }
        }

        if (pool.length > 0 && !this._soundsUnavailable) {
            this.soundPool[name] = pool;
        }
    }

    loadSound(path) {
        if (!this.isCreated()) {
            return;
        }

        try {
            let sound = new THREE.PositionalAudio(this.audioListener);
            sound.setRefDistance(0.1);
            sound.setRolloffFactor(6);
            sound.setFilter(sound.context.createBiquadFilter());
            sound.setVolume(1.0);
            sound.hasBuffer = false;

            this.audioLoader.load(path, buffer => {
                if (this.disabled) return;
                sound.setBuffer(buffer);
                sound.hasBuffer = true;
                this.scene.add(sound);
                this._consecutiveFailures = 0;
            }, progress => {
            }, error => {
                sound.hasBuffer = false;
                this._consecutiveFailures++;
                if (!this._soundsUnavailable && this._consecutiveFailures >= this._failureLimit) {
                    this._soundsUnavailable = true;
                    console.warn('SoundManager: Sounds unavailable (not bundled or failed to load), disabling sound loading:', error && error.message || error);
                }
            });

            return sound;
        } catch (e) {
            console.warn('Exception loading sound:', path, e);
            return;
        }
    }

    playSound(name, x, y, z, volume, pitch) {
        if (this.disabled || this._soundsUnavailable) {
            return;
        }

        let pool = this.soundPool[name];

        if (typeof pool === "undefined") {
            this.loadSoundPool(name);
            pool = this.soundPool[name];
        }

        if (pool && pool.length > 0) {
            let sound = pool[Math.floor(Math.random() * pool.length)];
            if (typeof volume === "undefined" || typeof sound === "undefined") {
                return;
            }

            if (!sound.hasBuffer) {
                return;
            }

            try {
                if (sound.context.state === 'suspended') {
                    sound.context.resume();
                }

                if (sound.isPlaying) {
                    sound.stop();
                }

                sound.position.set(x, y, z);

                sound.updateMatrixWorld(true);
                let pos = new THREE.Vector3();
                pos.setFromMatrixPosition(sound.matrixWorld);
                sound.panner.positionX.setValueAtTime(pos.x, sound.context.currentTime);
                sound.panner.positionY.setValueAtTime(pos.y, sound.context.currentTime);
                sound.panner.positionZ.setValueAtTime(pos.z, sound.context.currentTime);

                sound.setVolume(volume * 10);
                sound.filters[0].frequency.setValueAtTime(12000 * pitch, sound.context.currentTime);

                sound.offset = 0;
                sound.play();
            } catch (e) {
            }
        }
    }

    isCreated() {
        return !this.disabled && this.audioListener !== null;
    }

    playGuiClick() {
        if (!this.clickReady || !this.clickAudio || this.disabled) {
            return;
        }
        try {
            this.clickAudio.currentTime = 0;
            this.clickAudio.play();
        } catch (e) {
            console.warn('Failed to play click sound:', e);
        }
    }

    playSoundMono(name, volume = 1.0, pitch = 1.0, dontUseRandom = false) {
        if (this.disabled || this._soundsUnavailable) {
            return;
        }

        let path = name.replace(".", "/");
        let soundSrc = null;
        const plainSrc = this.resolveAsset(`sound/${path}.ogg`);

        if (!dontUseRandom) {
            let randomVariant = Math.floor(Math.random() * 5) + 1;
            soundSrc = this.resolveAsset(`sound/${path}${randomVariant}.ogg`);
        }

        if (!soundSrc) {
            soundSrc = plainSrc;
        }

        try {
            let audio = new Audio(soundSrc);
            audio.volume = volume;
            audio.playbackRate = pitch;
            if (soundSrc !== plainSrc) {
                audio.addEventListener('error', () => {
                    let fallback = new Audio(plainSrc);
                    fallback.volume = volume;
                    fallback.playbackRate = pitch;
                    fallback.play().catch(() => {});
                }, { once: true });
            }
            audio.play();
        } catch (e) {
            console.warn('Failed to play mono sound:', name, e);
        }
    }

}
