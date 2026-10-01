import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiModSlotContainer from "../widgets/GuiModSlotContainer.js";
import GuiModSlot from "../widgets/GuiModSlot.js";
import GuiYesNo from "./GuiYesNo.js";

export default class GuiMods extends GuiScreen {

    constructor(minecraft, previousScreen) {
        super();
        this.minecraft = minecraft;
        this.previousScreen = previousScreen;
        this.mods = [];
        this.modSlotContainer = null;
        this.selectedIndex = -1;
        this.dirty = false;
    }

    setSelectedWorld(index) {
        this.selectedIndex = index;
        this.updateButtonStates();
    }

    rebuildSlotList() {
        if (!this.modSlotContainer) return;
        this.modSlotContainer.slotList = this.mods.map((data, index) =>
            new GuiModSlot(
                data, 5, 0, this.width - 10, 36,
                () => { 
                    this.modSlotContainer.setSelected(index); 
                    this.setSelectedWorld(index); // Sync selectedIndex in GuiMods
                },
                this.minecraft
            )
        );
    }

    async init() {
        super.init();

        await this.refreshModList();

        // Ensure mod.enabled defaults to true if missing from the modloader startup response
        this.mods.forEach(mod => {
            if (mod.enabled === undefined || mod.enabled === null) {
                mod.enabled = true;
            }
        });

        this.modSlotContainer = new GuiModSlotContainer(this, this.mods);
        this.rebuildSlotList();

        this.buttonToggle = new GuiButton(this.minecraft, "Toggle", this.width / 2 - 155, this.height - 52, 150, 20, async () => {
            if (this.selectedIndex < 0 || this.selectedIndex >= this.mods.length) return;
            const mod = this.mods[this.selectedIndex];
            const newState = !mod.enabled;
            await this.minecraft.modLoader.toggleMod(mod.id, newState);
            this.dirty = true;
            await this.refreshModList();
            this.rebuildSlotList();
            this.updateButtonStates();
        });

        this.buttonUpload = new GuiButton(this.minecraft, "Upload .zip", this.width / 2 + 5, this.height - 52, 150, 20, () => {
            this.uploadMod();
        });

        this.buttonDelete = new GuiButton(this.minecraft, "Delete", this.width / 2 - 155, this.height - 28, 150, 20, async () => {
            if (this.selectedIndex < 0 || this.selectedIndex >= this.mods.length) return;
            const mod = this.mods[this.selectedIndex];
            this.minecraft.displayScreen(new GuiYesNo(this, `Delete mod "${mod.name}" by ${mod.author}?`, "This action cannot be undone!", "Delete", "Cancel", async () => {
                await this.minecraft.modLoader.uninstallMod(mod.id);
                this.dirty = true;
                await this.refreshModList();
                this.rebuildSlotList();
                this.selectedIndex = -1;
                this.updateButtonStates();
            }));
        });

        this.buttonBack = new GuiButton(this.minecraft, "Cancel", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            this.goBack();
        });

        this.buttonList.push(this.buttonUpload);
        this.buttonList.push(this.buttonToggle);
        this.buttonList.push(this.buttonDelete);
        this.buttonList.push(this.buttonBack);

        this.updateButtonStates();
    }

    goBack() {
        if (this.dirty) {
            window.location.reload();
        } else {
            this.minecraft.displayScreen(this.previousScreen);
        }
    }

    updateButtonStates() {
        const hasSelection = this.selectedIndex >= 0 && this.selectedIndex < this.mods.length;
        this.buttonToggle.enabled = hasSelection;
        this.buttonDelete.enabled = hasSelection;

        if (hasSelection) {
            const mod = this.mods[this.selectedIndex];
            this.buttonToggle.string = mod.enabled ? "Disable" : "Enable";
        } else {
            this.buttonToggle.string = "Toggle";
        }

        if (this.buttonBack) {
            this.buttonBack.string = this.dirty ? "Reload" : "Cancel";
        }
    }

    async refreshModList() {
        if (!this.minecraft.modLoader) return;
        this.mods = await this.minecraft.modLoader.getInstalledMods();
    }

    uploadMod() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.zip';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return;
            try {
                await this.minecraft.modLoader.installModFromZip(file);
                this.dirty = true;
                await this.refreshModList();
                this.rebuildSlotList();
                this.selectedIndex = this.mods.length - 1;
                this.updateButtonStates();
            } catch (err) {
                alert('Failed to install mod: ' + err.message);
            }
        };
        input.click();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, "Mods", this.width / 2, 16);

        if (this.mods.length === 0) {
            this.drawRect(stack, 0, 32, this.width, this.height - 64, "rgba(0, 0, 0, 0.5)");
            this.drawCenteredString(stack, "No mods installed.", this.width / 2, this.height / 2 - 20);
        } else if (this.modSlotContainer) {
            this.modSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    mouseClicked(mouseX, mouseY, mouseButton) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        }
        super.mouseClicked(mouseX, mouseY, mouseButton);
    }

    mouseScrolled(mouseX, mouseY, delta) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseScrolled(mouseX, mouseY, delta);
        }
    }

    // Forward drag/release so the scrollbar thumb can be dragged.
    mouseDragged(mouseX, mouseY, mouseButton) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        }
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        }
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

    onScroll(mouseX, mouseY, amount) {
        if (this.modSlotContainer) {
            this.modSlotContainer.mouseScrolled(mouseX, mouseY, amount);
        }
    }

    keyTyped(key, character) {
        if (key === "Escape") {
            this.goBack();
            return true;
        }
        return super.keyTyped(key, character);
    }

    onClose() {

    }
}