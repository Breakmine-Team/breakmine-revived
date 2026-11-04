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
import { summarizeVanillaWorldgenError } from '../../world/generator/VanillaWorldgenStatus.js';
import { halfHeartState } from '../../../../../../../packages/vanilla-gameplay/hud.mjs';

export default class IngameOverlay extends Gui {

    constructor(minecraft, window) {
        super();
        this.minecraft = minecraft;
        this.window = window;

        this.chatOverlay = new ChatOverlay(minecraft);
        this.playerListOverlay = new PlayerListOverlay(minecraft, this);

        // This pack's legacy icons.png changes the crosshair as well as HUD
        // icons. Keep the game's existing crosshair while using the pack's HUD.
        this.textureCrosshair = minecraft.resources["gui/crosshair-icons.png"];
        this.textureHotbar = minecraft.resources["gui/gui.png"];
        this.textureHeart = minecraft.resources['gui/heart.png'];
        this.textureHeartHalf = minecraft.resources['gui/heartHalf.png'];
        this.textureHeartEmpty = minecraft.resources['gui/heartEmpty.png'];
        const hudNames = [
            'heart/container', 'heart/container_blinking', 'heart/container_hardcore', 'heart/container_hardcore_blinking',
            'heart/full', 'heart/half', 'heart/full_blinking', 'heart/half_blinking',
            'heart/hardcore_full', 'heart/hardcore_half', 'heart/hardcore_full_blinking', 'heart/hardcore_half_blinking',
            'heart/poisoned_full', 'heart/poisoned_half', 'heart/poisoned_full_blinking', 'heart/poisoned_half_blinking',
            'heart/poisoned_hardcore_full', 'heart/poisoned_hardcore_half',
            'heart/withered_full', 'heart/withered_half', 'heart/withered_full_blinking', 'heart/withered_half_blinking',
            'heart/withered_hardcore_full', 'heart/withered_hardcore_half',
            'food_empty', 'food_empty_hunger', 'food_full', 'food_full_hunger', 'food_half', 'food_half_hunger',
            'armor_empty', 'armor_full', 'armor_half', 'air', 'air_bursting',
            'experience_bar_background', 'experience_bar_progress',
            'hotbar', 'hotbar_selection', 'hotbar_offhand_left', 'hotbar_offhand_right'
        ];
        this.nativeHud = Object.fromEntries(hudNames.map(name => {
            const path = name.startsWith('heart/') ? `gui/sprites/hud/${name}.png` : `gui/sprites/hud/${name}.png`;
            return [name, minecraft.resources[path]];
        }));
        this.lastHealth = this.displayHealth = 20;
        this.healthBlinkUntil = 0;
        this.healthChangedAt = 0;
        this.hudTickCount = 0;
        this.attackIndicatorTextures = {
            crosshairBackground: minecraft.resources['gui/sprites/hud/crosshair_attack_indicator_background.png'],
            crosshairFull: minecraft.resources['gui/sprites/hud/crosshair_attack_indicator_full.png'],
            crosshairProgress: minecraft.resources['gui/sprites/hud/crosshair_attack_indicator_progress.png'],
            hotbarBackground: minecraft.resources['gui/sprites/hud/hotbar_attack_indicator_background.png'],
            hotbarProgress: minecraft.resources['gui/sprites/hud/hotbar_attack_indicator_progress.png']
        };

        this.ticksRendered = 0;
    }

