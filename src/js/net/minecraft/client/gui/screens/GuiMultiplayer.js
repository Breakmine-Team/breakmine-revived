import GuiScreen from "../GuiScreen.js";
import GuiButton from "../widgets/GuiButton.js";
import GuiServerSlotContainer from "../widgets/GuiServerSlotContainer.js";
import GuiDirectConnect from "./GuiDirectConnect.js";
import GuiConnecting from "./GuiConnecting.js";
import GuiServerSlot from "../widgets/GuiServerSlot.js";
import GuiYesNo from "./GuiYesNo.js";
import Minecraft from "../../Minecraft.js";
import { SplashTexts } from "../../../../../../resources/splashes.js";
import { ICON_SERVER } from "../../render/gui/FontIcons.js";

export default class GuiMultiplayer extends GuiScreen {

    constructor(previousScreen) {
        super();

        this.previousScreen = previousScreen;
        this.worldSlotContainer = null;
        this.saveList = []; 
        this.selectedWorld = -1;

        this.enableLAN = false;
    }
    
    setSelectedWorld(index) {
        this.selectedWorld = index;
        const bool = (index >= 0 && index < this.saveList.length);
        this.buttonSelect.enabled = bool;
        this.buttonRename.enabled = true; 
        this.buttonDelete.enabled = bool;
    }

    compareVersions(version1, version2) {
        const v1Parts = version1.split('.').map(Number);
        const v2Parts = version2.split('.').map(Number);
        const maxLength = Math.max(v1Parts.length, v2Parts.length);
        for (let i = 0; i < maxLength; i++) {
            const v1Component = v1Parts[i] || 0;
            const v2Component = v2Parts[i] || 0;

            if (v1Component < v2Component) {
                return 2; 
            }
            if (v1Component > v2Component) {
                return 1; 
            }
        }
        return 0; 
    }

    init() {
        super.init();

        if (!this.saveList) {
            this.saveList = [];
        }

        this.worldSlotContainer = new GuiServerSlotContainer(this, this.saveList);
        this.beenAdded = [];
        this.lanBeenAdded = [];

        this.worldSlotContainer.slotList = this.saveList.map((data, index) => this.createServerSlot(data, index));

        const defaultServerFileName = "Nino_Creative.json";

        this.saveList = [];
        if (this.minecraft.settings.showNino) {
            this.saveList.push(
                {
                    name: ICON_SERVER + " Nino Creative",
                    date: "",
                    details: "play.breakmine.com",
                    motd: "Create epic things at Nino Creative!"
                }
            );
        }

        this.worldSlotContainer.slotList = this.saveList.map((data, index) => this.createServerSlot(data, index));

        this.minecraft.fs.listDir(`servers/`).then(fileList => {
            if (fileList !== null) {
                fileList.forEach(fileName => {
                    if (fileName === `servers/${defaultServerFileName}`) {
                        return;
                    }
                    this.minecraft.fs.loadFile(fileName).then(file => {
                        if (file !== null) {
                            let worldJson = JSON.parse(file);
                            const alreadyExists = this.saveList.some(server =>
                                server.name === worldJson.name &&
                                server.date === worldJson.address
                            );

                            if (!alreadyExists) {
                                console.log(`added ${fileName}`);
                                this.saveList.push({
                                    name: worldJson.name ?? "New Server",
                                    date: worldJson.address ?? "127.0.0.1",
                                    details: worldJson.details || "",
                                    motd: worldJson.motd || "",
                                    protocol: worldJson.protocol || "binary"
                                })

                                this.worldSlotContainer.slotList = this.saveList.map((data, index) => this.createServerSlot(data, index));
                            }
                        }
                    }).catch(error => {
                        console.error(error);
                    });
                });
            }
        }).catch(error => {
            console.error(error);
            this.minecraft.displayScreen(this.previousScreen);
        });

        this.buttonSelect = new GuiButton(this.minecraft, "Join Server", this.width / 2 - 154, this.height - 52, 150, 20, () => {
            this.joinServer(this.selectedWorld);
        });
        this.buttonRename = new GuiButton(this.minecraft, "Direct", this.width / 2 - 74, this.height - 28, 70, 20, () => {
            this.minecraft.displayScreen(new GuiDirectConnect(this));
        });
        this.buttonDelete = new GuiButton(this.minecraft, "Delete", this.width / 2 - 154, this.height - 28, 70, 20, () => {
            const selectedServer = this.worldSlotContainer.slotList[this.selectedWorld];
            const serverName = selectedServer.worldName.replaceAll(' ', '_').replaceAll('/', '_');
            this.minecraft.displayScreen(new GuiYesNo(this, "Are you sure you want to remove this server?", `'${selectedServer.worldName ?? "New Server"}' will be lost forever! (A long time!)`, "Yes", "No", () => {
                this.minecraft.fs.deleteFile(`servers/${serverName}.json`).then(() => {
                    this.saveList = this.saveList.filter(server => server.name !== selectedServer.worldName);
                    this.worldSlotContainer.slotList = this.saveList.map((data, index) =>
                        new GuiServerSlot(
                            data,
                            this.width / 2 - 110,
                            0,
                            220,
                            36,
                            () => {
                                this.worldSlotContainer.setSelected(index);
                            },
                            this.minecraft
                        )
                    );
                    this.selectedWorld = -1;
                    this.worldSlotContainer.selectedWorld = -1;
                    this.buttonSelect.enabled = false;
                    this.buttonDelete.enabled = false;
                }).catch(error => {
                    console.error(error);
                });
            }));
        });

        this.buttonList.push(new GuiButton(this.minecraft, "Add Server", this.width / 2 + 4, this.height - 52, 150, 20, () => {
            this.minecraft.displayScreen(new GuiDirectConnect(this, true));
        }));

        this.buttonList.push(new GuiButton(this.minecraft, "Cancel", this.width / 2 + 84, this.height - 28, 70, 20, () => {
            this.minecraft.displayScreen(this.previousScreen);
        }));
        this.buttonList.push(new GuiButton(this.minecraft, "Join Player", this.width / 2 + 4, this.height - 28, 70, 20, () => {
            this.minecraft.displayScreen(new GuiDirectConnect(this, false, true));
        }));

        this.buttonList.push(this.buttonSelect);
        this.buttonList.push(this.buttonRename);
        this.buttonList.push(this.buttonDelete); 
        
        this.buttonSelect.enabled = false;
        this.buttonRename.enabled = true;
        this.buttonDelete.enabled = false;
    }

    
    createServerSlot(data, index) {
        return new GuiServerSlot(
            data,
            this.width / 2 - 110,
            0,
            220,
            36,
            () => {
                this.worldSlotContainer.setSelected(index);
            },
            this.minecraft,
            () => this.joinServer(index)
        );
    }

