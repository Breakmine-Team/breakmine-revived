export default class GameSettings {

    constructor() {
        // Movement
        this.keyForward = 'KeyW';
        this.keyLeft = 'KeyA';
        this.keyBack = 'KeyS';
        this.keyRight = 'KeyD';
        this.keyJump = 'Space';
        this.keyCrouching = 'ShiftLeft';
        this.keySprinting = 'ControlLeft';

        // Gameplay
        this.keyDrop = 'KeyQ';
        this.keyTogglePerspective = 'F5';
        this.keyToggleGui = 'F1';
        this.keyScreenshot = 'F2';
        this.keyDebug = 'F3';

        // Inventory
        this.keyOpenInventory = 'KeyE';
        for (let slot = 1; slot <= 9; slot++) {
            this['keyHotbar' + slot] = 'Digit' + slot;
        }

        // Multiplayer
        this.keyOpenChat = 'KeyT';
        this.keyOpenCommands = 'Slash';
        this.keyPlayerList = 'Tab';
        this.keyVoiceChat = 'KeyO';

        this.session = null;

        this.language = 'en';

        this.thirdPersonView = 0;
        this.fov = 70;
        // Pixel ratio the 3D world is rendered at, 1 = full resolution.
        this.resolution = 1;
        this.viewBobbing = true;
        this.ambientOcclusion = true;
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

        // Voice chat (P2P, push-to-talk). TURN relay used when a direct
        // WebRTC connection fails (symmetric NAT etc). Comma-separated URLs;
        // leave empty to use the built-in free relay list.
        this.voiceTurnUrls = '';
        this.voiceTurnUsername = '';
        this.voiceTurnPassword = '';

        this.tvmode = false;

        this.token = ''; // TODO: Make more secure
        this.username = '';

        this.loggedIn = false;

        this.selectedTexturePack = null;
    }

    /**
     * Pixel ratio the world renders at (Options "Resolution"), from 1 down to
     * 0.1. Anything missing or out of range in a saved blob falls back to 1.
     */
    getResolution() {
        const value = Number(this.resolution);
        if (!Number.isFinite(value)) return 1;
        return Math.min(1, Math.max(0.1, value));
    }

    /**
     * Mouse/cursor look sensitivity (Controls screen slider, 100 = default).
     */
    getMouseSensitivity() {
        const value = Number(this.sensitivity);
        return Number.isFinite(value) && value > 0 ? value : 100;
    }

    /**
     * Look sensitivity for remotes - gamepads and TV remotes looking around
     * in game (Options slider "Controller Sensitivity", 100 = default).
     * Anything invalid in a saved settings blob falls back to 100.
     */
    getRemoteSensitivity() {
        const value = Number(this.remoteSensitivity);
        return Number.isFinite(value) && value > 0 ? value : 100;
    }

    load() {
        const saved = localStorage.getItem('breakmine_settings');
        if (!saved) return;
        const data = JSON.parse(saved);
        Object.assign(this, data);
    }

    save() {
        localStorage.setItem('breakmine_settings', JSON.stringify(this));
    }

}