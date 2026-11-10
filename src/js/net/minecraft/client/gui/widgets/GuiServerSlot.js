import GuiButton from "./GuiButton.js";
import GuiTooltip from "./GuiTooltip.js";
import IsomorphicWebSocket from "../../../util/IsomorphicWebSocket.js";

export default class GuiServerSlot extends GuiButton {

    worldName = "";
    worldDate = "";
    worldDetails = "";
    worldMotd = "";
    worldProtocol = "binary";

    static ICON_SIZE = 34;
    static ICON_X_OFFSET = 1;
    static ICON_Y_OFFSET = -1;
    static JOIN_SIZE = 32;

    static joinMaskCache = new WeakMap();

    constructor(worldData, x, y, width, height, callback, minecraft, joinCallback = null) {
        super(minecraft, worldData.name, x, y, width, height, callback);

        this.joinCallback = joinCallback;

        this.worldName = worldData.name ?? "Unknown Server";
        this.worldDate = worldData.date ?? "";
        this.worldDetails = worldData.details ?? "";
        this.worldMotd = worldData.motd ?? "";
        this.worldProtocol = worldData.protocol ?? "binary";
        this.serverIcon = worldData.icon ?? null; 

        this.drawButton = () => {};

        this.renderE = true;
        this.pingMs = null; 
        this.pingIcon = 5; 
        this.isPinging = false; 
        this.pingingStartedAt = 0; 
        this.playerCount = null;
        this.maxPlayers = null;
        this.iconImage = null; 

        if (typeof worldData.playerCount === 'number') {
            this.playerCount = worldData.playerCount;
        } else if (typeof worldData.players === 'number') {
            this.playerCount = worldData.players;
        }

        if (typeof worldData.maxPlayers === 'number') {
            this.maxPlayers = worldData.maxPlayers;
        } else if (typeof worldData.max === 'number') {
            this.maxPlayers = worldData.max;
        }

        const parsedPlayers = this.parsePlayerCountFromText(this.worldDetails);
        if (parsedPlayers !== null) {
            this.playerCount = parsedPlayers.current;
            this.maxPlayers = parsedPlayers.max;
        }

        if (this.serverIcon) {
            this.loadServerIcon();
        }

        if (!this.isJsonProtocol()) {
            try {
                this.startPing();
            } catch (e) {
            }
        }
    }

    isJsonProtocol() {
        return this.worldProtocol === "json";
    }

