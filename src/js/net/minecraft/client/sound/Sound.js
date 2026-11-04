// Patchwork Sound API — static; no 'this' allowed.
export default class Sound {
    static minecraft = null;
    static _modUrlCache = new Map();

    static init(minecraft) {
        Sound.minecraft = minecraft;
    }

    /**
     * Play a sound.
     *   Sound.play('random.pop', 1.0)   — vanilla sound (by sound pool name)
     *   Sound.play('mod:test.ogg', 1.0) — custom sound shipped by a mod
     *
     * @param {string} name
     * @param {number} volume
     * @param {number} pitch
     */
    static play(name, volume = 1.0, pitch = 1.0) {
        if (!Sound.minecraft || typeof name !== 'string') {
            return;
        }

        const colonIndex = name.indexOf(':');
        if (colonIndex !== -1) {
            // Mod sound: <modId>:<soundfile>
            Sound._playModSound(
                name.substring(0, colonIndex),
                name.substring(colonIndex + 1),
                volume,
                pitch
            );
        } else {
            // Vanilla sound
            Sound.minecraft.soundManager.playSoundMono(name, volume, pitch);
        }
    }

    static async _playModSound(modId, soundName, volume, pitch) {
        const modLoader = Sound.minecraft?.modLoader;
        const filesystem = (modLoader && modLoader.getDevModFilesystem)
            ? (modLoader.getDevModFilesystem(modId) || modLoader.filesystem)
            : modLoader?.filesystem;
        if (!filesystem) {
            return;
        }

        // Normalize to '.ogg' (mods may pass 'test' or 'test.ogg')
        if (!/\.(ogg|mp3|wav)$/i.test(soundName)) {
            soundName += '.ogg';
        }

        const b64Path = `mods/${modId}/sounds/${soundName}.b64`;

        let url = Sound._modUrlCache.get(b64Path);
        if (!url) {
            try {
                const data = await filesystem.loadBinaryFile(b64Path);
                if (!data) {
                    console.warn('[Sound] Mod sound not found:', b64Path);
                    return;
                }
                const blob = new Blob([data], { type: 'audio/ogg' });
                url = URL.createObjectURL(blob);
                Sound._modUrlCache.set(b64Path, url);
            } catch (e) {
                console.warn('[Sound] Could not load mod sound:', b64Path, e);
                return;
            }
        }

        const audio = new Audio(url);
        audio.volume = volume;
        audio.playbackRate = pitch;
        audio.play();
    }
}
