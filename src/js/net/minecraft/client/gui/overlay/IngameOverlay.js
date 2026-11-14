import Gui from "../Gui.js";
import Block from "../../world/block/Block.js";
import ChatOverlay from "./ChatOverlay.js";
import Minecraft from "../../Minecraft.js";
import EnumBlockFace from "../../../util/EnumBlockFace.js";
import MathHelper from "../../../util/MathHelper.js";
import FontRenderer from "../../render/gui/FontRenderer.js";
import EnumSkyBlock from "../../../util/EnumSkyBlock.js";
import PlayerListOverlay from "./PlayerListOverlay.js";
import Keyboard from "../../../util/Keyboard.js";
import GuiFunctions from "../screens/GuiFunctions.js";

export default class IngameOverlay extends Gui {

    constructor(minecraft, window) {
        super();
        this.minecraft = minecraft;
        this.window = window;

        this.chatOverlay = new ChatOverlay(minecraft);
        this.playerListOverlay = new PlayerListOverlay(minecraft, this);

        this.textureCrosshair = minecraft.resources["gui/icons.png"];
        this.textureHotbar = minecraft.resources["gui/gui.png"];
        this.textureHeart = minecraft.resources['gui/heart.png'];
        this.textureHeartHalf = minecraft.resources['gui/heartHalf.png'];
        this.textureHeartEmpty = minecraft.resources['gui/heartEmpty.png'];

        this.ticksRendered = 0;

        this.lastSelectedSlot = -1;
        this.lastSelectedTypeId = 0;
        this.selectedItemName = "";
        this.selectedItemNameUntil = 0;

        this.statusText = "";
        this.statusTextUntil = 0;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        if (GuiFunctions.isGuiHidden()) {
            if (this.minecraft.settings.debugOverlay) {
                stack.drawImage(this.window.canvasDebug, 0, 0);
            }
            return;
        }

        if (this.minecraft.player.spectator) {
            this.minecraft.itemRenderer.destroy("hotbar");
        }

        if (this.minecraft.hasInGameFocus()) {
            this.renderCrosshair(stack, this.window.width / 2, this.window.height / 2)
            this.renderShaftRpm(stack, partialTicks);
        }

        let fps = Math.floor(this.minecraft.fps);
        if (this.minecraft.settings.showFps === true || this.minecraft.settings.showVersion === true) {
            if (this.minecraft.settings.showFps === true && this.minecraft.settings.showVersion === false) {
                this.drawString(stack, fps.toString() + " fps", 2, 2, 0xffffffff, true, false);
            } else if (this.minecraft.settings.showFps === false && this.minecraft.settings.showVersion === true) {
                this.drawString(stack, "Breakmine " + Minecraft.VERSION, 2, 2, 0xffffffff, true, false);
            } else {
                this.drawString(stack, "Breakmine " + Minecraft.VERSION, 2, 2, 0xffffffff, true, false);
                this.drawString(stack, fps.toString() + " fps", 2, 2 + FontRenderer.FONT_HEIGHT * 1, 0xffffffff, true, false);
            }
        }

        const cameraView = this.minecraft.cctvManager?.isViewing() === true;
        const mobileGuiItems = this.minecraft.window.mobileDevice
            && this.minecraft.currentScreen?.usesGuiItems?.() === true;

        if (mobileGuiItems) {
            this.minecraft.itemRenderer?.destroy("hotbar");
        }

        if (cameraView) {
            this.hideHudItemLayers();
        }

        if (!this.minecraft.player.spectator) {
            if (!cameraView && !mobileGuiItems) {
                this.renderHotbar(stack, this.window.width / 2 - 91, this.window.height - 22);
            }
            this.updateSelectedItemName();
            this.renderSelectedItemName(stack);
        }

        if (!this.minecraft.player.creative && !this.minecraft.player.spectator && !cameraView) {
            this.renderHealth(stack, this.window.width / 2 - 91, this.window.height - 22 - 11)
        }

        this.renderStatusText(stack);

        this.renderVoiceIndicator(stack);

        stack.drawImage(this.window.canvasChat, 0, 0);

        if (this.minecraft.settings.debugOverlay) {
            stack.drawImage(this.window.canvasDebug, 0, 0);
        }

        if (Keyboard.isKeyDown(this.minecraft.settings.keyPlayerList) && !this.minecraft.isSingleplayer()) {
            this.playerListOverlay.renderPlayerList(stack, this.window.width);
        }

        this.minecraft.modLoader?.emitOverlayText(this, stack);
    }

    
    renderVoiceIndicator(stack) {
        const voiceChat = this.minecraft.voiceChat;
        if (!voiceChat) return;

        const talkers = voiceChat.getTalkers();
        if (talkers.length === 0) return;

        const centerX = this.window.width / 2;
        const lineheight = 11;

        for (let i = 0; i < talkers.length; i++) {
            const name = talkers[i];
            const isLocal = i === 0 && voiceChat.talking;
            const text = isLocal ? name + " (you)" : name;

            const nameWidth = this.getStringWidth(stack, text);
            const boxWidth = nameWidth + 14;
            const y = this.window.height - 44 - i * lineheight;

            this.drawRect(stack, centerX - boxWidth / 2, y, centerX + boxWidth / 2, y + 10, '#000000', 0.5);
            this.drawRect(stack, centerX - boxWidth / 2 + 3, y + 2, centerX - boxWidth / 2 + 8, y + 8, '#00ff00', 0.5 + 0.5 * Math.abs(Math.sin(Date.now() / 100)));
            this.drawString(stack, text, centerX - boxWidth / 2 + 10, y + 1, 0xffffffff, true, false);
        }
    }

