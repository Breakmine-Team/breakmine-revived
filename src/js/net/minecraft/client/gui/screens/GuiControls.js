import GuiScreen from "../GuiScreen.js";
import GuiKeyButton from "../widgets/GuiKeyButton.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiSliderButton from "../widgets/GuiSliderButton.js";
import GuiSwitchButton from "../widgets/GuiSwitchButton.js";
import GuiListButton from "../widgets/GuiListButton.js";

const bindings = [
    { name: 'Forward', setting: 'keyForward', defaultKey: 'KeyW', page: 1 },
    { name: 'Backward', setting: 'keyBackward', defaultKey: 'KeyS', page: 1 },
    { name: 'Left', setting: 'keyLeft', defaultKey: 'KeyA', page: 1 },
    { name: 'Right', setting: 'keyRight', defaultKey: 'KeyD', page: 1 },
    { name: 'Jump', setting: 'keyJump', defaultKey: 'Space', page: 1 },
    { name: 'Crouch', setting: 'keyCrouching', defaultKey: 'ShiftLeft', page: 1 },
    { name: 'Sprint', setting: 'keySprinting', defaultKey: 'ControlLeft', page: 1 },
    { name: 'Inventory', setting: 'keyOpenInventory', defaultKey: 'KeyE', page: 2 },
    { name: 'Drop Item', setting: 'keyDrop', defaultKey: 'KeyQ', page: 2 },
    { name: 'Chat', setting: 'keyOpenChat', defaultKey: 'KeyT', page: 2 },
    { name: 'Commands', setting: 'keyOpenCommands', defaultKey: 'Slash', page: 2 },
    { name: 'Player List', setting: 'keyPlayerList', defaultKey: 'Tab', page: 2 },
    { name: 'Perspective', setting: 'keyTogglePerspective', defaultKey: 'F5', page: 2 }
];

export default class GuiControls extends GuiScreen {
    constructor(previousScreen) {
        super();
        this.previousScreen = previousScreen;
        this.pauseGame = true;
        this.page = 0;
    }

    init() {
        super.init();
        this.buildPage();
    }

    buildPage() {
        this.buttonList = [];
        this.selectedButtonIndex = -1;
        const settings = this.minecraft.settings;
        const width = Math.min(300, this.width - 20);
        const x = (this.width - width) / 2;
        const y = this.height / 2 - 68;
        if (this.page === 0) {
            this.buttonList.push(new GuiSliderButton('Mouse Sensitivity', settings.sensitivity, 50, 150, x, y, width, 20, value => {
                settings.sensitivity = value;
            }).setDisplayNameBuilder((name, value) => `${name}: ${value}%`));
            this.buttonList.push(new GuiListButton('Touch Movement', settings.touchMovement, [
                { key: 'joystick', name: 'Joystick' }, { key: 'dpad', name: 'D-Pad' }
            ], x, y + 48, width, 20, value => { settings.touchMovement = value; }));
            this.buttonList.push(new GuiSwitchButton('TV Mode', settings.tvmode, x, y + 24, width, 20, value => {
                settings.tvmode = value;
            }));
        } else {
            const pageBindings = bindings.filter(binding => binding.page === this.page);
            const columnWidth = (width - 4) / 2;
            pageBindings.forEach((binding, index) => {
                const button = new GuiKeyButton(binding.name, settings[binding.setting], x + (index % 2) * (columnWidth + 4), y + Math.floor(index / 2) * 24, columnWidth, 20, key => {
                    // Swap duplicate bindings so changing one key never silently
                    // activates two actions at the same time.
                    const previous = settings[binding.setting];
                    const conflict = bindings.find(other => other.setting !== binding.setting && settings[other.setting] === key);
                    if (conflict) settings[conflict.setting] = previous;
                    settings[binding.setting] = key;
                    this.buildPage();
                    this.selectFirstEnabledButton();
                });
                this.buttonList.push(button);
            });
        }
        const navY = y + 104;
        const third = (width - 8) / 3;
        this.buttonList.push(new GuiButton(this.minecraft, '< Prev', x, navY, third, 20, () => {
            this.page = Math.max(0, this.page - 1); this.buildPage(); this.selectFirstEnabledButton();
        }).setEnabled(this.page > 0));
        this.buttonList.push(new GuiButton(this.minecraft, 'Reset Keys', x + third + 4, navY, third, 20, () => {
            for (const binding of bindings) settings[binding.setting] = binding.defaultKey;
            this.buildPage(); this.selectFirstEnabledButton();
        }));
        this.buttonList.push(new GuiButton(this.minecraft, 'Next >', x + (third + 4) * 2, navY, third, 20, () => {
            this.page = Math.min(2, this.page + 1); this.buildPage(); this.selectFirstEnabledButton();
        }).setEnabled(this.page < 2));
        this.buttonList.push(new GuiButton(this.minecraft, 'Done', x, navY + 24, width, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
    }

    keyTyped(key, character) {
        const listening = this.buttonList.find(button => button instanceof GuiKeyButton && button.listening);
        if (listening) {
            if (key === 'Escape') {
                listening.cancel();
            } else {
                listening.keyTyped(key, character);
            }
            return true;
        }
        return super.keyTyped(key, character);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        for (const button of this.buttonList) {
            if (button instanceof GuiKeyButton && button.listening) button.cancel();
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, ['Controls - Mouse', 'Controls - Movement', 'Controls - Gameplay'][this.page], this.width / 2, this.height / 2 - 92);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() { this.minecraft.settings.save(); }
}
