import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiPresetSlotContainer from "../widgets/GuiPresetSlotContainer.js";

export default class GuiPresets extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.worldSlotContainer = null;
        this.selectedWorld = -1;
    }

    setSelectedWorld(index) {
        this.selectedWorld = index;
        const bool = (index >= 0 && index < this.saveList.length);
        this.buttonSelect.enabled = bool;
    }

    init() {
        super.init();

        this.saveList = [
            {
                name: "The Burrow",
                details: "A circle of land enclosed by some semi-floating land above it.",
                seed: "-5529091579467429620"
            },
            {
                name: "Flatness",
                details: "A very bare spawn area with no trees and flat hills.",
                seed: "-5855597882444181042"
            },
            {
                name: "Tree Mountain",
                details: "Mountain with trees on it.",
                seed: "262035034691567314"
            },
            {
                name: "Plain Hills",
                details: "A large area of hills with some trees.",
                seed: "-6548455560752389939"
            },
            {
                name: "Mountains of Oz",
                details: "Really cool mountains.",
                seed: "5872522473413159476"
            }
        ];

        this.worldSlotContainer = new GuiPresetSlotContainer(this, this.saveList);

        this.buttonSelect = new GuiButton(this.minecraft, "Select this Preset", this.width / 2 - 155, this.height - 28, 150, 20, () => {
            if (this.selectedWorld !== -1) {
                const preset = this.saveList[this.selectedWorld];
                this.previousScreen.setSeed(preset.seed);
                this.minecraft.displayScreen(this.previousScreen);
            }
        });

        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
        this.buttonList.push(this.buttonSelect);
        this.buttonSelect.enabled = false;
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.worldSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        this.drawCenteredString(stack, "Select World Preset", this.width / 2, 20);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    // Forward drag/release so the scrollbar thumb can be dragged.
    mouseDragged(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    // Forward mouse wheel events to the list (handled by the container).
    mouseScrolled(mouseX, mouseY, amount) {
        this.worldSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        super.mouseScrolled(mouseX, mouseY, amount);
    }

    onScroll(mouseX, mouseY, amount) {
        this.worldSlotContainer.mouseScrolled(mouseX, mouseY, amount);
    }

    onClose() {

    }
}