    onTick() {
        this.chatOverlay.onTick();

        if (this.minecraft.settings.debugOverlay) {
            let stack = this.window.canvasDebug.getContext('2d');

            if (this.ticksRendered % 10 === 0) {
                stack.clearRect(0, 0, this.window.width, this.window.height);

                this.renderLeftDebugOverlay(stack);
                this.renderRightDebugOverlay(stack);
            } else if (this.minecraft.player.isMoving()) {
                this.renderLeftDebugOverlay(stack, [5, 6, 7, 8]);
            }

            this.ticksRendered++;
        }

        if (this.chatOverlay.isDirty()) {
            let stack = this.window.canvasChat.getContext('2d');
            stack.clearRect(0, 0, this.window.width, this.window.height);
            this.chatOverlay.render(stack, 0, 0, 0);
        }
    }

    renderCrosshair(stack, x, y) {
        let size = 15;
        this.drawSprite(stack, this.textureCrosshair, 0, 0, 15, 15, x - size / 2, y - size / 2, size, size, 0.6);
    }

    
    renderShaftRpm(stack, partialTicks) {
        const world = this.minecraft.world;
        const player = this.minecraft.player;
        if (!world || !player) return;

        const hit = player.rayTrace(5, partialTicks);
        if (!hit) return;

        const field = (hit.fieldCell && world.offGridField) ? world.offGridField : null;
        const typeId = field ? field.getBlockAt(hit.x, hit.y, hit.z) : world.getBlockAt(hit.x, hit.y, hit.z);
        if (!typeId) return;

        const block = Block.getById(typeId);
        if (!block) return;

        let rpm = null;
        if (typeof block.getOutputRpm === 'function') {
            rpm = block.getOutputRpm(world.getBlockDataAt(hit.x, hit.y, hit.z));
        } else if (typeof block.getShaftRpm === 'function') {
            rpm = block.getShaftRpm(world, hit.x, hit.y, hit.z, world.ticks || 0);
        }

        if (rpm === null || !Number.isFinite(Number(rpm))) return;

        this.renderRpmTooltip(stack, `${Math.round(Number(rpm))} RPM`);
    }

    
    renderRpmTooltip(stack, text) {
        const padding = 2;
        const k = 8;
        const textWidth = this.getStringWidth(stack, text, true);

        const maxLeft = Math.max(2, this.window.width - (textWidth + padding * 2 + 6));
        const maxTop = Math.max(2, this.window.height - (k + padding * 2 + 6));
        const l1 = Math.max(2, Math.min(Math.floor(this.window.width / 2) + 12, maxLeft));
        const i2 = Math.max(2, Math.min(Math.floor(this.window.height / 2) - Math.floor(k / 2), maxTop));

        const bgColor = 'rgba(16, 0, 16, 0.941)';
        const borderStart = 'rgba(80, 0, 255, 0.50)';
        const borderEnd = 'rgba(40, 0, 127, 0.50)';

        const x1 = l1 - padding;
        const y1 = i2 - padding;
        const x2 = l1 + textWidth + padding;
        const y2 = i2 + k + padding;

        this.drawRect(stack, x1 - 1, y1 - 2, x2 + 1, y1 - 1, bgColor);
        this.drawRect(stack, x1 - 1, y2 + 1, x2 + 1, y2 + 2, bgColor);
        this.drawRect(stack, x1 - 1, y1 - 1, x2 + 1, y2 + 1, bgColor);
        this.drawRect(stack, x1 - 2, y1 - 1, x1 - 1, y2 + 1, bgColor);
        this.drawRect(stack, x2 + 1, y1 - 1, x2 + 2, y2 + 1, bgColor);

        this.drawGradientRect(stack, x1 - 1, y1, x1, y2, borderStart, borderEnd);
        this.drawGradientRect(stack, x2, y1, x2 + 1, y2, borderStart, borderEnd);
        this.drawGradientRect(stack, x1, y1 - 1, x2, y1, borderStart, borderStart);
        this.drawGradientRect(stack, x1, y2, x2, y2 + 1, borderEnd, borderEnd);

        this.drawString(stack, text, l1, i2, 0xFFFFFFFF, true, false);
    }

