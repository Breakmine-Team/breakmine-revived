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
    }

    render(stack, mouseX, mouseY, partialTicks) {
        // Hide all GUI elements when F1 toggle is active
        if (GuiFunctions.isGuiHidden()) {
            if (this.minecraft.settings.debugOverlay) {
                stack.drawImage(this.window.canvasDebug, 0, 0);
            }
            return;
        }

        // Destroy hotbar items in spectator so they don't linger in the 3D scene
        if (this.minecraft.player.spectator) {
            this.minecraft.itemRenderer.destroy("hotbar");
        }

        // Render crosshair
        if (this.minecraft.hasInGameFocus()) {
            this.renderCrosshair(stack, this.window.width / 2, this.window.height / 2)
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

        // Render hotbar (hidden in spectator)
        if (!this.minecraft.player.spectator) {
            this.renderHotbar(stack, this.window.width / 2 - 91, this.window.height - 22);
        }

        // Render health bar (hidden in creative and spectator)
        if (!this.minecraft.player.creative && !this.minecraft.player.spectator) {
            this.renderHealth(stack, this.window.width / 2 - 91, this.window.height - 22 - 11)
        }

        // Render chat canvas
        stack.drawImage(this.window.canvasChat, 0, 0);

        // Render debug canvas on stack
        if (this.minecraft.settings.debugOverlay) {
            stack.drawImage(this.window.canvasDebug, 0, 0);
        }

        // Render player list
        if (Keyboard.isKeyDown(this.minecraft.settings.keyPlayerList) && !this.minecraft.isSingleplayer()) {
            this.playerListOverlay.renderPlayerList(stack, this.window.width);
        }
    }

    onTick() {
        this.chatOverlay.onTick();

        // Render debug overlay on tick
        if (this.minecraft.settings.debugOverlay) {
            let stack = this.window.canvasDebug.getContext('2d');

            // Render debug overlay each tick if the player is moving
            if (this.ticksRendered % 10 === 0) {
                // Clear debug canvas
                stack.clearRect(0, 0, this.window.width, this.window.height);

                // Render debug information
                this.renderLeftDebugOverlay(stack);
                this.renderRightDebugOverlay(stack);
            } else if (this.minecraft.player.isMoving()) {
                // Render debug information
                this.renderLeftDebugOverlay(stack, [5, 6, 7, 8]);
            }

            this.ticksRendered++;
        }

        // Render chat on tick if dirty
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

    renderHotbar(stack, x, y) {
        // Render background
        this.drawSprite(stack, this.textureHotbar, 0, 0, 200, 22, x, y, 200, 22)
        this.drawSprite(
            stack,
            this.textureHotbar,
            0, 22,
            24, 24,
            x + this.minecraft.player.inventory.selectedSlotIndex * 20 - 1, y - 1,
            24, 24
        )

        // To make the items darker
        let brightness = this.minecraft.isPaused() ? 0.5 : 1; // TODO find a better solution

        this.minecraft.itemRenderer.prepareRender("hotbar");

        // Render items
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

        const x = this.window.width / 2 - 91;
        const y = this.window.height - 22;

        const canvas = this.window.canvasGuiItemCount;
        const countContext = canvas.getContext('2d');
        countContext.clearRect(0, 0, canvas.width, canvas.height);

        for (let i = 0; i < 9; i++) {
            let itemStack = this.minecraft.player.inventory.getItemInSlot(i);
            if (!itemStack.isEmpty() && itemStack.getCount() > 1) {
                const countText = itemStack.getCount().toString();
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
        }

        stack.drawImage(canvas, 0, 0);
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
            // "Biome: " + biome,
            "",
            "Sounds: " + soundsPlaying + "/" + soundsLoaded,
            "Time: " + world.time % 24000 + " (Day " + Math.floor(world.time / 24000) + ")",
            "Cursor: " + this.minecraft.window.focusState.getName(),
            "",
            "Seed: " + `${this.minecraft.isSingleplayer() ? world.getSeed() : "(not available in Multiplayer)"}`
        ];

        lines.push(...midLines, ...afterLines);

        // Hit result
        let hit = worldRenderer.lastHitResult;
        if (hit !== null && hit.type !== 0) {
            lines.push("Looking at: " + hit.x + " " + hit.y + " " + hit.z);
        }

        const lineHeight = FontRenderer.FONT_HEIGHT + 1;

        // Draw lines
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length === 0 || filters.length !== 0 && !filters.includes(i)) {
                continue;
            }

            // Clear the line
            if (filters.length !== 0) {
                stack.clearRect(
                    1,
                    1 + lineHeight * i,
                    this.getStringWidth(stack, lines[i]) + 1,
                    lineHeight
                );
            }

            // Draw background
            this.drawRect(stack,
                1,
                1 + lineHeight * i,
                1 + this.getStringWidth(stack, lines[i]) + 1,
                1 + lineHeight * i + lineHeight,
                '#50505090'
            );

            // Draw line
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

        // Draw lines
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].length === 0) {
                continue;
            }

            // Draw background
            this.drawRect(stack,
                this.window.width - this.getStringWidth(stack, lines[i]) - 3,
                1 + lineHeight * i,
                this.window.width - 1,
                1 + lineHeight * i + lineHeight,
                '#50505090'
            );

            // Draw line
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