    joinServer(index) {
        if (index < 0 || index >= this.worldSlotContainer.slotList.length) return;

        const world = this.worldSlotContainer.slotList[index];
        const worldDetails = world.worldDetails;
        const worldDate = world.worldDate.replaceAll(' ', '_').replaceAll('/', '_');

        let proxy = null;
        if (worldDetails && worldDetails.trim() !== '') {
            let proxyUrl = worldDetails.trim();
            if (proxyUrl.startsWith('Proxy: ')) {
                proxyUrl = proxyUrl.replace('Proxy: ', '').trim();
            }
            proxy = { url: `ws://${proxyUrl}` };
        } else {
            let address = worldDate.trim().toLowerCase();
            let isLocalhost = address === 'localhost' || address === '127.0.0.1' || address.startsWith('127.0.0.');
            let isAllowedHost = address === '10.0.0.213';

            if (!isLocalhost && !isAllowedHost) {
                proxy = { url: 'ws://174.169.230.116:6003' };
            }
        }

        this.minecraft.displayScreen(new GuiConnecting(this, worldDetails, undefined, proxy, world.worldProtocol));
    }

    drawScreen(stack, mouseX, mouseY, partialTicks) {
        this.worldSlotContainer.drawScreen(stack, mouseX, mouseY, partialTicks);
        this.drawCenteredString(stack, "Play Multiplayer", this.width / 2, 20);
        super.drawScreen(stack, mouseX, mouseY, partialTicks);
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseClicked(mouseX, mouseY, mouseButton);
        super.mouseClicked(mouseX, mouseY, mouseButton); 
    }

    mouseDragged(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseDragged(mouseX, mouseY, mouseButton);
        super.mouseDragged(mouseX, mouseY, mouseButton);
    }

    mouseReleased(mouseX, mouseY, mouseButton) {
        this.worldSlotContainer.mouseReleased(mouseX, mouseY, mouseButton);
        super.mouseReleased(mouseX, mouseY, mouseButton);
    }

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