    renderHealth(stack, x, y) {
        const health = this.minecraft.player.health;
        const size = 11;
        const maxHearts = 10;
        const fullHearts = Math.floor(health / 2);
    
        for (let i = 0; i < maxHearts; i++) {
            this.drawSprite(stack, this.textureHeartEmpty, 0, 0, size, size, x + i * size, y, size, size);
        }
    
        for (let i = 0; i < fullHearts; i++) {
            this.drawSprite(stack, this.textureHeart, 0, 0, size, size, x + i * size, y, size, size);
        }
    
        const fractionalHealth = health % 1;
    
        if (fractionalHealth > 0 && fractionalHealth <= 0.5) {
            const halfHeartPosition = fullHearts;
            this.drawSprite(
                stack,
                this.textureHeartHalf,
                0,
                0,
                size,
                size,
                x + halfHeartPosition * size,
                y,
                size,
                size
            );
        }
    }

    updateSelectedItemName() {
        const inventory = this.minecraft.player.inventory;
        const slot = inventory.selectedSlotIndex;
        const itemStack = inventory.getItemInSlot(slot);
        const typeId = itemStack.isEmpty() ? 0 : itemStack.getType();

        if (slot === this.lastSelectedSlot && typeId === this.lastSelectedTypeId) {
            return;
        }

        const firstUpdate = this.lastSelectedSlot === -1;
        this.lastSelectedSlot = slot;
        this.lastSelectedTypeId = typeId;

        if (firstUpdate || typeId === 0) {
            this.selectedItemName = "";
            this.selectedItemNameUntil = 0;
            return;
        }

        const block = Block.getById(typeId);
        const description = block ? block.getDescription() : null;
        const name = description ? description.split(/\r?\n/)[0].trim() : "";
        if (!name) {
            this.selectedItemName = "";
            this.selectedItemNameUntil = 0;
            return;
        }

        this.selectedItemName = name;
        this.selectedItemNameUntil = performance.now() + 2000;
    }

    setStatusText(text, durationMs = 0) {
        const value = text === null || text === undefined ? "" : String(text).split(/\r?\n/)[0].trim();
        this.statusText = value;
        this.statusTextUntil = value && durationMs > 0 ? performance.now() + durationMs : 0;
    }

    clearStatusText() {
        this.setStatusText("");
    }

