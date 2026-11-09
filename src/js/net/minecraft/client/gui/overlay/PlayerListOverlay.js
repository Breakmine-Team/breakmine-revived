import Gui from "../Gui.js";
import FontRenderer from "../../render/gui/FontRenderer.js";
import * as AuthLib from "../../network/AuthLib.js";

export default class PlayerListOverlay extends Gui {

    constructor(minecraft, ingameOverlay) {
        super();

        this.minecraft = minecraft;
        this.window = minecraft.window;
        this.ingameOverlay = ingameOverlay;
        this.dirty = true;

        this.header = null;
        this.footer = null;

        this.headImages = new Map();
    }

    renderPlayerList(stack, width) {
        if (this.dirty) {
            let subStack = this.window.canvasPlayerList.getContext("2d");
            this.reinitialize(subStack, width);
        }

        stack.drawImage(this.window.canvasPlayerList, 0, 0);
    }

    reinitialize(stack, width) {
        this.dirty = false;

        if (!this.minecraft.playerController || !this.minecraft.playerController.getNetworkHandler) {
            return;
        }

        let playerInfoMap = this.minecraft.playerController.getNetworkHandler().getPlayerInfoMap();
        if (!playerInfoMap) {
            return;
        }

        let maxPlayerNameWidth = 0;
        let maxScoreValueWidth = 0; 
        const pingIconWidth = 10;

        for (let [uuid, playerInfo] of playerInfoMap) {
            if (!playerInfo || !playerInfo.profile) continue;
            let displayName = playerInfo.displayName === null ? playerInfo.profile.getUsername() : playerInfo.displayName;
            maxPlayerNameWidth = Math.max(maxPlayerNameWidth, this.getStringWidth(stack, displayName));
        }

        let maxScoreWidth = 0; 

        let screenWidth = this.window.width;
        let playerAmount = playerInfoMap.size;
        let rows = playerAmount;

        let columns;
        for (columns = 1; rows > 20; rows = Math.floor((playerAmount + columns - 1) / columns)) {
            columns++;
        }

        let isOnlineMode = true; 
        let columnWidth = Math.min(
            columns * ((isOnlineMode ? 9 : 0) + maxPlayerNameWidth + maxScoreWidth + pingIconWidth + 16),
            screenWidth - 50
        ) / columns;

        stack.clearRect(0, 0, this.window.width, this.window.height);

        let x = Math.floor(screenWidth / 2) - Math.floor((columnWidth * columns + (columns - 1) * 5) / 2);
        let y = 10;

        let backgroundWidth = columnWidth * columns + (columns - 1) * 5;

        

        this.drawRect(
            stack,
            Math.floor(screenWidth / 2) - Math.floor(backgroundWidth / 2) - 1,
            y - 1,
            Math.floor(screenWidth / 2) + Math.floor(backgroundWidth / 2) + 1,
            y + rows * FontRenderer.FONT_HEIGHT,
            'rgba(0,0,0,0.5)'
        );

        let i = 0;
        for (let [uuid, playerInfo] of playerInfoMap) {
            if (!playerInfo || !playerInfo.profile) {
                i++;
                continue;
            }

            let indexX = Math.floor(i / rows);
            let indexY = i % rows;

            let entryX = x + indexX * columnWidth + indexX * 5;
            let entryY = y + indexY * FontRenderer.FONT_HEIGHT;

            if (i < playerInfoMap.size) {
                let pingIconX = entryX + columnWidth - 1 - pingIconWidth;
                let displayName = playerInfo.displayName === null ? playerInfo.profile.getUsername() : playerInfo.displayName;

                this.drawRect(
                    stack,
                    entryX,
                    entryY,
                    entryX + columnWidth - 1,
                    entryY + (FontRenderer.FONT_HEIGHT - 1),
                    'rgba(255,255,255,0.13)'
                );

                if (isOnlineMode) {
                    let size = FontRenderer.FONT_HEIGHT - 1;

                    this.drawPlayerHead(
                        stack,
                        playerInfo.profile.getUsername(),
                        entryX,
                        entryY,
                        size
                    );

                    entryX += size + 1;
                }

                this.drawString(stack, displayName, entryX + 1.0, entryY - (FontRenderer.FONT_HEIGHT > 9 ? 0.5 : 0.0))

                let ping = this.getPing(playerInfo.ping);
                let spriteOffset = ping < 150 ? 0 : ping < 300 ? 1 : ping < 600 ? 2 : ping < 1000 ? 3 : 4;
                this.drawSprite(
                    stack,
                    this.ingameOverlay.textureCrosshair,
                    0,
                    16 + spriteOffset * 8,
                    10,
                    8,
                    pingIconX,
                    entryY + 1,
                    10,
                    8,
                    1.0
                );
            }

            i++;
        }

        
    }

    getPing(ping) {
        const value = Number(ping);
        return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
    }

    getHeadImage(username) {
        if (!username) return null;

        let entry = this.headImages.get(username);
        if (entry) {
            return entry.image;
        }

        entry = { image: null, failed: false };
        this.headImages.set(username, entry);

        try {
            const image = new Image();
            image.onload = () => {
                entry.image = image;
                this.setDirty();
            };
            image.onerror = () => {
                entry.failed = true;
            };
            AuthLib.getSkinImageUrl(username).then((url) => {
                if (entry.image) return;
                image.src = url;
            }).catch(() => {
                entry.failed = true;
            });
        } catch (e) {
            entry.failed = true;
        }

        return entry.image;
    }

    drawPlayerHead(stack, username, x, y, size) {
        const skin = this.getHeadImage(username);
        const fallback = this.minecraft.resources["char.png"];
        const image = skin && skin.complete && skin.naturalWidth > 0 && skin.naturalHeight > 0
            ? skin
            : fallback;

        stack.save();
        const headSize = image && image.complete
            ? 8 * Math.max(1, Math.floor((image.naturalWidth || 0) / 64))
            : 8;
        stack.imageSmoothingEnabled = headSize > 8;
        stack.imageSmoothingQuality = "high";
        stack.beginPath();
        stack.rect(x, y, size, size);
        stack.clip();

        if (image && image.complete && image.naturalWidth >= 16 && image.naturalHeight >= 16) {
            stack.drawImage(image, headSize, headSize, headSize, headSize, x, y, size, size);
        } else {
            stack.fillStyle = "rgb(0,0,0)";
            stack.fillRect(x, y, size, size);
        }

        stack.restore();
    }

    setDirty() {
        this.dirty = true;
    }

    setHeader(header) {
        this.header = header;
        this.headImages.clear();
        this.dirty = true;
    }

    setFooter(footer) {
        this.footer = footer;
    }
}