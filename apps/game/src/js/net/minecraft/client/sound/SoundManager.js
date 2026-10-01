import Block from "../world/block/Block.js";
import * as THREE from "../../../../../../libraries/three.module.js";
import { base64Assets } from "../../../../../resources.js";
import { clickSound } from "../../../../assetManifest.js";

export default class SoundManager {

    constructor() {
        this.audioListener = null;
        this.soundPool = {};

        // Audio failed to initialize — all methods become no-ops.
        this.disabled = false;

        // Set once a sound fails to load (e.g. singlefile bundles ship no
        // .ogg files) so we stop firing the remaining requests.
        this._soundsUnavailable = false;

        // Preload click sound (never fatal if it fails)
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

            // Resume audio context (browsers suspend it until user interaction)
            if (this.audioListener.context.state === 'suspended') {
                this.audioListener.context.resume().catch(err => {
                    console.warn('SoundManager: Failed to resume audio context:', err);
                });
            }

            // Load initial sound pool
            for (let i in Block.sounds) {
                let sound = Block.sounds[i];

                // Load sound types
                this.loadSoundPool(sound.getStepSound());
            }

            // Preload item pickup sound
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

        // Load all sounds into pool
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
            if (this._soundsUnavailable) {
                return;
            }
        }

        // Fallback to unnumbered file if no numbered variants loaded
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

        // Only register pool if we have valid sounds
        if (pool.length > 0 && !this._soundsUnavailable) {
            this.soundPool[name] = pool;
        }
    }

    loadSound(path) {
        if (!this.isCreated()) {
            return;
        }

        try {
            // Create sound
            let sound = new THREE.PositionalAudio(this.audioListener);
            sound.setRefDistance(0.1);
            sound.setRolloffFactor(6);
            sound.setFilter(sound.context.createBiquadFilter());
            sound.setVolume(1.0);
            sound.hasBuffer = false;

            // Load sound with proper error handling
            this.audioLoader.load(path, buffer => {
                if (this.disabled) return;
                sound.setBuffer(buffer);
                sound.hasBuffer = true;
                this.scene.add(sound);
            }, progress => {
                // Progress callback (optional)
            }, error => {
                sound.hasBuffer = false;
                if (!this._soundsUnavailable) {
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
            // Load sound pool
            this.loadSoundPool(name);
            pool = this.soundPool[name];
        }

        if (pool && pool.length > 0) {
            // Play random sound in pool
            let sound = pool[Math.floor(Math.random() * pool.length)];
            if (typeof volume === "undefined" || typeof sound === "undefined") {
                return;
            }

            // Check if sound has loaded successfully
            if (!sound.hasBuffer) {
                return;
            }

            try {
                // Resume audio context if suspended
                if (sound.context.state === 'suspended') {
                    sound.context.resume();
                }

                // Stop previous sound
                if (sound.isPlaying) {
                    sound.stop();
                }

                // Update position
                sound.position.set(x, y, z);

                // Force panner position sync before playing (updateMatrixWorld skips when isPlaying is false)
                sound.updateMatrixWorld(true);
                let pos = new THREE.Vector3();
                pos.setFromMatrixPosition(sound.matrixWorld);
                sound.panner.positionX.setValueAtTime(pos.x, sound.context.currentTime);
                sound.panner.positionY.setValueAtTime(pos.y, sound.context.currentTime);
                sound.panner.positionZ.setValueAtTime(pos.z, sound.context.currentTime);

                // Update volume and pitch
                sound.setVolume(volume * 10);
                sound.filters[0].frequency.setValueAtTime(12000 * pitch, sound.context.currentTime);

                // Play sound
                sound.offset = 0;
                sound.play();
            } catch (e) {
                // Never let a sound failure break the game loop
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

        if (!dontUseRandom) {
            // Try random numbered variant (1-5)
            let randomVariant = Math.floor(Math.random() * 5) + 1;
            soundSrc = this.resolveAsset(`sound/${path}${randomVariant}.ogg`);
        }

        if (!soundSrc) {
            soundSrc = this.resolveAsset(`sound/${path}.ogg`);
        }

        try {
            let audio = new Audio(soundSrc);
            audio.volume = volume;
            audio.playbackRate = pitch;
            audio.play();
        } catch (e) {
            console.warn('Failed to play mono sound:', name, e);
        }
    }

}