    getStatusText() {
        if (!this.statusText) {
            return "";
        }

        if (this.statusTextUntil !== 0 && performance.now() > this.statusTextUntil) {
            this.statusText = "";
            this.statusTextUntil = 0;
            return "";
        }

        return this.statusText;
    }

    renderStatusText(stack) {
        const text = this.getStatusText();
        if (!text) {
            return;
        }

        const textWidth = this.getStringWidth(stack, text, true);
        const x = Math.floor(this.window.width / 2 - textWidth / 2);

        this.drawString(stack, text, x, this.window.height - 44, 0xFFFFFFFF, true, false);
    }

    renderSelectedItemName(stack) {
        if (this.getStatusText()) {
            return;
        }

        if (!this.selectedItemName || performance.now() > this.selectedItemNameUntil) {
            return;
        }

        const nameWidth = this.getStringWidth(stack, this.selectedItemName, true);
        const x = Math.floor(this.window.width / 2 - nameWidth / 2);
        const healthVisible = !this.minecraft.player.creative && !this.minecraft.player.spectator;
        const y = this.window.height - (healthVisible ? 44 : 44);

        this.drawString(stack, this.selectedItemName, x, y, 0xFFFFFFFF, true, false);
    }

    hideHudItemLayers() {
        this.minecraft.itemRenderer?.destroy("hotbar");

        const canvas = this.window.canvasGuiItemCount;
        if (canvas && this.itemCountsDrawn) {
            canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
        }

        this.itemCountsDrawn = false;
        this.itemCountsFresh = false;
    }

    renderHotbar(stack, x, y) {
        this.drawSprite(stack, this.textureHotbar, 0, 0, 200, 22, x, y, 200, 22)
        this.drawSprite(
            stack,
            this.textureHotbar,
            0, 22,
            24, 24,
            x + this.minecraft.player.inventory.selectedSlotIndex * 20 - 1, y - 1,
            24, 24
        )

        let brightness = (this.minecraft.isPaused() || this.minecraft.currentScreen !== null) ? 0.5 : 1; 

        this.minecraft.itemRenderer.prepareRender("hotbar");

        for (let i = 0; i < 9; i++) {
            let itemStack = this.minecraft.player.inventory.getItemInSlot(i);
            if (!itemStack.isEmpty()) {
                let typeId = itemStack.getType();
                let block = Block.getById(typeId);
                if (block !== null) {
                    this.minecraft.itemRenderer.renderItemInGui("hotbar", i, block, Math.floor(x + i * 20 + 11), y + 11, brightness);
                }

            }
        }
    }

    renderPostItem(stack, mouseX, mouseY, partialTicks) {
        if (this.minecraft.player.spectator) return;
        if (GuiFunctions.isGuiHidden()) return;
        if (this.minecraft.cctvManager?.isViewing()) return;
        if (this.minecraft.window.mobileDevice
            && this.minecraft.currentScreen?.usesGuiItems?.() === true) {
            this.itemCountsDrawn = false;
            this.itemCountsFresh = false;
            return;
        }

        const x = this.window.width / 2 - 91;
        const y = this.window.height - 22;

        const canvas = this.window.canvasGuiItemCount;
        const countContext = canvas.getContext('2d');

        const counts = this.itemCounts || (this.itemCounts = new Int32Array(9));
        let changed = this.itemCountsFresh !== true
            || canvas.width !== this.itemCountsWidth
            || canvas.height !== this.itemCountsHeight;
        let hasCounts = false;

        for (let i = 0; i < 9; i++) {
            let itemStack = this.minecraft.player.inventory.getItemInSlot(i);
            let count = (!itemStack || itemStack.isEmpty() || itemStack.getCount() <= 1)
                ? 0
                : itemStack.getCount();

            if (count !== counts[i]) {
                counts[i] = count;
                changed = true;
            }
            if (count > 0) {
                hasCounts = true;
            }
        }

        if (changed) {
            countContext.clearRect(0, 0, canvas.width, canvas.height);

            for (let i = 0; i < 9; i++) {
                if (counts[i] === 0) continue;

                const countText = counts[i].toString();
                const countWidth = this.minecraft.fontRenderer.getStringWidth(stack, countText);
                this.minecraft.fontRenderer.drawString(
                    countContext,
                    countText,
                    Math.floor(x + i * 20 + (19 - countWidth)),
                    y + 11,
                    0xFFFFFF,
                    true
                );
            }

            this.itemCountsFresh = true;
            this.itemCountsWidth = canvas.width;
            this.itemCountsHeight = canvas.height;
            this.itemCountsDrawn = hasCounts;
        }

        if (this.itemCountsDrawn) {
            stack.drawImage(canvas, 0, 0);
        }
    }

