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
        this.resolution = 1;
        this.viewBobbing = true;
        this.ambientOcclusion = true;
        this.fancyLeaves = false;
        this.shadows = false;
        this.sensitivity = 100;
        this.viewDistance = 4;
        this.fogType = 'modern';
        this.showRealmsButton = false;
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
        this.showPreview = true;
        this.remoteSensitivity = 100;

        this.voiceTurnUrls = '';
        this.voiceTurnUsername = '';
        this.voiceTurnPassword = '';

        this.tvmode = false;

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

    
    getMouseSensitivity() {
        const value = Number(this.sensitivity);
        return Number.isFinite(value) && value > 0 ? value : 100;
    }

    
    getRemoteSensitivity() {
        const value = Number(this.remoteSensitivity);
        return Number.isFinite(value) && value > 0 ? value : 100;
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