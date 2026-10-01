import GuiButton from "../widgets/GuiButton.js";
import GuiScreen from "../GuiScreen.js";
import GuiOptions from "./GuiOptions.js";

export default class GuiDeath extends GuiScreen {

    constructor(player) {
        super();
        this.player = player;
    }

    init() {
        super.init();

        let y = this.height / 2 - 30;
        this.buttonList.push(new GuiButton("Respawn", this.width / 2 - 100, y + 24 * 2, 98, 20, () => {
            if (this.minecraft.isSingleplayer()) {
                this.player.respawn();
                this.minecraft.displayScreen(null);
            } else {
                // Multiplayer respawn is server-authoritative: the server resets
                // the position to spawn, pushes chunks, and the client stays on
                // the loading screen until the terrain around the spawn loads.
                this.player.requestRespawn();
            }
        }));

        this.buttonList.push(new GuiButton("Quit to Title", this.width / 2 + 2, y + 24 * 2, 98, 20, async () => {
            await this.minecraft.loadWorld(null);
        }));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        // Background
        this.drawRect(stack, 0, 0, this.width, this.height, 'red', 0.5);

        // Title
        this.drawCenteredString(stack, "You Died!", this.width / 2, 40);
        this.drawCenteredString(stack, `${this.player.username} ${this.player.typeOfDeath}`, this.width / 2, 60);

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }

    keyTyped(key, character) {
        for (let i in this.buttonList) {
            let button = this.buttonList[i];

            button.keyTyped(key, character);
        }

        return false;
    }

}