    getOSInfo() {
        var userAgent = window.navigator.userAgent,
            platform = window.navigator.platform,
            macosPlatforms = ['Macintosh', 'MacIntel', 'MacPPC', 'Mac68K'],
            windowsPlatforms = ['Win32', 'Win64', 'Windows', 'WinCE'],
            iosPlatforms = ['iPhone', 'iPad', 'iPod'],
            os = null;

        if (/Tizen|SMART-TV|SmartTV/i.test(userAgent) && !/Mobile|Nexus|SM-/i.test(userAgent)) {
            os = 'Samsung Tizen (TV)';
        } else if (/webOS|Web0S/i.test(userAgent) && !/hp-tablet|TouchPad/i.test(userAgent)) {
            os = 'LG webOS (TV)';
        } else if (/Roku/i.test(userAgent)) {
            os = 'Roku OS';
        } else if (/AFTS|AFTB|AFTM|AFTT|AFTKA|FireTV/i.test(userAgent)) {
            os = 'Fire OS (Amazon)';
        } else if (/SmartCast/i.test(userAgent)) {
            os = 'Vizio SmartCast';
        } else if (/VIDAA/i.test(userAgent)) {
            os = 'VIDAA (Hisense)';
        } else if (/Viera/i.test(userAgent)) {
            os = 'Panasonic Viera';
        } else if (/NetCast/i.test(userAgent)) {
            os = 'LG NetCast';
        } else if (userAgent.includes('SmartOSS-OS')) {
            os = 'SmartOSS';
        } else if (/KaiOS|KAIOS/i.test(userAgent)) {
            os = 'KaiOS';
        } else if (/HarmonyOS/i.test(userAgent)) {
            os = 'HarmonyOS';
        } else if (iosPlatforms.indexOf(platform) !== -1 || /iPhone|iPad|iPod/i.test(userAgent)) {
            os = 'iOS';
        } else if (/Windows Phone|Windows Mobile|IEMobile|WPDesktop/i.test(userAgent)) {
            os = 'Windows Phone';
        } else if (/BlackBerry|BB10|PlayBook/i.test(userAgent)) {
            os = 'BlackBerry OS';
        } else if (/Symbian|SymbianOS|Series60|S60/i.test(userAgent)) {
            os = 'Symbian OS';
        } else if (/Sailfish/i.test(userAgent)) {
            os = 'Sailfish OS';
        } else if (/webOS|hp-tablet|TouchPad|PalmOS|PalmSource/i.test(userAgent)) {
            os = 'Palm / webOS Mobile';
        } else if (/Tizen/i.test(userAgent)) {
            os = 'Tizen Mobile';
        } else if (/Android/.test(userAgent)) {
            if (/GoogleTV|Android TV|Large Screen/i.test(userAgent)) {
                os = 'Android TV';
            } else {
                os = 'Android';
            }
        } else if (userAgent.includes('CrOS')) {
            os = 'Chrome OS/Linux';
        } else if (macosPlatforms.indexOf(platform) !== -1 || /Mac OS X|Macintosh/i.test(userAgent)) {
            os = 'Mac OS';
        } else if (windowsPlatforms.indexOf(platform) !== -1 || /Windows NT/i.test(userAgent)) {
            os = 'Windows';
        } else if (/FreeBSD/i.test(userAgent) || /FreeBSD/i.test(platform)) {
            os = 'FreeBSD';
        } else if (/OpenBSD/i.test(userAgent) || /OpenBSD/i.test(platform)) {
            os = 'OpenBSD';
        } else if (/NetBSD/i.test(userAgent) || /NetBSD/i.test(platform)) {
            os = 'NetBSD';
        } else if (/SunOS|Solaris/i.test(userAgent) || /SunOS/i.test(platform)) {
            os = 'Solaris / SunOS';
        } else if (/Haiku/i.test(userAgent) || /Haiku/i.test(platform)) {
            os = 'Haiku OS';
        } else if (/AmigaOS/i.test(userAgent) || /Amiga/i.test(platform)) {
            os = 'AmigaOS';
        } else if (!os && (/Linux/i.test(platform) || /Linux/i.test(userAgent))) {
            os = 'Linux';
        }

        return os;
    }

