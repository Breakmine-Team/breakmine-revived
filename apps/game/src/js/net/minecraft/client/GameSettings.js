export default class GameSettings {

    constructor() {
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
        this.ambientOcclusion = true;
        this.sensitivity = 100;
        this.viewDistance = 4;
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
    }

    save() {
        localStorage.setItem('breakmine_settings', JSON.stringify(this));
    }

}