    loadServerIcon() {
        if (!this.serverIcon) return;

        const img = new Image();
        this.iconImage = img;

        if (this.serverIcon.startsWith('data:image')) {
            img.src = this.serverIcon;
        } else if (this.serverIcon.startsWith('http')) {
            img.src = this.serverIcon;
        } else {
            try {
                const iconTexture = this.getTexture(this.serverIcon);
                if (iconTexture) {
                    this.iconImage = iconTexture;
                }
            } catch (e) {
            }
            return;
        }

        img.onload = () => {
        };

        img.onerror = () => {
            this.iconImage = null;
        };
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;

        const slotX = this.x;
        const slotY = this.y;

        const WHITE = 16777215;
        const GRAY = 8421504;

        try {
            let iconTexture = this.iconImage;
            if (!iconTexture) {
                iconTexture = this.getTexture("gui/new_world.png");
            }

            const iconSize = GuiServerSlot.ICON_SIZE;
            const iconX = slotX + GuiServerSlot.ICON_X_OFFSET;
            const iconY = slotY + GuiServerSlot.ICON_Y_OFFSET;

            if (iconTexture) {
                if (this.iconImage && this.iconImage instanceof Image) {
                    stack.drawImage(iconTexture, iconX, iconY, iconSize, iconSize);
                } else {
                    this.drawSprite(stack, iconTexture, 0, 0, 256, 256, iconX, iconY, iconSize, iconSize);
                }
            }

            if (this.isMouseOver(mouseX, mouseY)) {
                const highlighted = this.isMouseOverJoinButton(mouseX, mouseY);
                const joinTexture = this.getTexture(highlighted ? "gui/join_highlighted.png" : "gui/join.png");
                if (joinTexture) {
                    const bounds = this.getJoinBounds();
                    stack.drawImage(joinTexture, bounds.x, bounds.y, bounds.size, bounds.size);
                }
            }
        } catch (e) {
        }

        this.drawString(stack, this.worldName, slotX + 38, slotY + 1, WHITE, true, false);
        this.drawString(stack, '§7' + this.worldMotd, slotX + 38, slotY + 12, GRAY, true, false);
        this.drawString(stack, '§8' + this.worldDetails, slotX + 38, slotY + 22, GRAY, true, false);

        let pingIconBounds = null;
        if (!this.isJsonProtocol()) {
            try {
                const iconW = 10;
                const iconH = 7;
                const gap = 1;
                const drawX = slotX + this.width - iconW - 2;
                const drawY = slotY;
                const padding = 5;
                pingIconBounds = { x: drawX - padding, y: drawY - padding, width: iconW + padding * 2, height: iconH + padding * 2 };

                if (this.isPinging) {
                    const step = Math.floor((performance.now() - this.pingingStartedAt) / 100) % 8;
                    const frame = step < 5 ? step + 1 : 9 - step;
                    const pingingTexture = this.getTexture(`gui/pinging_${frame}.png`);
                    if (pingingTexture) {
                        this.drawSprite(stack, pingingTexture, 0, 0, 10, 8, drawX, drawY - 1, 10, 8);
                    }
                } else {
                    const pingTexture = this.getTexture("gui/ping.png");
                    if (pingTexture) {
                        const index = this.pingIcon === null || this.pingIcon === undefined
                            ? 5
                            : Math.max(0, Math.min(5, this.pingIcon));
                        const spriteX = 0;
                        const spriteY = index * (iconH + gap);

                        this.drawSprite(stack, pingTexture, spriteX, spriteY, iconW, iconH, drawX, drawY, iconW, iconH);
                    }
                }
            } catch (e) {
            }
        }

        if (pingIconBounds && this.isMouseOverPingIcon(mouseX, mouseY, pingIconBounds)) {
            const pingTooltip = new GuiTooltip(this.minecraft, this.getPingTooltipText(), pingIconBounds.x, pingIconBounds.y, pingIconBounds.width, pingIconBounds.height);
            pingTooltip.render(stack, mouseX, mouseY, partialTicks);
        }

        const playersText = this.getPlayersText();
        if (playersText) {
            this.drawRightString(stack, playersText, slotX + this.width - 14, slotY, 0x808080, true);
        }
    }
    
    mouseClicked(mouseX, mouseY, mouseButton) {
        if (!this.isMouseOver(mouseX, mouseY)) return;

        this.callback();

        if (this.joinCallback && this.isMouseOverIcon(mouseX, mouseY)) {
            this.joinCallback();
        }
    }

    isMouseOverIcon(mouseX, mouseY) {
        const iconSize = GuiServerSlot.ICON_SIZE;
        const iconX = this.x + GuiServerSlot.ICON_X_OFFSET;
        const iconY = this.y + GuiServerSlot.ICON_Y_OFFSET;

        return mouseX >= iconX && mouseX < iconX + iconSize &&
            mouseY >= iconY && mouseY < iconY + iconSize;
    }

    
    getJoinBounds() {
        const size = GuiServerSlot.JOIN_SIZE;
        const offset = Math.floor((GuiServerSlot.ICON_SIZE - size) / 2);

        return {
            x: this.x + GuiServerSlot.ICON_X_OFFSET + offset,
            y: this.y + GuiServerSlot.ICON_Y_OFFSET + offset,
            size: size
        };
    }

    
    getJoinMask(texture) {
        if (!texture || !texture.width || !texture.height) return null;

        const cached = GuiServerSlot.joinMaskCache.get(texture);
        if (cached) return cached;

        try {
            const canvas = document.createElement('canvas');
            canvas.width = texture.width;
            canvas.height = texture.height;

            const context = canvas.getContext('2d', { willReadFrequently: true });
            context.drawImage(texture, 0, 0);

            const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
            const mask = {
                width: canvas.width,
                height: canvas.height,
                alpha: new Uint8Array(canvas.width * canvas.height)
            };

            for (let i = 0; i < mask.alpha.length; i++) {
                mask.alpha[i] = pixels[i * 4 + 3];
            }

            GuiServerSlot.joinMaskCache.set(texture, mask);
            return mask;
        } catch (e) {
            return null;
        }
    }

    
    isMouseOverJoinButton(mouseX, mouseY) {
        const bounds = this.getJoinBounds();

        if (mouseX < bounds.x || mouseX >= bounds.x + bounds.size ||
            mouseY < bounds.y || mouseY >= bounds.y + bounds.size) {
            return false;
        }

        const mask = this.getJoinMask(this.getTexture("gui/join.png"));
        if (!mask) return true;

        const texelX = Math.floor(((mouseX - bounds.x) / bounds.size) * mask.width);
        const texelY = Math.floor(((mouseY - bounds.y) / bounds.size) * mask.height);

        return mask.alpha[texelY * mask.width + texelX] > 8;
    }

