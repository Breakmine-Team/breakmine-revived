import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import World from "../../world/World.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiSwitchButton from "../widgets/GuiSwitchButton.js";
import GuiPresets from "./GuiPresets.js";
import Random from "../../../util/Random.js";
import Long from "../../../../../../../libraries/long.js";
import ChunkProviderGenerate from "../../world/provider/ChunkProviderGenerate.js";
import ChunkProviderGenerateWorker from "../../world/provider/ChunkProviderGenerateWorker.js";
import PlayerController from "../../network/controller/PlayerController.js";

export default class GuiCreateWorld extends GuiScreen {

    constructor(previousScreen) {
        super();
        this.previousScreen = previousScreen;
        
        // Settings State
        this.gameMode = "survival"; // survival, --hardcore--, creative, spectator
        this.generateStructures = true;
        this.hardcoreMode = false;
        this.isMoreOptionsMode = false;
        this.createClicked = false;

        this.worldNameText = "New World";
        this.seedText = "";
        this.folderName = "World";

        this.worldType = "normal";
    }

    init() {
        super.init();

        let y = this.height / 2 - 50;

        // Text Fields
        this.textboxWorldName = new GuiTextField(this.width / 2 - 100, y + 10, 200, 20);
        this.textboxWorldName.setText(this.worldNameText);
        this.textboxWorldName.maxLength = 32;
        this.textboxWorldName.isFocused = true;

        this.textboxSeed = new GuiTextField(this.width / 2 - 100, y + 10, 200, 20);
        this.textboxSeed.setText(this.seedText);
        this.textboxSeed.maxLength = 30;

        // Static action buttons (Bottom)
        this.btnCreateWorld = new GuiButton(this.minecraft, "Create New World", this.width / 2 - 155, this.height - 28, 150, 20, () => {
            this.handleCreateWorld();
        });
        this.buttonList.push(this.btnCreateWorld);

        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 + 5, this.height - 28, 150, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));

        // Contextual layout buttons
        this.btnGameMode = new GuiButton(this.minecraft, "Game Mode: Survival", this.width / 2 - 75, y + 50, 150, 20, () => {
            this.cycleGameMode();
        });
        
        this.btnMapFeatures = new GuiSwitchButton("Generate Structures", this.generateStructures, this.width / 2 - 155, y + 50, 150, 20, (val) => {
            this.generateStructures = val;
        });
        this.btnMapFeatures.setEnabled(false);

        this.btnMapType = new GuiButton(this.minecraft, "World Type: Normal", this.width / 2 + 5, y + 50, 150, 20, () => {
            this.cycleWorldType();
        });

        // Open Preset button (Positioned below the World Type button)
        this.btnOpenPreset = new GuiButton(this.minecraft, "Open Preset", this.width / 2 + 5, y + 75, 150, 20, () => {
            this.minecraft.displayScreen(new GuiPresets(this));
        });

        this.btnMoreOptions = new GuiButton(this.minecraft, "More World Options...", this.width / 2 - 75, y + 122, 150, 20, () => {
            this.toggleMoreOptions();
        });

        this.updateButtonVisibility();
        this.updateGameModeStrings();
        this.makeUseableName();
    }

    cycleGameMode() {
        if (this.gameMode === "survival") {
            this.gameMode = "creative";
        } else if (this.gameMode === "creative") {
            this.gameMode = "spectator";
        } else {
            this.gameMode = "survival";
        }
        this.updateGameModeStrings();
    }

    updateGameModeStrings() {
        if (this.gameMode === "survival") {
            this.btnGameMode.string = "Game Mode: Survival";
            this.gameModeLine1 = "Search for resources, crafting, gain";
            this.gameModeLine2 = "levels, health and hunger.";
        } else if (this.gameMode === "creative") {
            this.btnGameMode.string = "Game Mode: Creative";
            this.gameModeLine1 = "Unlimited resources, free flying and";
            this.gameModeLine2 = "destroy blocks instantly.";
        } else {
            this.btnGameMode.string = "Game Mode: Spectator";
            this.gameModeLine1 = "Can look through blocks, fly through";
            this.gameModeLine2 = "walls. Can't interact with blocks.";
        }
    }

    cycleWorldType() {
        if (this.worldType === "normal") {
            this.btnMapType.string = "World Type: Amplified";
            this.worldType = "amplified";
        } else if (this.worldType === "amplified") {
            this.btnMapType.string = "World Type: Flat";
            this.worldType = "flat";
        } else if (this.worldType === "flat") {
            this.btnMapType.string = "World Type: Preset";
            this.worldType = "preset";
        } else {
            this.btnMapType.string = "World Type: Normal";
            this.worldType = "normal";
        }
        // Refresh visibility immediately when world type changes
        this.updateButtonVisibility();
    }

    toggleMoreOptions() {
        this.isMoreOptionsMode = !this.isMoreOptionsMode;
        this.btnMoreOptions.string = this.isMoreOptionsMode ? "Done" : "More World Options...";
        this.updateButtonVisibility();
    }

    updateButtonVisibility() {
        // Clear dynamically managed items
        this.buttonList = this.buttonList.filter(b => b === this.btnCreateWorld || b.string === "Cancel");

        if (!this.isMoreOptionsMode) {
            this.buttonList.push(this.textboxWorldName);
            this.buttonList.push(this.btnGameMode);
        } else {
            this.buttonList.push(this.textboxSeed);
            this.buttonList.push(this.btnMapFeatures);
            this.buttonList.push(this.btnMapType);
            
            // Only show Open Preset if more options is open AND world type is preset
            if (this.worldType === "preset") {
                this.buttonList.push(this.btnOpenPreset);
            }
        }
        this.buttonList.push(this.btnMoreOptions);
    }

    makeUseableName() {
        let name = this.textboxWorldName.getText().trim();
        name = name.replace(/[\\/:*?"<>| ]/g, '_');
        
        if (name.length === 0) {
            name = "World";
        }
        this.folderName = name; 
    }

    setSeed(seedText) {
        this.seedText = seedText;
        if (this.textboxSeed) {
            this.textboxSeed.setText(seedText);
        }
    }

    handleCreateWorld() {
        if (this.createClicked) return;
        this.createClicked = true;

        let seed = this.textboxSeed.getText();
        let seedLong;

        if (seed.length === 0) {
            seedLong = new Random().nextLong();
        } else if (isNaN(seed)) {
            let h = 0;
            for (let i = 0; i < seed.length; i++) {
                h = 31 * h + seed.charCodeAt(i);
            }
            seedLong = Long.fromNumber(h);
        } else {
            seedLong = Long.fromString(seed);
        }

        const worldName = this.textboxWorldName.getText().trim() || "New World";
        // The integrated server owns the world now; the game mode is applied
        // server-side and streamed back to the client on login.
        this.minecraft.createNewWorld(worldName, seedLong, this.worldType, this.gameMode);
    }



    keyTyped(key, character) {
        super.keyTyped(key, character);
        
        this.worldNameText = this.textboxWorldName.getText();
        this.seedText = this.textboxSeed.getText();
        
        this.btnCreateWorld.setEnabled(this.textboxWorldName.getText().trim().length > 0);
        this.makeUseableName();
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, "Create New World", this.width / 2, 20);

        let y = this.height / 2 - 50;

        if (!this.isMoreOptionsMode) {
            this.drawString(stack, "World Name", this.width / 2 - 100, y - 3, -6250336);
            this.drawString(stack, "Will be saved in: " + this.folderName, this.width / 2 - 100, y + 35, -6250336);
            
            this.drawString(stack, this.gameModeLine1, this.width / 2 - 100, y + 77, -6250336);
            this.drawString(stack, this.gameModeLine2, this.width / 2 - 100, y + 89, -6250336);
        } else {
            this.drawString(stack, "Seed for the World Generator", this.width / 2 - 100, y - 3, -6250336);
            this.drawString(stack, "Leave blank for a random seed", this.width / 2 - 100, y + 35, -6250336);
        }
        this.drawCenteredString(stack, "World saving is still in development, don't rely on it!", this.width / 2, 5, 0xFF6363);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    onClose() {
    }
}