    render(stack, mouseX, mouseY, partialTicks) {
        this.renderWaterEffect(stack);
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
        if (this.minecraft.world?.vanillaPreview) {
            const error = this.minecraft.world.vanillaPreviewError;
            if (error) {
                let message = `Terrain issue: ${summarizeVanillaWorldgenError(error)} — details in console`;
                const maxWidth = this.window.width - 16;
                while (message.length > 24 && this.getStringWidth(stack, message) > maxWidth) message = `${message.slice(0, -5).trimEnd()}…`;
                this.drawRect(stack, 0, this.window.height - 31, this.window.width, this.window.height - 12, '#160d12', 0.72);
                this.drawCenteredString(stack, message, this.window.width / 2, this.window.height - 26, 0xffff7777);
            }
        }

        // Render crosshair
        if (this.minecraft.hasInGameFocus()) {
            const crosshairX = this.window.width / 2;
            const crosshairY = this.window.height / 2;
            this.renderCrosshair(stack, crosshairX, crosshairY);
            this.renderAttackIndicator(stack, crosshairX, crosshairY);
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

        if (!this.minecraft.player.creative && !this.minecraft.player.spectator) this.renderExperience(stack);

        // Render health bar (hidden in creative and spectator)
        if (!this.minecraft.player.creative && !this.minecraft.player.spectator) {
            this.renderHealth(stack, this.window.width / 2 - 91, this.window.height - 39);
            this.renderFood(stack, this.window.width / 2 + 91, this.window.height - 39);
            this.renderArmor(stack, this.window.width / 2 - 91, this.window.height - 49);
            this.renderAir(stack, this.window.width / 2 + 91, this.window.height - 49);
        }
        const hit = this.minecraft.lastCombatHit;
        if (hit && performance.now() < hit.expires) this.drawCenteredString(stack,
            `${hit.critical ? '§6Critical! ' : hit.sweep ? '§7Sweep ' : ''}§f${Number(hit.damage.toFixed(2))} damage`,
            this.window.width / 2, this.window.height / 2 + 28, 0xffffff);

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
        this.hudTickCount++;
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

    renderWaterEffect(stack) {
        const player = this.minecraft.player;
        const texture = this.minecraft.resources['misc/underwater.png'];
        if (!texture || player.spectator || this.minecraft.settings.thirdPersonView !== 0 || !player.isHeadInWater()) return;
        // ScreenEffectRenderer / LevelExtractor: four UV repeats, eye light,
        // alpha .1, yaw/64 and pitch/64 offsets. Cache tiny tinted patterns.
        const light = Math.max(0, Math.min(255, Math.floor(player.getEntityBrightness() * 255)));
        this.waterPatterns ??= new Map();
        let pattern = this.waterPatterns.get(light);
        if (!pattern) {
            pattern = stack.createPattern(Gui.colorize(texture, light / 255, light / 255, light / 255), 'repeat');
            this.waterPatterns.set(light, pattern);
        }
        const width = this.window.width, height = this.window.height;
        const u = -player.rotationYaw / 64, v = player.rotationPitch / 64;
        stack.save();
        stack.globalAlpha = 25 / 255;
        stack.scale(width / (4 * texture.width), height / (4 * texture.height));
        stack.translate(-u * texture.width, -v * texture.height);
        stack.fillStyle = pattern;
        stack.fillRect(u * texture.width, v * texture.height, texture.width * 4, texture.height * 4);
        stack.restore();
    }

    renderCrosshair(stack, x, y) {
        let size = 15;
        this.drawSprite(stack, this.textureCrosshair, 0, 0, 15, 15, x - size / 2, y - size / 2, size, size, 0.6);
    }

    renderAttackIndicator(stack, x, y) {
        const mode = this.minecraft.settings.attackIndicator || 'crosshair';
        if (mode === 'off') return;

        const charge = this.minecraft.player.getAttackStrengthScale(this.minecraft.timer.partialTicks);
        if (mode === 'hotbar') {
            if (charge >= 1) return;

            const size = 18;
            const top = this.window.height - 20;
            // Vanilla places the hotbar attack indicator on the side opposite
            // the player's main hand. The game currently uses right main hand.
            const left = Math.floor(this.window.width / 2 + 91 + 6);
            const progressHeight = Math.max(0, Math.min(size, Math.floor(charge * 19)));
            this.drawSprite(stack, this.attackIndicatorTextures.hotbarBackground, 0, 0, size, size, left, top, size, size);
            if (progressHeight > 0) {
                this.drawSprite(
                    stack,
                    this.attackIndicatorTextures.hotbarProgress,
                    0,
                    size - progressHeight,
                    size,
                    progressHeight,
                    left,
                    top + size - progressHeight,
                    size,
                    progressHeight
                );
            }
            return;
        }

        const left = Math.floor(x - 8);
        const top = Math.floor(y + 9);
        if (charge >= 1) {
            const target = this.minecraft.rayTraceEntity(5, this.minecraft.timer.partialTicks);
            if (target && target.health > 0 && this.minecraft.player.getCurrentItemAttackStrengthDelay() > 5) {
                this.drawSprite(stack, this.attackIndicatorTextures.crosshairFull, 0, 0, 16, 16, left, top, 16, 16);
            }
            return;
        }

        const progressWidth = Math.min(16, Math.floor(charge * 17));
        this.drawSprite(stack, this.attackIndicatorTextures.crosshairBackground, 0, 0, 16, 4, left, top, 16, 4);
        if (progressWidth > 0) {
            this.drawSprite(stack, this.attackIndicatorTextures.crosshairProgress, 0, 0, progressWidth, 4, left, top, progressWidth, 4);
        }
    }

    renderHealth(stack, x, y) {
        const health = Math.ceil(Math.max(0, Math.min(20, this.minecraft.player.health)));
        const now = performance.now(), tick = this.hudTickCount;
        if (health !== this.lastHealth) {
            if (this.minecraft.player.hurtTime > 0) this.healthBlinkUntil = tick + (health < this.lastHealth ? 20 : 10);
            this.healthChangedAt = now;
        }
        if (now - this.healthChangedAt > 1000) this.displayHealth = health;
        this.lastHealth = health;
        const blink = this.healthBlinkUntil > tick && Math.floor((this.healthBlinkUntil - tick) / 3) % 2 === 1;
        const hardcore = !!this.minecraft.player.hardcore;
        const effects = this.minecraft.player.statusEffects;
        const heartEffect = effects?.has('poison') ? 'poisoned' : effects?.has('wither') ? 'withered' : '';
        const heartPath = name => `heart/${name}`;
        const container = heartPath(hardcore ? 'container_hardcore' : 'container');
        let randomSeed = Math.imul(tick, 312871);
        const nextInt = bound => {
            randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) | 0;
            return (randomSeed >>> 0) % bound;
        };
        for (let i = 9; i >= 0; i--) {
            const top = y + (health <= 4 ? nextInt(2) : 0);
            this.drawHudSprite(stack, blink ? `${container}_blinking` : container, x + i * 8, top);
            const previous = halfHeartState(this.displayHealth, i), current = halfHeartState(health, i);
            const variant = `${heartEffect ? `${heartEffect}_` : ''}${hardcore ? 'hardcore_' : ''}`;
            if (blink && previous) this.drawHudSprite(stack, `heart/${variant}${previous}_blinking`, x + i * 8, top);
            if (current) this.drawHudSprite(stack, `heart/${variant}${current}`, x + i * 8, top);
        }
    }

    drawHudSprite(stack, name, x, y) {
        const image = this.nativeHud[name];
        if (image) this.drawSprite(stack, image, 0, 0, image.width, image.height, x, y, 9, 9);
    }

    renderFood(stack, right, y) {
        const food = this.minecraft.player.foodData;
        if (!food) return;
        let randomSeed = Math.imul(this.hudTickCount, 312871);
        const nextInt = bound => {
            randomSeed = (Math.imul(randomSeed, 1664525) + 1013904223) | 0;
            return (randomSeed >>> 0) % bound;
        };
        for (let i = 0; i < 10; i++) {
            let yOffset = 0;
            if ((food.saturationLevel ?? 0) <= 0 && this.hudTickCount % (food.foodLevel * 3 + 1) === 0) {
                yOffset = nextInt(3) - 1;
            }
            const x = right - i * 8 - 9;
            const hungry = this.minecraft.player.statusEffects?.has('hunger');
            this.drawHudSprite(stack, hungry ? 'food_empty_hunger' : 'food_empty', x, y + yOffset);
            const icon = halfHeartState(food.foodLevel, i);
            if (icon) this.drawHudSprite(stack, `food_${icon}${hungry ? '_hunger' : ''}`, x, y + yOffset);
        }
    }

    renderArmor(stack, x, y) {
        const armor = Math.max(0, Math.min(20, Number(this.minecraft.player.armor) || 0));
        if (armor <= 0) return;
        for (let i = 0; i < 10; i++) {
            this.drawHudSprite(stack, 'armor_empty', x + i * 8, y);
            const icon = halfHeartState(armor, i);
            if (icon) this.drawHudSprite(stack, `armor_${icon}`, x + i * 8, y);
        }
    }

    renderAir(stack, right, y) {
        const player = this.minecraft.player;
        if (!player.isHeadInWater?.() && player.airSupply >= player.maxAirSupply) return;
        const max = Math.max(1, Number(player.maxAirSupply) || 300);
        const air = Math.max(0, Math.min(max, Number(player.airSupply) || 0));
        const bubbles = Math.ceil(air / (max / 10));
        for (let i = 0; i < 10; i++) {
            const x = right - i * 8 - 9;
            this.drawHudSprite(stack, i < bubbles ? 'air' : 'air_bursting', x, y);
        }
    }

    renderExperience(stack) {
        const player = this.minecraft.player;
        const left = Math.floor(this.window.width / 2 - 91);
        // reference ContextualBar.top(): guiHeight - 24 - barHeight(5).
        const top = this.window.height - 29;
        const background = this.nativeHud.experience_bar_background;
        const progress = this.nativeHud.experience_bar_progress;
        this.drawSprite(stack, background, 0, 0, 182, 5, left, top, 182, 5);
        const width = Math.max(0, Math.min(182, Math.floor((player.experienceProgress ?? 0) * 182)));
        if (width > 0) this.drawSprite(stack, progress, 0, 0, width, 5, left, top, width, 5);
        if ((player.experienceLevel ?? 0) > 0) {
            const level = `${Math.floor(player.experienceLevel)}`;
            const center = this.window.width / 2;
            // reference level label baseline: guiHeight - 24 - 9 - 2.
            const y = top - 6;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                this.drawCenteredString(stack, level, center + dx, y + dy, 0xff202020);
            }
            this.drawCenteredString(stack, level, center, y, 0xff80ff20);
        }
    }

