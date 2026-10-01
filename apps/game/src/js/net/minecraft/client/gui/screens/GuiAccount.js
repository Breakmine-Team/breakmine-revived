import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiPasswordField from "../widgets/GuiPasswordField.js";
import GuiTextField from "../widgets/GuiTextField.js";
import GuiWaitForCompletion from "./GuiWaitForCompletion.js";
import * as AuthLib from "../../network/AuthLib.js";

export default class GuiAccount extends GuiScreen {

    constructor(parentScreen) {
        super();
        this.parentScreen = parentScreen;
        this.errorMessage = "";
    }

    init() {
        super.init();

        // [       Login/Register OR Logout       ]
        // [                 Cancel               ]
        
        let y = this.height / 2 - 50;

        this.fieldUsername = new GuiTextField(this.width / 2 - 100, y + 30, 200, 20);
        this.fieldPassword = new GuiPasswordField(this.width / 2 - 100, y + 67, 200, 20);
        this.fieldUsername.maxLength = 20;
        this.fieldUsername.text = this.minecraft.settings.loggedIn ? this.getCurrentUsername() : "";
        
        this.buttonList.push(this.fieldUsername);
        this.buttonList.push(this.fieldPassword);

        // Dynamic Login/Logout Button
        this.actionButton = new GuiButton(this.minecraft.settings.loggedIn ? "Log Out" : "Login or Register", this.width / 2 - 100, y + 110, 200, 20, () => {
            if (this.minecraft.settings.loggedIn) {
                this.handleLogout();
            } else {
                this.handleLogin();
            }
        });

        let cancelButton = new GuiButton("Cancel", this.width / 2 - 100, y + 134, 200, 20, () => {
            this.minecraft.displayScreen(this.parentScreen);
        });

        this.buttonList.push(this.actionButton);
        this.buttonList.push(cancelButton);

        this.updateButtonStates();
    }

    getCurrentUsername() {
        const session = this.minecraft && this.minecraft.getSession ? this.minecraft.getSession() : null;
        const profile = session && session.getProfile ? session.getProfile() : null;
        if (profile && profile.username) {
            return profile.username;
        }
        return this.minecraft && this.minecraft.settings ? this.minecraft.settings.username : "";
    }

    updateButtonStates() {
        const loggedIn = Boolean(this.minecraft?.settings?.loggedIn);
        
        // Update the main action button text
        if (this.actionButton) {
            this.actionButton.string = loggedIn ? "Log Out" : "Login or Register";
        }
        
    }

    async handleLogin() {
        const username = this.fieldUsername.text.trim();
        const password = this.fieldPassword.text.trim();
        this.errorMessage = "";

        if (!username || !password) {
            this.errorMessage = "Username and password cannot be empty.";
            return;
        }

        if (username.includes(' ')) {
            this.errorMessage = "Username cannot have spaces";
            return;
        }

        this.minecraft.displayScreen(new GuiWaitForCompletion(this, `Signing in as ${username}...`, async () => {
            try {
                const exists = await AuthLib.userExists(username);
                let result;

                if (exists) {
                    result = await AuthLib.login(username, password);
                } else {
                    await AuthLib.register(username, password);
                    result = await AuthLib.login(username, password);
                }

                this.loginUsername(username);
                this.minecraft.updateAccessToken(result.token);
                this.minecraft.settings.token = AuthLib.getAuthToken();
                this.minecraft.settings.username = username;
                this.minecraft.settings.loggedIn = true;
                this.minecraft.settings.save();
                
                this.updateButtonStates();
            } catch (error) {
                const errorDetail = error.message.includes('Details:')
                                  ? error.message.split('Details: ')[1]
                                  : error.message;

                this.errorMessage = `Authentication failed: ${errorDetail}`;
                console.error("Authentication Error:", error);
            }
        }));
    }

    handleLogout() {
        this.errorMessage = "Signed out";

        if (this.minecraft?.setSession) {
            this.minecraft.setSession(null, true);
        }

        if (this.minecraft?.settings) {
            this.minecraft.settings.loggedIn = false;
            this.minecraft.settings.token = "";
            this.minecraft.settings.save();
        }

        if (this.fieldUsername) {
            this.fieldUsername.text = "";
        }
        if (this.fieldPassword) {
            this.fieldPassword.text = "";
        }
        
        this.updateButtonStates();
    }

    loginUsername(username) {
        this.minecraft.newSessionFromUsername(username);
        this.minecraft.settings.loggedIn = true;
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.drawDefaultBackground(stack);
        this.drawCenteredString(stack, "Account", this.width / 2, 50);

        let y = this.height / 2 - 50;

        // Keep button states synchronized during draw cycles
        this.updateButtonStates();

        const currentUsername = this.getCurrentUsername();
        if (this.minecraft.settings.loggedIn && currentUsername) {
            this.drawCenteredString(stack, `Signed in as ${currentUsername}`, this.width / 2, y - 8, 0xFFAAAAAA);
        } else {
            this.drawCenteredString(stack, "Not signed in", this.width / 2, y - 8, 0xFFAAAAAA);
        }

        this.drawString(stack, "Username", this.width / 2 - 100, y + 17, -6250336);
        this.drawString(stack, "Password", this.width / 2 - 100, y + 17 + 38, -6250336);

        if (this.errorMessage) {
            let color = 0xFFFF5555;
            if (this.errorMessage.includes("successfully uploaded") || this.errorMessage.includes("'s skin")) {
                color = 0xFF55FF55;
            } else if (this.errorMessage.includes("Waiting for file selection") || this.errorMessage.includes("Authenticating user")) {
                color = 0xFFFFFF55;
            }

            this.drawCenteredString(stack, this.errorMessage, this.width / 2, y + 160, color);
        }

        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
    
    onClose() {
        this.minecraft.settings.save();
    }
}
