import GuiScreen from "../GuiScreen.js";
import GuiKeyButton from "../widgets/GuiKeyButton.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiSliderButton from "../widgets/GuiSliderButton.js";
import GuiSwitchButton from "../widgets/GuiSwitchButton.js";
import GuiTooltip from "../widgets/GuiTooltip.js"

export default class GuiControls extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.pauseGame = true;
    }

    init() {
        super.init();

        let settings = this.minecraft.settings;

        let y = this.height / 2 - 50;

        this.buttonList.push(new GuiSliderButton("Mouse Sensitivity", settings.sensitivity, 50, 150, this.width / 2 - 100, y - 24, 200, 20, value => {
            settings.sensitivity = value;
        }).setDisplayNameBuilder(function (name, value) {
            return name + ": " + value + "%";
        }));

        this.buttonList.push(new GuiSwitchButton("TV Mode", settings.tvmode, this.width / 2 - 100, y, 200, 20, (val) => {
            settings.tvmode = val;
        }));

        this.buttonList.push(new GuiKeyButton("Crouch", settings.keyCrouching, this.width / 2 - 100, y + 24, 98, 20, key => {
            settings.keyCrouching = key;
        }));

        this.buttonList.push(new GuiKeyButton("Sprint", settings.keySprinting, this.width / 2 + 2, y + 24, 98, 20, key => {
            settings.keySprinting = key;
        }));

        this.buttonList.push(new GuiKeyButton("Toggle Perspective", settings.keyTogglePerspective, this.width / 2 - 100, y + 24 * 2, 200, 20, key => {
            settings.keyTogglePerspective = key;
        }));

        this.buttonList.push(new GuiKeyButton("Open Chat", settings.keyOpenChat, this.width / 2 - 100, y + 24 * 3, 200, 20, key => {
            settings.keyOpenChat = key;
        }));

        this.buttonList.push(new GuiKeyButton("Open Inventory", settings.keyOpenInventory, this.width / 2 - 100, y + 24 * 4, 200, 20, key => {
            settings.keyOpenInventory = key;
        }));

        this.buttonList.push(new GuiButton(this.minecraft, "Done", this.width / 2 - 100, y + 130, 200, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));

        this.guiTooltip = new GuiTooltip(this.minecraft, `For playing Breakmine on Smart TVs
§7Arrow keys: move | Arrow Keys + Enter: Look
§7Back/return: pause / go back
§7Red: Break | Green: Place
§7Yellow: Open inventory | Blue: Cycle hotbar`, this.width / 2 - 100, y, 200, 20);
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Background
        this.drawDefaultBackground(stack);

        // Title
        this.drawCenteredString(stack, "Controls", this.width / 2, 50);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
        
        // Draw tooltip
        this.guiTooltip.render(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
        // Save settings
        this.minecraft.settings.save();
    }

}