    renderHotbar(stack, x, y) {
        // Render background
        this.drawSprite(stack, this.nativeHud.hotbar, 0, 0, 182, 22, x, y, 182, 22);
        const offhand = this.minecraft.player.inventory.getItemInSlot(40);
        const offhandFrame = this.nativeHud.hotbar_offhand_left;
        if (offhand && !offhand.isEmpty()) {
            this.drawSprite(stack, offhandFrame, 0, 0, offhandFrame.width, offhandFrame.height,
                this.window.width / 2 - 120, y - 1, 29, 24);
        }
        this.drawSprite(
            stack, this.nativeHud.hotbar_selection,
            0, 0,
            24, 23,
            x + this.minecraft.player.inventory.selectedSlotIndex * 20 - 1, y - 1,
            24, 23
        )

        // To make the items darker
        let brightness = this.minecraft.isPaused() ? 0.5 : 1; // TODO find a better solution

        this.minecraft.itemRenderer.prepareRender("hotbar");
        this.minecraft.itemRenderer.prepareRender('offhand');

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
        if (offhand && !offhand.isEmpty()) {
            const block = Block.getById(offhand.getType());
            if (block) this.minecraft.itemRenderer.renderItemInGui('offhand', 0, block,
                Math.floor(this.window.width / 2 - 109), y + 11, brightness);
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
            const item = itemStack.isEmpty() ? null : Block.getById(itemStack.getType());
            const maxDamage = Number(item?.durability);
            if (maxDamage > 0 && itemStack.damage > 0) {
                const remaining = Math.max(0, 1 - itemStack.damage / maxDamage);
                const barX = Math.floor(x + i * 20 + 3);
                const barY = y + 19;
                countContext.fillStyle = '#000000';
                countContext.fillRect(barX, barY, 13, 2);
                countContext.fillStyle = `hsl(${Math.round(remaining * 120)}, 100%, 50%)`;
                countContext.fillRect(barX, barY, Math.round(remaining * 13), 1);
            }
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
        const offhand = this.minecraft.player.inventory.getItemInSlot(40);
        if (offhand && !offhand.isEmpty() && offhand.getCount() > 1) {
            const countText = offhand.getCount().toString();
            const countWidth = this.minecraft.fontRenderer.getStringWidth(stack, countText);
            this.minecraft.fontRenderer.drawString(countContext, countText,
                Math.floor(this.window.width / 2 - 117 + (19 - countWidth)), y + 11, 0xFFFFFF, true);
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

        let visibleSections = 0;
        let loadedSections = 0;
        for (let [index, chunk] of world.getChunkProvider().getChunks()) {
            for (let y in chunk.sections) {
                let chunkSection = chunk.sections[y];
                if (chunkSection.group.visible) {
                    visibleSections++;
                }
                loadedSections++;
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
        const provider = world.getChunkProvider();
        const stream = world.vanillithPlayable ? provider.streamingSnapshot?.() : null;
        const nativeChunk = world.nativeChunks?.getChunk(chunkX, chunkZ);
        const quartY = nativeChunk ? Math.max(0, Math.min((nativeChunk.height >> 2) - 1, Math.floor((blockY - nativeChunk.minY) / 4))) : 0;
        const biomeId = nativeChunk?.biomes[quartY * 16 + ((inChunkZ >> 2) * 4) + (inChunkX >> 2)];
        const velocity = Math.hypot(player.motionX, player.motionY, player.motionZ) * 20;
        const target = worldRenderer.lastHitResult;
        const targetState = target?.type !== 0 && target ? world.nativeChunks?.getBlockState(target.x, target.y, target.z) : undefined;

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
            "Sections: " + visibleSections + "/" + loadedSections + " D: " + viewDistance + ", L: " + lightUpdates,
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
            "Velocity: " + velocity.toFixed(2) + " blocks/s" + (player.onGround ? " (grounded)" : " (airborne)"),
            "Light: " + lightLevel + " (" + skyLight + " sky, " + blockLight + " block)",
            "Biome: " + (biomeId === undefined ? "unloaded" : `native #${biomeId}`) + ` | ${biome}`,
            "Chunk state: " + (nativeChunk ? (provider.isCollisionChunkReady?.(chunkX, chunkZ) ? "FULL / collision-ready" : "terrain available") : "not loaded"),
            ...(stream ? [
                `Streaming: ${stream.active} active / ${stream.desired} desired | decoration ${stream.decorationDesired} | background ${stream.backgroundCompleted}`,
                `Queues: terrain ${stream.terrainInFlight} / decoration ${stream.generationInFlight} / publish ${stream.publicationQueue} / mesh ${stream.meshQueue}`
            ] : []),
            "",
            "Sounds: " + soundsPlaying + "/" + soundsLoaded,
            "Time: " + world.time % 24000 + " (Day " + Math.floor(world.time / 24000) + ")",
            "Cursor: " + this.minecraft.window.focusState.getName(),
            "",
            "Seed: " + `${this.minecraft.isSingleplayer() ? world.getSeed() : "(not available in Multiplayer)"}`
        ];

        lines.push(...midLines, ...afterLines);

        // Hit result
        if (target !== null && target.type !== 0) {
            lines.push("Target: " + target.x + " " + target.y + " " + target.z + (targetState === undefined ? " (unloaded)" : ` | native state ${targetState}`));
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
