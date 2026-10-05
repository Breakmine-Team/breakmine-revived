import { base64Assets } from "../../../../../resources.js";

// The music ships as eight flat files in src/resources/sound/music/ - there are
// no per-category subfolders on disk - so every category (menu, game, creative,
// nether, end) plays out of this one pool.
const TRACK_FILES = [
    "sound/music/1.ogg",
    "sound/music/2.ogg",
    "sound/music/3.ogg",
    "sound/music/4.ogg",
    "sound/music/5.ogg",
    "sound/music/6.ogg",
    "sound/music/7.ogg",
    "sound/music/8.ogg",
];

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

        this.volume = 0.5;
        this.fadeTime = 2000;
        this.gapTime = 5000;

        this._loadedCategories = new Set();

        // The eight tracks are decoded once and shared by every category, so
        // switching categories doesn't build a second set of Audio objects for
        // files the browser has already fetched.
        this.trackPool = null;
        this.lastTrack = null;

        this.loadTracks('menu');
    }

    resolveAsset(assetKey) {
        return (typeof base64Assets !== 'undefined' && base64Assets[assetKey])
            ? base64Assets[assetKey]
            : `src/resources/${assetKey}`;
    }

    getTrackPool() {
        if (this.trackPool) {
            return this.trackPool;
        }

        this.trackPool = TRACK_FILES.map(assetKey => {
            const audio = new Audio(this.resolveAsset(assetKey));
            audio.volume = 0;
            audio.preload = 'auto';
            return audio;
        });

        return this.trackPool;
    }

    loadTracks(category) {
        if (this._loadedCategories.has(category)) {
            return;
        }

        const list = this.getTrackList(category);
        for (const audio of this.getTrackPool()) {
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

        // Draw at random, but never repeat the track that just finished.
        // Retrying by recursing could keep drawing the same track and blow the
        // stack, so this is a bounded loop; a single-track category repeats
        // because there is nothing else to pick.
        let track = this.lastTrack;
        for (let attempt = 0; attempt < this.tracks.length; attempt++) {
            const candidate = this.pickRandom(this.tracks);
            if (candidate !== this.lastTrack) {
                track = candidate;
                break;
            }
        }

        this.lastTrack = track;
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

    clearFade() {
        if (this.fadeInterval) {
            clearInterval(this.fadeInterval);
            this.fadeInterval = null;
        }
    }

    fadeIn(audio) {
        const step = 50;
        const increment = this.volume / (this.fadeTime / step);
        let current = 0;

        // Only one fade can own the interval handle; leaving an old one running
        // would keep ramping a track that is no longer playing.
        this.clearFade();

        // Rejected when the browser blocks autoplay before the first click;
        // swallowing it keeps the queue alive instead of logging an unhandled
        // rejection every time.
        const started = audio.play();
        if (started && typeof started.catch === 'function') {
            started.catch(() => {});
        }

        this.fadeInterval = setInterval(() => {
            current += increment;
            if (current >= this.volume) {
                audio.volume = this.volume;
                this.clearFade();
            } else {
                audio.volume = current;
            }
        }, step);
    }

    fadeOut(audio, callback) {
        const step = 50;
        // A silent track yields a decrement of 0, which would leave this
        // interval running forever and never stop the music.
        const decrement = audio.volume > 0 ? audio.volume / (this.fadeTime / step) : Infinity;

        this.clearFade();

        this.fadeInterval = setInterval(() => {
            audio.volume -= decrement;
            if (audio.volume <= 0) {
                audio.volume = 0;
                audio.pause();
                audio.currentTime = 0;
                this.clearFade();
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
        this.clearFade();

        // Silence everything, not just the track we remember as current: a track
        // started before a category switch can still be playing, and leaving it
        // audible would stack music on top of music.
        const toStop = new Set([...this.getTrackPool(), this.currentTrack, this.nextTrack]);
        for (const audio of toStop) {
            if (!audio) continue;

            audio.pause();
            audio.currentTime = 0;
            audio.volume = 0;
            audio.onended = null;
        }

        this.currentTrack = null;
        this.nextTrack = null;
        this.lastTrack = null;
    }
}