import { base64Assets } from "../../../../../resources.js";
import { musicTracks } from "../../../../assetManifest.js";

export default class MusicManager {

    constructor() {
        this.tracks = [];
        this.currentTrack = null;
        this.currentCategory = null;
        this.nextTrack = null;
        this.fadeInterval = null;
        this.scheduledNext = null;
        this.pendingCategory = null;

        this.menuTracks = [];
        this.gameTracks = [];
        this.creativeTracks = [];
        this.netherTracks = [];
        this.endTracks = [];

        this.volume = 0.0;
        this.fadeTime = 2000;
        this.gapTime = 5000;

        this._loadedCategories = new Set();

        // Only the menu tracks are loaded eagerly at boot (the "core" asset
        // package). Game/creative/nether/end tracks are fetched lazily the
        // first time their category is played, so the initial bundle stays
        // small when music is served as separate files.
        this.loadTracks('menu');
    }

    loadTracks(category) {
        if (this._loadedCategories.has(category)) {
            return;
        }

        const tracks = musicTracks[category];
        if (!tracks) {
            return;
        }

        const list = this.getTrackList(category);
        for (const relativePath of tracks) {
            const assetKey = relativePath.replace(/^src\/resources\//, '');
            const src = (typeof base64Assets !== 'undefined' && base64Assets[assetKey])
                ? base64Assets[assetKey]
                : `src/resources/${assetKey}`;

            const audio = new Audio(src);
            audio.volume = 0;
            audio.preload = 'auto';
            list.push(audio);
        }

        this._loadedCategories.add(category);
    }

    getTrackList(category) {
        switch (category) {
            case 'menu': return this.menuTracks;
            case 'creative': return this.creativeTracks;
            case 'nether': return this.netherTracks;
            case 'end': return this.endTracks;
            default: return this.gameTracks;
        }
    }

    pickRandom(list) {
        return list[Math.floor(Math.random() * list.length)];
    }

    playMusic(category) {
        if (this.currentCategory === category && this.currentTrack) {
            return;
        }

        this.stopMusic();

        // Lazy-load the category's tracks on first play (menu is preloaded).
        this.loadTracks(category);

        const list = this.getTrackList(category);
        if (list.length === 0) return;

        this.tracks = list;
        this.currentCategory = category;
        this.playNext();
    }

    switchWhenReady(category) {
        if (this.currentCategory === category) {
            return;
        }

        if (this.currentTrack) {
            this.pendingCategory = category;
        } else {
            this.playMusic(category);
        }
    }

    playNext() {
        if (this.pendingCategory) {
            const pending = this.pendingCategory;
            this.pendingCategory = null;
            this.playMusic(pending);
            return;
        }
        if (this.tracks.length === 0) return;

        const track = this.pickRandom(this.tracks);
        if (track === this.currentTrack && this.tracks.length > 1) {
            return this.playNext();
        }

        this.currentTrack = track;
        this.currentTrack.currentTime = 0;
        this.currentTrack.volume = 0;
        this.fadeIn(this.currentTrack);

        // Schedule next track after this one ends + gap
        this.currentTrack.onended = () => {
            this.currentTrack = null;
            this.scheduledNext = setTimeout(() => this.playNext(), this.gapTime);
        };
    }

    fadeIn(audio) {
        const step = 50;
        const increment = this.volume / (this.fadeTime / step);
        let current = 0;

        audio.play();

        this.fadeInterval = setInterval(() => {
            current += increment;
            if (current >= this.volume) {
                audio.volume = this.volume;
                clearInterval(this.fadeInterval);
                this.fadeInterval = null;
            } else {
                audio.volume = current;
            }
        }, step);
    }

    fadeOut(audio, callback) {
        const step = 50;
        const decrement = audio.volume / (this.fadeTime / step);

        this.fadeInterval = setInterval(() => {
            audio.volume -= decrement;
            if (audio.volume <= 0) {
                audio.volume = 0;
                audio.pause();
                audio.currentTime = 0;
                clearInterval(this.fadeInterval);
                this.fadeInterval = null;
                if (callback) callback();
            }
        }, step);
    }

    stopMusic() {
        this.currentCategory = null;
        this.pendingCategory = null;
        if (this.scheduledNext) {
            clearTimeout(this.scheduledNext);
            this.scheduledNext = null;
        }
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }
        if (this.currentTrack) {
            this.currentTrack.pause();
            this.currentTrack.currentTime = 0;
            this.currentTrack.volume = 0;
            this.currentTrack.onended = null;
            this.currentTrack = null;
        }
        if (this.nextTrack) {
            this.nextTrack.pause();
            this.nextTrack.currentTime = 0;
            this.nextTrack.volume = 0;
            this.nextTrack = null;
        }
    }
}