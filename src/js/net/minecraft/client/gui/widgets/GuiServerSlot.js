import GuiButton from "./GuiButton.js";
import GuiTooltip from "./GuiTooltip.js";
import IsomorphicWebSocket from "../../../util/IsomorphicWebSocket.js";

export default class GuiServerSlot extends GuiButton {

    worldName = "";
    worldDate = "";
    worldDetails = "";
    worldMotd = "";
    
    constructor(worldData, x, y, width, height, callback, minecraft) {
        super(minecraft, worldData.name, x, y, width, height, callback); 
        
        this.worldName = worldData.name ?? "Unknown Server";
        this.worldDate = worldData.date ?? "";
        this.worldDetails = worldData.details ?? "";
        this.worldMotd = worldData.motd ?? "";

        this.drawButton = () => {}; 
        
        // Ensure renderE is set to true
        this.renderE = true;
        this.pingMs = null; // measured ping in ms, null = not yet measured
        this.pingIcon = 5; // 0..5, 5 = unknown/unreachable by default (bottom/no ping)
        this.playerCount = null;
        this.maxPlayers = null;

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

        // Start an initial ping attempt
        try {
            this.startPing();
        } catch (e) {
            // ignore
        }
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (!this.renderE) return;
        
        const slotX = this.x;
        const slotY = this.y;
        
        const WHITE = 16777215;
        const GRAY = 8421504;
        
        // Match GuiWorldSlot's drawString calls exactly
        this.drawString(stack, this.worldName, slotX + 2, slotY + 1, WHITE, true, false);
        this.drawString(stack, '§7' + this.worldMotd, slotX + 2, slotY + 12, GRAY, true, false);
        this.drawString(stack, '§8' + this.worldDetails, slotX + 2, slotY + 22, GRAY, true, false);

        // Draw ping icon on the right side of the slot if texture available
        let pingIconBounds = null;
        try {
            const pingTexture = this.getTexture("gui/ping.png");
            if (pingTexture) {
                const iconW = 10;
                const iconH = 7;
                const gap = 1;
                const index = this.pingIcon === null || this.pingIcon === undefined
                    ? 5
                    : Math.max(0, Math.min(5, this.pingIcon));
                const spriteX = 0;
                const spriteY = index * (iconH + gap);
                const drawX = slotX + this.width - iconW - 2;
                const drawY = slotY;
                const padding = 5;
                pingIconBounds = { x: drawX - padding, y: drawY - padding, width: iconW + padding * 2, height: iconH + padding * 2 };

                // Draw at native size (do not scale)
                this.drawSprite(stack, pingTexture, spriteX, spriteY, iconW, iconH, drawX, drawY, iconW, iconH);
            }
        } catch (e) {
            // continue silently if no texture or draw fails
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
        if (this.isMouseOver(mouseX, mouseY)) {
            this.callback(); 
        }
    }

    startPing() {
        if (!this.worldDetails) return;

        let rawAddress = this.worldDetails.trim();
        let addresses = [];

        if (rawAddress.startsWith('ws://') || rawAddress.startsWith('wss://')) {
            addresses.push(rawAddress);
        } else {
            // Try wss first (public servers), then plain ws (e.g. local servers)
            addresses.push('wss://' + rawAddress);
            addresses.push('ws://' + rawAddress);
        }

        const tryPing = (url) => {
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
                cleanup();

                if (success) {
                    this.pingMs = elapsed ?? 0;
                    if (payload && typeof payload === 'object') {
                        if (typeof payload.players === 'number') this.playerCount = payload.players;
                        if (typeof payload.maxPlayers === 'number') this.maxPlayers = payload.maxPlayers;
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
        // Map ping ms to icon index (0 = best/full, 5 = worst/unreachable)
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
        if (this.pingMs === null || this.pingMs < 0) {
            return "(no connection)";
        }
        return `${Math.max(0, Math.round(this.pingMs))}ms`;
    }
}