    renderLeftDebugOverlay(stack, filters = []) {
        let world = this.minecraft.world;
        let player = this.minecraft.player;
        let worldRenderer = this.minecraft.worldRenderer;

        let x = player.x;
        let y = player.y;
        let z = player.z;

        let yaw = MathHelper.wrapAngleTo180(player.rotationYaw);
        let pitch = player.rotationPitch;

        let facingIndex = (((yaw + 180) * 4.0 / 360.0) + 0.5) & 3;
        let facing = EnumBlockFace.values()[facingIndex + 2];

        let fixedX = x.toFixed(2);
        let fixedY = y.toFixed(2);
        let fixedZ = z.toFixed(2);

        let blockX = Math.floor(x);
        let blockY = Math.floor(y);
        let blockZ = Math.floor(z);

        let chunkX = blockX >> 4;
        let chunkY = blockY >> 4;
        let chunkZ = blockZ >> 4;

        let inChunkX = blockX & 0xF;
        let inChunkY = blockY & 0xF;
        let inChunkZ = blockZ & 0xF;

        let visibleChunks = 0;
        let loadedChunks = 0;
        for (let [index, chunk] of world.getChunkProvider().getChunks()) {
            for (let y in chunk.sections) {
                let chunkSection = chunk.sections[y];
                if (chunkSection.group.visible) {
                    visibleChunks++;
                }
                loadedChunks++;
            }
        }
        let visibleEntities = 0;
        for (let index in world.entities) {
            let entity = world.entities[index];
            if (entity.renderer.group.visible) {
                visibleEntities++;
            }
        }

        let fps = Math.floor(this.minecraft.fps);
        let viewDistance = this.minecraft.settings.viewDistance;
        let lightUpdates = world.lightUpdateQueue.length;
        let chunkUpdates = worldRenderer.chunkSectionUpdateQueue.length;
        let entities = world.entities.length;
        let particles = this.minecraft.particleRenderer.particles.length;
        let skyLight = world.getSavedLightValue(EnumSkyBlock.SKY, blockX, blockY, blockZ);
        let blockLight = world.getSavedLightValue(EnumSkyBlock.BLOCK, blockX, blockY, blockZ);
        let lightLevel = world.getTotalLightAt(blockX, blockY, blockZ);
        let biome = "T: " + world.getTemperature(blockX, blockY, blockZ) + " H: " + world.getHumidity(blockX, blockY, blockZ);

        let soundsLoaded = 0;
        let soundsPlaying = 0;
        let soundPool = this.minecraft.soundManager.soundPool;
        for (let [id, sounds] of Object.entries(soundPool)) {
            for (let sound of sounds) {
                soundsLoaded++;

                if (sound.isPlaying) {
                    soundsPlaying++;
                }
            }
        }

        let towards = "Towards " + (facing.isPositive() ? "positive" : "negative") + " " + (facing.isXAxis() ? "X" : "Z");

        let lines = [
            "Breakmine " + Minecraft.VERSION + ", updated at " + Minecraft.TIMESTAMP,
            fps + " fps (" + chunkUpdates + " chunk updates) T: " + this.minecraft.maxFps,
            "C: " + visibleChunks + "/" + loadedChunks + " D: " + viewDistance + ", L: " + lightUpdates,
            "E: " + visibleEntities + "/" + entities + ", P: " + particles,
            ""
        ];

        let midLines = [];

        if (false) {
            midLines = [
                "Intergrated Server @ 20TPS",
                ""
            ];
        }

        let afterLines = [
            "XYZ: " + fixedX + " / " + fixedY + " / " + fixedZ,
            "Block: " + blockX + " " + blockY + " " + blockZ,
            "Chunk: " + chunkX + " " + chunkY + " " + chunkZ + " in " + inChunkX + " " + inChunkY + " " + inChunkZ,
            "Facing: " + facing.getName() + " (" + towards + ") (" + yaw.toFixed(1) + " / " + pitch.toFixed(1) + ")",
            "Light: " + lightLevel + " (" + skyLight + " sky, " + blockLight + " block)",
            "",
            "Sounds: " + soundsPlaying + "/" + soundsLoaded,
            "Time: " + world.time % 24000 + " (Day " + Math.floor(world.time / 24000) + ")",
            "Cursor: " + this.minecraft.window.focusState.getName(),
            "",
            "Seed: " + `${this.minecraft.getLocalSeed() ?? "(not available in Multiplayer)"}`
        ];

        lines.push(...midLines, ...afterLines);

        let hit = worldRenderer.lastHitResult;
        if (hit !== null && hit.type !== 0) {
            lines.push("Looking at: " + hit.x + " " + hit.y + " " + hit.z);
        }

        const lineHeight = FontRenderer.FONT_HEIGHT + 1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length === 0 || filters.length !== 0 && !filters.includes(i)) {
                continue;
            }

