export default class GameSettings {

    constructor() {
        this.keyForward = 'KeyW';
        this.keyLeft = 'KeyA';
        this.keyBack = 'KeyS';
        this.keyRight = 'KeyD';
        this.keyJump = 'Space';
        this.keyCrouching = 'ShiftLeft';
        this.keySprinting = 'ControlLeft';

        this.keyDrop = 'KeyQ';
        this.keyRagdoll = 'KeyR';
        this.keyTogglePerspective = 'F5';
        this.keyToggleGui = 'F1';
        this.keyScreenshot = 'F2';
        this.keyDebug = 'F3';

        this.keyOpenInventory = 'KeyE';
        for (let slot = 1; slot <= 9; slot++) {
            this['keyHotbar' + slot] = 'Digit' + slot;
        }

        this.keyOpenChat = 'KeyT';
        this.keyOpenCommands = 'Slash';
        this.keyPlayerList = 'Tab';
        this.keyVoiceChat = 'KeyO';

        this.modKeybinds = {};

        this.clouds = 'fancy';

        this.session = null;

        this.language = 'en';

        this.thirdPersonView = 0;
        this.fov = 70;
        this.masterVolume = 1;
        this.musicVolume = 0.25;
        this.blocksVolume = 1;
        this.miscVolume = 1;
        this.guiScale = 'auto';
        this.resolution = 1;
        this.viewBobbing = true;
        this.ambientOcclusion = true;
        this.fancyLeaves = false;
        this.shadows = false;
        this.shadowResolution = '2048';
        this.waterReflectivity = 0.4;
        this.waterWaviness = 0.5;
        this.sensitivity = 100;
        this.viewDistance = 4;
        this.fogType = 'modern';
        this.showRealmsButton = false;
        this.experimentalUi = false;
        this.debugOverlay = false;
        this.showChunkBoundaries = false;
        this.showEntityBoundingBoxes = false;
        this.serverAddress = '';
        this.apiUrl = 'api.breakmine.com';
        this.tunnelServer = 'tunnel.breakmine.com';
        this.showNino = true;
        this.proxyAddress = '';
        this.safePlacing = false;
        this.proxy = '';
        this.showFps = false;
        this.showVersion = false;
        this.dynamicLights = false;
        this.particles = 'all';
        this.showPreview = true;
        this.remoteSensitivity = 100;

        this.voiceTurnUrls = '';
        this.voiceTurnUsername = '';
        this.voiceTurnPassword = '';

        this.tvmode = false;

        // Keep the camera still until the browser has actually captured the
        // cursor, instead of turning it with whatever movement arrives first.
        this.pointerLockDelay = false;

        this.token = ''; 
        this.username = '';

        this.loggedIn = false;

        this.selectedTexturePack = null;
    }

    
    getResolution() {
        const value = Number(this.resolution);
        if (!Number.isFinite(value)) return 1;
        return Math.min(1, Math.max(0.1, value));
    }

    
    getShadowResolution() {
        const value = Number(this.shadowResolution);
        if (!Number.isFinite(value) || value <= 0) return 2048;
        return Math.min(4096, Math.max(256, Math.round(value)));
    }

    getWaterReflectivity() {
        return this._getUnitInterval('waterReflectivity', 0.4);
    }

    getWaterWaviness() {
        return this._getUnitInterval('waterWaviness', 0.5);
    }

    _getUnitInterval(key, fallback) {
        const value = Number(this[key]);
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.max(0, Math.min(1, value));
    }

    
    getMouseSensitivity() {
        const value = Number(this.sensitivity);
        return Number.isFinite(value) && value > 0 ? value : 100;
    }

    
    getRemoteSensitivity() {
        const value = Number(this.remoteSensitivity);
        return Number.isFinite(value) && value > 0 ? value : 100;
    }

    getMasterVolume() {
        return this._getVolume('masterVolume', 1);
    }

    getMusicVolume() {
        return this._getVolume('musicVolume', 0.25);
    }

    getBlocksVolume() {
        return this._getVolume('blocksVolume', 1);
    }

    getMiscVolume() {
        return this._getVolume('miscVolume', 1);
    }

    _getVolume(key, fallback) {
        const value = Number(this[key]);
        if (!Number.isFinite(value)) {
            return fallback;
        }
        return Math.max(0, Math.min(1, value));
    }

    load() {
        const saved = localStorage.getItem('breakmine_settings');
        if (!saved) return;
        const data = JSON.parse(saved);
        Object.assign(this, data);

        if (!this.modKeybinds || typeof this.modKeybinds !== 'object' || Array.isArray(this.modKeybinds)) {
            this.modKeybinds = {};
        }
    }

    
    getModKeybind(setting, fallback = null) {
        const map = this.modKeybinds;
        return map && Object.prototype.hasOwnProperty.call(map, setting)
            ? map[setting]
            : fallback;
    }

    
    setModKeybind(setting, key) {
        if (!this.modKeybinds || typeof this.modKeybinds !== 'object' || Array.isArray(this.modKeybinds)) {
            this.modKeybinds = {};
        }
        this.modKeybinds[setting] = key;
    }

    save() {
        localStorage.setItem('breakmine_settings', JSON.stringify(this));
    }

}