    startPing() {
        if (!this.worldDetails || this.isJsonProtocol()) return;

        let rawAddress = this.worldDetails.trim();
        let addresses = [];

        if (rawAddress.startsWith('ws://') || rawAddress.startsWith('wss://')) {
            addresses.push(rawAddress);
        } else {
            addresses.push('wss://' + rawAddress);
            addresses.push('ws://' + rawAddress);
        }

        const tryPing = (url) => {
            this.isPinging = true;
            this.pingingStartedAt = performance.now();

            let settled = false;
            let pingSentAt = null;
            let ws = null;
            let timeoutId = null;

            const cleanup = () => {
                if (timeoutId) clearTimeout(timeoutId);
                if (ws) {
                    try {
                        ws.onopen = null;
                        ws.onmessage = null;
                        ws.onerror = null;
                        ws.onclose = null;
                        ws.close();
                    } catch (e) {}
                }
            };

            const finish = (success, elapsed = null, payload = null) => {
                if (settled) return;
                settled = true;
                this.isPinging = false;
                cleanup();

                if (success) {
                    this.pingMs = elapsed ?? 0;
                    if (payload && typeof payload === 'object') {
                        if (typeof payload.players === 'number') this.playerCount = payload.players;
                        if (typeof payload.maxPlayers === 'number') this.maxPlayers = payload.maxPlayers;
                        if (payload.icon && !this.serverIcon) {
                            this.serverIcon = payload.icon;
                            this.loadServerIcon();
                        }
                    }
                    this.pingIcon = this.computeIconIndex(this.pingMs);
                } else {
                    if (addresses.length > 0) {
                        tryPing(addresses.shift());
                    } else {
                        this.pingMs = -1;
                        this.pingIcon = 5;
                    }
                }
            };

            try {
                ws = new IsomorphicWebSocket(url);

                timeoutId = setTimeout(() => {
                    finish(false);
                }, 2000);

                ws.addEventListener('open', () => {
                    pingSentAt = Date.now();
                    try {
                        ws.send('ping');
                    } catch (e) {
                        finish(false);
                    }
                });

                ws.addEventListener('message', (event) => {
                    if (pingSentAt !== null) {
                        try {
                            const payload = typeof event.data === 'string' ? JSON.parse(event.data) : null;
                            finish(true, Date.now() - pingSentAt, payload);
                        } catch (e) {
                            finish(true, Date.now() - pingSentAt);
                        }
                    }
                });

                ws.addEventListener('error', () => finish(false));
                ws.addEventListener('close', () => finish(false));

            } catch (e) {
                finish(false);
            }
        };

        tryPing(addresses.shift());
    }

    computeIconIndex(pingMs) {
        if (pingMs === null) return 5;
        if (pingMs < 0) return 5;
        if (pingMs <= 50) return 0;
        if (pingMs <= 100) return 1;
        if (pingMs <= 200) return 2;
        if (pingMs <= 350) return 3;
        return 4;
    }

    parsePlayerCountFromText(text) {
        if (!text || typeof text !== 'string') return null;
        const match = text.match(/(\d+)\s*\/\s*(\d+)/);
        if (!match) return null;
        return {
            current: Number(match[1]),
            max: Number(match[2])
        };
    }

    getPlayersText() {
        if (this.playerCount === null && this.maxPlayers === null) return null;
        const current = this.playerCount ?? '?';
        const max = this.maxPlayers ?? '?';
        return `${current}/${max}`;
    }

    isMouseOverPingIcon(mouseX, mouseY, pingIconBounds) {
        if (!pingIconBounds) return false;
        return mouseX >= pingIconBounds.x && mouseX <= pingIconBounds.x + pingIconBounds.width &&
            mouseY >= pingIconBounds.y && mouseY <= pingIconBounds.y + pingIconBounds.height;
    }

    getPingTooltipText() {
        if (this.isPinging) {
            return "Pinging...";
        }
        if (this.pingMs === null || this.pingMs < 0) {
            return "(no connection)";
        }
        return `${Math.max(0, Math.round(this.pingMs))}ms`;
    }
}