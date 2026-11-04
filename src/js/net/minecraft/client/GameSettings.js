export const HARDWARE_PRESETS = Object.freeze({
    low: Object.freeze({ viewDistance: 2, ambientOcclusion: false, vanillithFrameBudgetMs: 2, vanillithMemoryPreset: 'low', vanillithCachedViewDistance: 4, vanillithLodDistance: 8 }),
    balanced: Object.freeze({ viewDistance: 4, ambientOcclusion: true, vanillithFrameBudgetMs: 4, vanillithMemoryPreset: 'balanced', vanillithCachedViewDistance: 8, vanillithLodDistance: 16 }),
    high: Object.freeze({ viewDistance: 8, ambientOcclusion: true, vanillithFrameBudgetMs: 6, vanillithMemoryPreset: 'high', vanillithCachedViewDistance: 16, vanillithLodDistance: 32 })
});

export default class GameSettings {

    constructor() {
        this.keyForward = 'KeyW';
        this.keyBackward = 'KeyS';
        this.keyLeft = 'KeyA';
        this.keyRight = 'KeyD';
        this.keyJump = 'Space';
        this.keyDrop = 'KeyQ';
        this.keyCrouching = 'ShiftLeft';
        this.keySprinting = 'ControlLeft';
        this.keyTogglePerspective = 'F5';
        this.keyOpenChat = 'KeyT';
        this.keyOpenCommands = 'Slash';
        this.keyOpenInventory = 'KeyE';
        this.keyPlayerList = 'Tab';

        this.session = null;

        this.thirdPersonView = 0;
        this.fov = 70;
        this.viewBobbing = true;
        this.attackIndicator = "crosshair";
        this.ambientOcclusion = true;
        this.clouds = 'fast';
        this.biomeBlendRadius = 2;
        this.sensitivity = 100;
        this.touchMovement = 'joystick';
        this.musicVolume = 35;
        this.soundVolume = 100;
        this.viewDistance = 4;
        this.vanillithFrameBudget = true;
        this.vanillithFrameBudgetMs = 4;
        this.vanillithWarmCache = true;
        this.vanillithPriorityStreaming = false;
        this.vanillithMemoryPreset = 'balanced';
        this.hardwarePreset = 'balanced';
        this.vanillithCachedViewDistance = 8;
        this.vanillithLod = true;
        this.vanillithLodDistance = 16;
        this.vanillithGenerationRadius = 3;
        this.vanillithBackgroundRadius = 16;
        this.vanillithMemoryMiB = 640;
        this.vanillithMemoryCustom = false;
        this.debugOverlay = false;
        this.showChunkBoundaries = false;
        this.showEntityBoundingBoxes = false;
        this.serverAddress = '';
        this.apiUrl = 'api.breakmine.com';
        this.tunnelServer = 'tunnel.breakmine.com';
        this.showPublix = true;
        this.proxyAddress = '';
        this.safePlacing = false;
        this.proxy = '';
        this.showFps = false;
        this.showVersion = false;
        this.dynamicLights = false;
        this.showPreview = true;

        this.tvmode = false;

        this.token = ''; // TODO: Make more secure
        this.username = '';

        this.loggedIn = false;

        this.selectedTexturePack = null;
    }

    load() {
        const saved = localStorage.getItem('breakmine_settings');
        if (!saved) return;
        const data = JSON.parse(saved);
        Object.assign(this, data);
        if (data.vanillithMemoryMiB === undefined) this.vanillithMemoryMiB =
            ({ low: 256, balanced: 640, high: 2048, extreme: 3072 })[this.vanillithMemoryPreset] ?? 640;
        this.syncHardwarePreset();
    }

    applyHardwarePreset(name) {
        if (name === 'custom') { this.hardwarePreset = name; return; }
        const preset = HARDWARE_PRESETS[name];
        if (!preset) throw new RangeError('Unknown hardware preset');
        Object.assign(this, preset);
        this.vanillithMemoryCustom = false;
        this.vanillithMemoryMiB = ({ low: 256, balanced: 640, high: 2048 })[name];
        this.hardwarePreset = name;
    }

    syncHardwarePreset() {
        const preset = HARDWARE_PRESETS[this.hardwarePreset];
        if (!preset || this.vanillithMemoryCustom || Object.entries(preset).some(([key, value]) => this[key] !== value)) this.hardwarePreset = 'custom';
    }

    save() {
        localStorage.setItem('breakmine_settings', JSON.stringify(this));
    }

}
