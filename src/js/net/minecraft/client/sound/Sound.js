
export default class Sound {
    static minecraft = null;
    static _modUrlCache = new Map();

    static init(minecraft) {
        Sound.minecraft = minecraft;
    }

    
    static play(name, volume = 1.0, pitch = 1.0) {
        if (!Sound.minecraft || typeof name !== 'string') {
            return;
        }

        const colonIndex = name.indexOf(':');
        if (colonIndex !== -1) {
            Sound._playModSound(
                name.substring(0, colonIndex),
                name.substring(colonIndex + 1),
                volume,
                pitch
            );
        } else {
            Sound.minecraft.soundManager.playSoundMono(name, volume, pitch);
        }
    }

    static async _playModSound(modId, soundName, volume, pitch) {
        const modLoader = Sound.minecraft?.modLoader;
        const filesystem = (modLoader && modLoader.getModFilesystem)
            ? (modLoader.getModFilesystem(modId) || modLoader.filesystem)
            : modLoader?.filesystem;
        if (!filesystem) {
            return;
        }

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