            if (filters.length !== 0) {
                stack.clearRect(
                    1,
                    1 + lineHeight * i,
                    this.getStringWidth(stack, lines[i]) + 1,
                    lineHeight
                );
            }

            this.drawRect(stack,
                1,
                1 + lineHeight * i,
                1 + this.getStringWidth(stack, lines[i]) + 1,
                1 + lineHeight * i + lineHeight,
                '#50505090'
            );

            this.drawString(stack, lines[i], 2, 2 + lineHeight * i, 0xffe0e0e0, false);
        }

    }

    renderRightDebugOverlay(stack) {
        let memoryLimit = this.minecraft.window.getMemoryLimit();
        let memoryUsed = this.minecraft.window.getMemoryUsed();
        let memoryAllocated = this.minecraft.window.getMemoryAllocated();

        let usedPercentage = Math.floor(memoryUsed / memoryLimit * 100);
        let allocatedPercentage = Math.floor(memoryAllocated / memoryLimit * 100);

        let width = this.window.canvas.width;
        let height = this.window.canvas.height;

        let lines = [
            "Mem: " + usedPercentage + "% " + this.humanFileSize(memoryUsed, memoryLimit),
            "Allocated: " + allocatedPercentage + "% " + this.humanFileSize(null, memoryAllocated),
            "",
            "Display: " + width + "x" + height,
            this.window.getGPUName()
        ];

        const lineHeight = FontRenderer.FONT_HEIGHT + 1;

        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length === 0) {
                continue;
            }

            this.drawRect(stack,
                this.window.width - this.getStringWidth(stack, lines[i]) - 3,
                1 + lineHeight * i,
                this.window.width - 1,
                1 + lineHeight * i + lineHeight,
                '#50505090'
            );

            this.drawRightString(stack, lines[i], this.window.width - 2, 2 + lineHeight * i, 0xffe0e0e0, false);
        }
    }

    humanFileSize(bytesUsed, bytesMax) {
        if (Math.abs(bytesMax) < 1000) {
            return (bytesUsed === null ? "" : bytesUsed + "/") + bytesMax + "B";
        }
        const units = ['kB', 'MB'];
        let u = -1;
        const r = 10;
        const thresh = 1000;

        do {
            if (bytesUsed !== null) {
                bytesUsed /= thresh;
            }
            bytesMax /= thresh;
            ++u;
        } while (Math.round(Math.abs(bytesMax) * r) / r >= thresh && u < units.length - 1);
        return (bytesUsed === null ? "" : bytesUsed.toFixed(0) + "/") + bytesMax.toFixed(0) + units[u];
    }
}