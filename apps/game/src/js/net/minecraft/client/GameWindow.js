import Minecraft from "./Minecraft.js";
import FocusStateType from "../util/FocusStateType.js";
import GuiIngameMenu from "./gui/screens/GuiIngameMenu.js";
import Keyboard from "../util/Keyboard.js";
import GuiLoadingScreen from "./gui/screens/GuiLoadingScreen.js";

export default class GameWindow {

    constructor(minecraft, canvasWrapperId) {
        this.minecraft = minecraft;

        this.width = 0;
        this.height = 0;

        this.mouseX = 0;
        this.mouseY = 0;

        this.mouseMotionX = 0;
        this.mouseMotionY = 0;

        this.mouseInsideWindow = false;
        this.mouseButtons = [false, false, false];

        this.mouseDownInterval = null;
        this.focusState = FocusStateType.EXITED;
        this.lastIngameSwitchTime = 0;

        this.mobileTextInput = null;
        this.mobileTextWidget = null;
        this.mobileTextSuppressed = false;

        this.mobileDevice = this.detectTouchDevice();

        // Initialize canvas elements
        this.initializeElements(canvasWrapperId);

        // Register listeners
        if (this.mobileDevice) {
            this.registerMobileListeners();
        } else {
            this.registerDesktopListeners();
        }

        // Create keyboard
        Keyboard.create();

        // TV mode: auto-lock focus and enable keyboard immediately
        if (this.minecraft.settings.tvmode) {
            this.mouseInsideWindow = true;
            Keyboard.setEnabled(true);
            this.updateFocusState(FocusStateType.LOCKED);
        }
    }

    initializeElements(canvasWrapperId) {
        // Get canvas wrapper
        this.wrapper = document.getElementById(canvasWrapperId);

        // Remove all children of wrapper
        while (this.wrapper.firstChild) {
            this.wrapper.removeChild(this.wrapper.firstChild);
        }

        // Create render layers
        this.canvasWorld = document.createElement('canvas');
        this.canvasDebug = document.createElement('canvas');
        this.canvasChat = document.createElement('canvas');
        this.canvasPlayerList = document.createElement('canvas');
        this.canvasItems = document.createElement('canvas');
        this.canvasGuiItemCount = document.createElement('canvas');

        // Create canvas renderer
        this.canvas = document.createElement('canvas');
        this.wrapper.appendChild(this.canvas);
    }

    registerDesktopListeners() {
        this.registerListener(window, 'resize', event => {
            this.updateWindowSize();
        });
        this.registerListener(document, 'mousedown', event => {
            // Handle mouse click on screen first
            let currentScreen = this.minecraft.currentScreen;
            if (currentScreen !== null) {
                currentScreen.mouseClicked(
                    event.x / this.scaleFactor,
                    event.y / this.scaleFactor,
                    event.button
                );
            } else {
                // In-Game mouse click (only when no GUI is open)
                this.minecraft.onMouseClicked(event.button);

                this.mouseButtons[event.button] = true;

                // Start interval to repeat the mouse event
                if (this.mouseDownInterval !== null) {
                    clearInterval(this.mouseDownInterval);
                }
                this.mouseDownInterval = setInterval(_ => this.minecraft.onMouseClicked(event.button), 250);
            }

            // Fix cursor lock state
            this.requestCursorUpdate();

            // Request lock on click
            if (this.minecraft.currentScreen === null && this.focusState === FocusStateType.EXITED) {
                this.updateFocusState(FocusStateType.REQUEST_LOCK);
            }

            this.initialSoundEngine();
        });
        this.registerListener(document, 'mousemove', event => {
            this.mouseX = event.clientX / this.scaleFactor;
            this.mouseY = event.clientY / this.scaleFactor;

            this.mouseMotionX += event.movementX;
            this.mouseMotionY += -event.movementY;

            // Handle mouse move on screen
            let currentScreen = this.minecraft.currentScreen;
            if (currentScreen !== null) {
                currentScreen.mouseDragged(event.x / this.scaleFactor, event.y / this.scaleFactor, event.button);
            }

            this.requestCursorUpdate();
        });
        this.registerListener(document, 'mouseup', event => {
            // Handle mouse release on screen
            let currentScreen = this.minecraft.currentScreen;
            if (currentScreen !== null) {
                currentScreen.mouseReleased(
                    event.x / this.scaleFactor,
                    event.y / this.scaleFactor,
                    event.button
                );
            }

            this.mouseButtons[event.button] = false;

            if (this.mouseDownInterval !== null) {
                clearInterval(this.mouseDownInterval);
            }
        });
        this.registerListener(document, 'pointerlockchange', event => {
            // Skip pointer lock handling in TV mode or on touch devices
            if (this.minecraft.settings.tvmode || this.mobileDevice) {
                return;
            }

            let intentState = this.focusState.getIntent();
            let isCursorLocked = this.isCursorLockedToCanvas();
            let isLockIntent = intentState === FocusStateType.LOCKED;

            let lastSwitchDuration = Date.now() - this.lastIngameSwitchTime;
            if (this.focusState === FocusStateType.LOCKED && !isCursorLocked && lastSwitchDuration < 200) {
                this.focusState = FocusStateType.REQUEST_LOCK;
            } else {
                if (intentState === null) {
                    this.updateFocusState(isCursorLocked ? FocusStateType.LOCKED : FocusStateType.EXITED);
                } else if (isCursorLocked === isLockIntent) {
                    this.updateFocusState(intentState);
                }
            }
        });
        this.registerListener(this.wrapper, 'mouseover', event => {
            Keyboard.setEnabled(true);
            this.mouseInsideWindow = true;
            this.requestCursorUpdate();
        });
        this.registerListener(this.wrapper, 'mouseleave', event => {
            Keyboard.setEnabled(false);
            this.mouseInsideWindow = false;
            this.requestCursorUpdate();
        });
        this.registerListener(document, 'mouseout', event => {
            this.requestCursorUpdate();
        });
        this.registerListener(document, 'mouseenter', event => {
            this.requestCursorUpdate();
        });
        this.registerListener(window, 'keydown', event => {
            if (event.key !== 'F11') {
                event.preventDefault();
            }
            else {
                this.updateWindowSize();
            }

            if (!this.mouseInsideWindow && !this.minecraft.settings.tvmode) {
                return;
            }

            if (event.key === 'Escape' && this.minecraft.currentScreen === null) {
                this.updateFocusState(FocusStateType.REQUEST_EXIT);
                return;
            }

            let currentScreen = this.minecraft.currentScreen;
            let payload = { key: event.code, char: event.key, type: 'keydown', screen: currentScreen !== null, cancelled: false };
            globalThis.Mixin?.emitCancellable('game:keypress', payload);

            if (!payload.cancelled) {
                if (currentScreen !== null) {
                    currentScreen.keyTyped(event.code, event.key);
                } else {
                    this.minecraft.onKeyPressed(event.code);
                }
            }

            this.requestCursorUpdate();
        }, false);
        this.registerListener(window, 'keyup', event => {
            let currentScreen = this.minecraft.currentScreen;
            let payload = { key: event.code, char: event.key, type: 'keyup', screen: currentScreen !== null, cancelled: false };
            globalThis.Mixin?.emitCancellable('game:keypress', payload);

            if (!payload.cancelled && currentScreen !== null) {
                currentScreen.keyReleased(event.code);
            }
        });
        this.registerListener(document, 'contextmenu');
        this.registerListener(this.wrapper, 'wheel', event => {
            event.stopPropagation();
            let delta = Math.sign(event.deltaY);
            
            // Handle scroll on current screen if open
            let currentScreen = this.minecraft.currentScreen;
            if (currentScreen !== null) {
                currentScreen.onScroll(event.x / this.scaleFactor, event.y / this.scaleFactor, delta);
            } else {
                this.minecraft.onMouseScroll(delta);
            }
        });
    }

    registerMobileListeners() {
        this.mouseInsideWindow = true;
        Keyboard.setEnabled(true);

        this.registerListener(window, 'resize', () => {
            this.updateWindowSize();
        });

        // 1. Inject Styles
        if (!document.getElementById('mobile-controls-styles')) {
            const style = document.createElement('style');
            style.id = 'mobile-controls-styles';
            style.textContent = `
                #mobile-controls-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100vw;
                    height: 100vh;
                    pointer-events: none;
                    user-select: none;
                    -webkit-user-select: none;
                    touch-action: none;
                    font-family: sans-serif;
                    z-index: 9999;
                }
                .mobile-btn {
                    pointer-events: auto;
                    background: rgba(0, 0, 0, 0.5);
                    color: rgba(255, 255, 255, 0.7);
                    border: none;
                    padding: 0;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    touch-action: none;
                }
                .mobile-btn svg {
                    width: 20px;
                    height: 20px;
                    fill: currentColor;
                }
                .mobile-btn:active {
                    background: transparent;
                    color: #fff;
                }
                .joystick-zone {
                    position: absolute;
                    bottom: 45px;
                    width: 130px;
                    height: 130px;
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 50%;
                    pointer-events: auto;
                    touch-action: none;
                }
                #joystick-move-zone { left: 30px; }

                .joystick-knob {
                    position: absolute;
                    top: 50%;
                    left: 50%;
                    width: 45px;
                    height: 45px;
                    background: rgba(255, 255, 255, 0.3);
                    border-radius: 50%;
                    transform: translate(-50%, -50%);
                    pointer-events: none;
                }

                #mbtn-prev {
                    position: absolute;
                    bottom: 45px;
                    left: 170px;
                }
                #mbtn-next {
                    position: absolute;
                    bottom: 45px;
                    right: 170px;
                }
                .arrow-btn {
                    width: 42px;
                    height: 42px;
                }

                .texture-btn {
                    position: absolute;
                    width: 48px;
                    height: 48px;
                    pointer-events: auto;
                    touch-action: none;
                    border: none;
                    padding: 0;
                    background: none;
                    background-size: contain;
                    background-repeat: no-repeat;
                    background-position: center;
                    image-rendering: pixelated;
                    cursor: pointer;
                    z-index: 10;
                }
                #mbtn-shift { right: 3.5vw; top: 39.70vh; }
                #mbtn-space { right: 3.5vw; top: 52.11vh; }
                #mbtn-e { right: 3.5vw; top: 27.30vh; }

                #mobile-fullscreen {
                    position: fixed;
                    top: 15px;
                    left: 15px;
                    width: 42px;
                    height: 42px;
                    z-index: 10000;
                }

                #mobile-gui-close {
                    position: fixed;
                    top: 15px;
                    right: 15px;
                    width: 42px;
                    height: 42px;
                    z-index: 10000;
                    display: none;
                }

            `;
            document.head.appendChild(style);
        }

        // 2. Inject Fullscreen Button
        let fsBtn = document.getElementById('mobile-fullscreen');
        if (!fsBtn) {
            fsBtn = document.createElement('button');
            fsBtn.id = 'mobile-fullscreen';
            fsBtn.className = 'mobile-btn';
            fsBtn.innerHTML = `
                <svg viewBox="0 0 24 24"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>
            `;
            document.body.appendChild(fsBtn);
        }

        // 3. Inject Overlay & GUI Close Elements with SVG Icons
        let overlay = document.getElementById('mobile-controls-overlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'mobile-controls-overlay';
            overlay.innerHTML = `
                <div id="joystick-move-zone" class="joystick-zone">
                    <div id="joystick-move-knob" class="joystick-knob"></div>
                </div>
                <button class="mobile-btn arrow-btn" id="mbtn-prev">
                    <svg viewBox="0 0 24 24"><path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>
                </button>

                <button class="mobile-btn arrow-btn" id="mbtn-next">
                    <svg viewBox="0 0 24 24"><path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/></svg>
                </button>

                <button class="texture-btn" id="mbtn-shift"></button>
                <button class="texture-btn" id="mbtn-space"></button>
                <button class="texture-btn" id="mbtn-e"></button>
            `;
            document.body.appendChild(overlay);
        }

        let guiCloseBtn = document.getElementById('mobile-gui-close');
        if (!guiCloseBtn) {
            guiCloseBtn = document.createElement('button');
            guiCloseBtn.id = 'mobile-gui-close';
            guiCloseBtn.className = 'mobile-btn';
            guiCloseBtn.innerHTML = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>`;
            document.body.appendChild(guiCloseBtn);
        }

        this.mobileOverlay = overlay;
        this.guiCloseBtn = guiCloseBtn;

        // Fullscreen Button Handler
        fsBtn.addEventListener('touchstart', e => {
            e.preventDefault();
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen().catch(() => {});
            } else {
                document.exitFullscreen().catch(() => {});
            }
            this.updateWindowSize();
        }, { passive: false });

        // Close GUI Button Handler
        guiCloseBtn.addEventListener('touchstart', e => {
            e.preventDefault();
            let currentScreen = this.minecraft.currentScreen;
            if (currentScreen !== null) {
                currentScreen.keyTyped("Escape", "Escape");
            }
        }, { passive: false });

        // Texture Buttons Setup
        const textureBtns = [
            { id: 'mbtn-shift', normal: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA4UlEQVR4AeyUSw6EIBBEe+Z2bj2CW+/kEdhyC8KeY7BgOZMiwTAGQsMoxgST0rb51LNMeNPN1w4wz/Onp8J3ewAYL8tCvbSuK8ETEB4AhVKKjDFd5JyDpdcO4N9uuD0XQEpJQf8E15QAjGPT43s8VqqrAXJmuf6pACWT0ngKhp0Ad3PuvADDAqjdtGY+CyDQXvFkAUzTRLFSIPE46tScVI8FkFp4Vm8AjARGAiOBkUBTAjjrj2o9mpsAWs1S6wbATwLWWuqh+Fd4ACHES2tNupO2bSN4AsQDoEDjCuX2hCf0BQAA//9rZTcnAAAABklEQVQDALBXlVClvjJqAAAAAElFTkSuQmCC', hover: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA80lEQVR4AeyUMQoCMRBFR69l5QFsFhsvoEewtPYInsBGcgStrKxsxMpCBCu1sBEb5Q9k0bBxJwNmCWThL5tsZv7L3yVtavgqAYqieMWU3TcDwLgzGFMs9YYTgicgGAAP++2GnrdTFF3vD1iySgAeNXBLE2C1mJErbXhpJqDdbVVdTiAnkBPICaSRgOTcl6xJ9yTs9kdV8N65kPXif0DaVLrO0osBUFDXvO49ergKAkCxz8Q3j5pfCgZAM9fMHWONVCoANIepFcZaqQG0hm5dBvhK4HA8Uwx9fgYGMMa0LrslxdJ6PiV4AoQB8ICJf8jXE57QGwAA//9zXGhDAAAABklEQVQDAEcglVDvsWKhAAAAAElFTkSuQmCC' },
            { id: 'mbtn-space', normal: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA4UlEQVR4AeyUSw6EIBBEe+Z2bj2CW+/kEdhyC8KeY7BgOZMiwTAGQsMoxgST0rb51LNMeNPN1w4wz/Onp8J3ewAYL8tCvbSuK8ETEB4AhVKKjDFd5JyDpdcO4N9uuD0XQEpJQf8E15QAjGPT43s8VqqrAXJmuf6pACWT0ngKhp0Ad3PuvADDAqjdtGY+CyDQXvFkAUzTRLFSIPE46tScVI8FkFp4Vm8AjARGAiOBkUBTAjjrj2o9mpsAWs1S6wbATwLWWuqh+Fd4ACHES2tNupO2bSN4AsQDoEDjCuX2hCf0BQAA//9rZTcnAAAABklEQVQDALBXlVClvjJqAAAAAElFTkSuQmCC', hover: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAA90lEQVR4AeyUPwrCMBTGn17LyQO4BBcvoEdwdPYInsBFcgSdnJxcxMlBBCd1cBEX5QukxJKQl9imFFL42teXP9+vXyFdavgqAIQQn5TS360AYNwbTSmVBuMZwRMQCgDFcb+j9+OSRPfnC5ZKBYB6a+DWXoDNakFa/wQXlQCMTdPyuznmq4MBXGaufqUAPhPfuA2GnQB3c+48DcMCCN00ZD4LQNPW8WQB9IcTMmUDMcdR2+bYeiwA28KqehkgJ5ATyAnkBKISwFlfVuzRHAUQa2ZblwF+Ejidr5RC5q9QAFLKzu2wplTaLucET4AoABRo1CHXnvCEvgAAAP//+LFDzgAAAAZJREFUAwAS/JVQl/FRZQAAAABJRU5ErkJggg==' },
            { id: 'mbtn-e', normal: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABeElEQVR4AeyUO46DMBBAZ7fOEdKkS5k+cABajkDLbTgILSegRZRIFHRcgXJXD2kihzVgHMI2ifTi8W/mYRJ/yz9/HgJxHP8ciT73KEDh2+0mSZIcQpqmQk0kRgECyLJM2ra1whz4zpv7hmGg3MiTwDhy8JezQBRFAkVRCKgnMTAHOu7aOgu4Jty6brMATwld1wkQw9bCun6zgG7cq/UWaJpG4FURqwBHC5qcGLS/1vKjhLV1zFsFmDiKj4D1BC6XiwDvEYjBfC2n00nAHNP4er0KaH+ptQosbdh7zirAUwMXDBCDWfx8PguYY2VZCvR9L0AM5pppbBWYLnpn3yrAuwUtTAzap+USAuJXsAr4Jrzf72JjKZ9VIAxDAd1IDNrfs7UK7FlgLddHwPsE+FfA2hGvzXsLrCV2nfcW4BYE10Jz67wF5hJuHf8jwJ3vArcguKydrjElnwSCIJAjqKrq4TAK5Hn+Vde11AdCTSxGAQIG3sFcTmrCLwAAAP//ofn5cAAAAAZJREFUAwBMvr9QoFa8cgAAAABJRU5ErkJggg==', hover: 'iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAABj0lEQVR4AeyUvUrEQBCAR+t0VkLANoidaGMhWoiNFsHmsNdHsBKfQ3wAG0mvhWItFoJIHkBipRY2YqN8gTn24ibZ7OX2mgt87OzfzJfN3c7LlJ+hQJqmvyHR9y4FKLywvC0bg5Mg7B2dCTWRKAUI4PriVH4+X60wB77z5r6Pr2/RZ0RAB0O2zgJbB8cCd1fnAipJDMyBjru2zgKuCbuu6yzAW8Lb870AMXQtrOs7C+jGvlpvgTzPBcYVsQpwtKDJiUH7bS0/Smhbx7xVgIlQzASsJ7C4sinAdwRiMD9LFEUC5pjGSZIIaL+ptQo0beh7zirAWwMXDBCDWTyOYwFz7PHmUqAoCgFiMNdUY6tAddEk+1YBvi1oYWLQPi2XEBCPg1XAN+HqzkBsNOWzCqztHgroRmLQfp+tVaDPAm25ZgLeJ8C/AtqOuG3eW6Atseu8twC3ILgWqlvnLVCXsOv4PwHufBe4BcFlbXWNKTkisLS+LyHInx6GDqVAlmVz7y+3EhJqYlEKEDAwCepyUhP+AAAA//86Mu/QAAAABklEQVQDADdFv1Cl+QfeAAAAAElFTkSuQmCC' },
        ];

        for (const btn of textureBtns) {
            const el = document.getElementById(btn.id);
            if (!el) continue;
            const normalUrl = 'data:image/png;base64,' + btn.normal;
            const hoverUrl = 'data:image/png;base64,' + btn.hover;

            const setNormal = () => el.style.backgroundImage = 'url(' + normalUrl + ')';
            const setHover = () => el.style.backgroundImage = 'url(' + hoverUrl + ')';

            setNormal();

            el.addEventListener('touchstart', setHover, { passive: true });
            el.addEventListener('touchend', setNormal, { passive: true });
            el.addEventListener('touchcancel', setNormal, { passive: true });
            el.addEventListener('mousedown', setHover, { passive: true });
            el.addEventListener('mouseup', setNormal, { passive: true });
            el.addEventListener('mouseleave', setNormal, { passive: true });
        }

        // 3. Setup Joysticks Logic
        const setupJoystick = (zoneId, knobId, onMove, onRelease) => {
            const zone = document.getElementById(zoneId);
            const knob = document.getElementById(knobId);
            let activeTouchId = null;
            const maxRadius = 45;

            const handleMove = (clientX, clientY) => {
                const rect = zone.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;

                let deltaX = clientX - centerX;
                let deltaY = clientY - centerY;
                const distance = Math.hypot(deltaX, deltaY);

                if (distance > maxRadius) {
                    deltaX = (deltaX / distance) * maxRadius;
                    deltaY = (deltaY / distance) * maxRadius;
                }

                knob.style.transform = `translate(calc(-50% + ${deltaX}px), calc(-50% + ${deltaY}px))`;
                onMove(deltaX / maxRadius, deltaY / maxRadius);
            };

            const reset = () => {
                activeTouchId = null;
                knob.style.transform = 'translate(-50%, -50%)';
                onRelease();
            };

            zone.addEventListener('touchstart', e => {
                e.preventDefault();
                if (activeTouchId !== null) return;
                const touch = e.changedTouches[0];
                activeTouchId = touch.identifier;
                handleMove(touch.clientX, touch.clientY);
            }, { passive: false });

            window.addEventListener('touchmove', e => {
                if (activeTouchId === null) return;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === activeTouchId) {
                        handleMove(e.changedTouches[i].clientX, e.changedTouches[i].clientY);
                        break;
                    }
                }
            }, { passive: false });

            window.addEventListener('touchend', e => {
                if (activeTouchId === null) return;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    if (e.changedTouches[i].identifier === activeTouchId) {
                        reset();
                        break;
                    }
                }
            }, { passive: false });
        };

        // Left Joystick -> Movement (WASD)
        setupJoystick('joystick-move-zone', 'joystick-move-knob', (normX, normY) => {
            const threshold = 0.3;
            Keyboard.setState("KeyW", normY < -threshold);
            Keyboard.setState("KeyS", normY > threshold);
            Keyboard.setState("KeyA", normX < -threshold);
            Keyboard.setState("KeyD", normX > threshold);
        }, () => {
            Keyboard.setState("KeyW", false);
            Keyboard.setState("KeyS", false);
            Keyboard.setState("KeyA", false);
            Keyboard.setState("KeyD", false);
        });

        // Mobile State Update Loop
        setInterval(() => {
            this.updateMobileUIState();
        }, 16);

        // 4. Camera Drag + Place/Break System + GUI Pass-Through
        let activeTouch = null;
        let breakTimeout = null;

        this.registerListener(window, 'touchstart', event => {
            this.initialSoundEngine();

            if (this.minecraft.currentScreen !== null) {
                this.mobileTextSuppressed = false;
                for (let i = 0; i < event.changedTouches.length; i++) {
                    let touch = event.changedTouches[i];
                    if (touch.target.closest('#mobile-gui-close, #mobile-fullscreen')) continue;

                    this.mouseX = touch.clientX / this.scaleFactor;
                    this.mouseY = touch.clientY / this.scaleFactor;

                    // Drop focus from all text widgets first; the tapped widget
                    // (if any) will re-focus via mouseClicked below
                    const buttons = this.minecraft.currentScreen.buttonList;
                    for (let b = 0; b < buttons.length; b++) {
                        const btn = buttons[b];
                        if (btn && typeof btn.isFocused === 'boolean' && typeof btn.setFocused === 'function') {
                            btn.setFocused(false);
                        }
                    }

                    this.minecraft.currentScreen.mouseClicked(
                        this.mouseX,
                        this.mouseY,
                        0
                    );
                }
                this.syncMobileTextInput();
                return;
            }

            for (let i = 0; i < event.changedTouches.length; i++) {
                let touch = event.changedTouches[i];
                if (touch.target.closest('#mobile-controls-overlay, #mobile-gui-close, #mobile-fullscreen')) continue;

                if (activeTouch === null) {
                    activeTouch = {
                        id: touch.identifier,
                        startX: touch.clientX,
                        startY: touch.clientY,
                        lastX: touch.clientX,
                        lastY: touch.clientY,
                        startTime: Date.now(),
                        isBreaking: false,
                        isDragging: false
                    };

                    // Single break action after holding still for a moment (no repeat)
                    breakTimeout = setTimeout(() => {
                        if (activeTouch && !activeTouch.isDragging) {
                            activeTouch.isBreaking = true;
                            this.minecraft.onMouseClicked(0);
                        }
                    }, 300);
                }
            }
        }, false);

        this.registerListener(window, 'touchmove', event => {
            if (this.minecraft.currentScreen !== null) {
                for (let i = 0; i < event.changedTouches.length; i++) {
                    let touch = event.changedTouches[i];
                    this.mouseX = touch.clientX / this.scaleFactor;
                    this.mouseY = touch.clientY / this.scaleFactor;
                    this.minecraft.currentScreen.mouseDragged(
                        this.mouseX,
                        this.mouseY,
                        0
                    );
                }
                return;
            }

            for (let i = 0; i < event.changedTouches.length; i++) {
                let touch = event.changedTouches[i];
                if (activeTouch && touch.identifier === activeTouch.id) {
                    let dx = touch.clientX - activeTouch.lastX;
                    let dy = touch.clientY - activeTouch.lastY;
                    activeTouch.lastX = touch.clientX;
                    activeTouch.lastY = touch.clientY;

                    let totalDist = Math.hypot(touch.clientX - activeTouch.startX, touch.clientY - activeTouch.startY);
                    if (totalDist > 15) {
                        if (!activeTouch.isDragging) {
                            activeTouch.isDragging = true;
                            clearTimeout(breakTimeout);
                        }
                        this.mouseMotionX += dx * 3.2;
                        this.mouseMotionY += -dy * 3.2;
                    }
                }
            }
        }, false);

        this.registerListener(window, 'touchend', event => {
            if (this.minecraft.currentScreen !== null) {
                for (let i = 0; i < event.changedTouches.length; i++) {
                    let touch = event.changedTouches[i];
                    this.minecraft.currentScreen.mouseReleased(
                        touch.clientX / this.scaleFactor,
                        touch.clientY / this.scaleFactor,
                        0
                    );
                }
                return;
            }

            for (let i = 0; i < event.changedTouches.length; i++) {
                let touch = event.changedTouches[i];
                if (activeTouch && touch.identifier === activeTouch.id) {
                    clearTimeout(breakTimeout);
                    this.mouseButtons[0] = false;
                    if (!activeTouch.isDragging && !activeTouch.isBreaking && (Date.now() - activeTouch.startTime) < 300) {
                        this.minecraft.onMouseClicked(2);
                    }

                    activeTouch = null;
                }
            }
        }, false);

        // 5. Action Buttons & Arrow Hotbar Handlers + Double-Tap Fly
        const bindKeyButton = (elementId, keyCode) => {
            const btn = document.getElementById(elementId);
            if (!btn) return;

            btn.addEventListener('touchstart', e => {
                e.preventDefault();
                Keyboard.setState(keyCode, true);
                if (this.minecraft.currentScreen === null) {
                    this.minecraft.onKeyPressed(keyCode);
                }
                this.syncMobileTextInput();
            }, { passive: false });

            btn.addEventListener('touchend', e => {
                e.preventDefault();
                Keyboard.setState(keyCode, false);
            }, { passive: false });
        };

        bindKeyButton('mbtn-shift', 'ShiftLeft');
        bindKeyButton('mbtn-e', 'KeyE');

        // Jump button with double-tap detector for flight (KeyF)
        let lastSpaceTap = 0;
        const spaceBtn = document.getElementById('mbtn-space');
        if (spaceBtn) {
            spaceBtn.addEventListener('touchstart', e => {
                e.preventDefault();
                const now = Date.now();

                if (now - lastSpaceTap < 300) {
                    if (this.minecraft.currentScreen === null) {
                        this.minecraft.onKeyPressed("KeyF");
                    }
                }
                lastSpaceTap = now;

                Keyboard.setState("Space", true);
                if (this.minecraft.currentScreen === null) {
                    this.minecraft.onKeyPressed("Space");
                }
            }, { passive: false });

            spaceBtn.addEventListener('touchend', e => {
                e.preventDefault();
                Keyboard.setState("Space", false);
            }, { passive: false });
        }

        document.getElementById('mbtn-prev').addEventListener('touchstart', e => {
            e.preventDefault();
            this.minecraft.onMouseScroll(-1);
        }, { passive: false });

        document.getElementById('mbtn-next').addEventListener('touchstart', e => {
            e.preventDefault();
            this.minecraft.onMouseScroll(1);
        }, { passive: false });

        this.registerListener(document, 'contextmenu');
    }

    updateMobileUIState() {
        if (!this.mobileDevice) return;

        const hasScreen = this.minecraft.currentScreen !== null;

        if (this.mobileOverlay) {
            this.mobileOverlay.style.display = hasScreen ? 'none' : 'block';
        }

        if (this.guiCloseBtn) {
            this.guiCloseBtn.style.display = hasScreen ? 'flex' : 'none';
        }

        this.syncMobileTextInput();
    }

    syncMobileTextInput() {
        if (!this.mobileDevice) return;

        const screen = this.minecraft.currentScreen;
        let widget = null;
        if (screen && screen.buttonList) {
            for (const button of screen.buttonList) {
                if (button && button.isFocused === true &&
                    typeof button.setText === 'function' &&
                    typeof button.getText === 'function') {
                    widget = button;
                    break;
                }
            }
        }

        // Release the previously bound widget so it can track focus again
        if (this.mobileTextWidget && this.mobileTextWidget !== widget) {
            if (typeof this.mobileTextWidget.enableS === 'boolean') {
                this.mobileTextWidget.enableS = true;
            }
        }

        if (!widget) {
            if (this.mobileTextInput && document.activeElement === this.mobileTextInput) {
                this.mobileTextInput.blur();
            }
            this.mobileTextWidget = null;
            this.mobileTextSuppressed = false;
            return;
        }

        // Pin the widget's focus while the native keyboard is open so render()
        // doesn't drop it based on stale mouse/touch coordinates
        if (typeof widget.enableS === 'boolean') {
            widget.enableS = false;
        }

        const input = this.getMobileTextInput();

        // Keep the native input value in sync with the widget on every frame
        if (input.value !== widget.getText()) {
            input.value = widget.getText();
        }
        if (input.maxLength !== (widget.maxLength || 32767)) {
            input.maxLength = widget.maxLength || 32767;
        }

        // Re-focus only when the focused widget changes or the user taps a field
        const shouldFocus = widget !== this.mobileTextWidget || this.mobileTextSuppressed === false;
        this.mobileTextWidget = widget;

        if (shouldFocus && document.activeElement !== input) {
            const sf = this.scaleFactor || 1;
            input.style.left = (widget.x * sf) + 'px';
            input.style.top = (widget.y * sf) + 'px';
            input.style.width = (widget.width * sf) + 'px';
            input.style.height = (widget.height * sf) + 'px';
            input.focus();
        }
    }

    getMobileTextInput() {
        if (this.mobileTextInput) return this.mobileTextInput;

        const input = document.createElement('input');
        input.type = 'text';
        input.setAttribute('autocapitalize', 'off');
        input.setAttribute('autocorrect', 'off');
        input.setAttribute('autocomplete', 'off');
        input.setAttribute('spellcheck', 'false');
        input.style.cssText = 'position:fixed;left:0;top:0;opacity:0;border:0;padding:0;margin:0;outline:none;background:transparent;color:transparent;caret-color:transparent;font-size:16px;z-index:10000;touch-action:none;';

        input.addEventListener('input', () => {
            const widget = this.mobileTextWidget;
            if (widget && typeof widget.setText === 'function') {
                widget.setText(input.value);
            }
        });

        input.addEventListener('keydown', e => {
            // Forward keys the game handles itself (native input handles text editing)
            if (e.key !== 'Enter' && e.key !== 'Tab' && e.key !== 'Escape') return;
            e.preventDefault();
            const screen = this.minecraft.currentScreen;
            if (screen && typeof screen.keyTyped === 'function') {
                screen.keyTyped(e.code, e.key);
            }
            if (e.key === 'Escape' && document.activeElement === input) {
                input.blur();
            }
        });

        input.addEventListener('blur', () => {
            // Remember that the user dismissed the keyboard so we don't fight it
            this.mobileTextSuppressed = true;
        });

        document.body.appendChild(input);
        this.mobileTextInput = input;
        return input;
    }

    updateWindowSize() {
        this.updateScaleFactor();

        let wrapperWidth = this.width * this.scaleFactor;
        let wrapperHeight = this.height * this.scaleFactor;

        let worldRenderer = this.minecraft.worldRenderer;
        let itemRenderer = this.minecraft.itemRenderer;

        worldRenderer.camera.aspect = this.width / this.height;
        worldRenderer.camera.updateProjectionMatrix();
        worldRenderer.webRenderer.setSize(wrapperWidth, wrapperHeight);

        itemRenderer.camera.aspect = this.width / this.height;
        itemRenderer.camera.updateProjectionMatrix();
        itemRenderer.webRenderer.setSize(wrapperWidth, wrapperHeight);
        if (itemRenderer.ctx2d) {
            let guiScale = Math.min(this.scaleFactor, 4);
            itemRenderer.canvas2d.width = this.width * guiScale;
            itemRenderer.canvas2d.height = this.height * guiScale;
            itemRenderer.ctx2d.imageSmoothingEnabled = false;
        }

        this.canvas.style.width = wrapperWidth + "px";
        this.canvas.style.height = wrapperHeight + "px";

        if (this.canvasDebug.width !== this.canvas.width || this.canvasDebug.height !== this.canvas.height) {
            this.canvasDebug.width = this.canvas.width;
            this.canvasDebug.height = this.canvas.height;
        }

        if (this.canvasChat.width !== this.canvas.width || this.canvasChat.height !== this.canvas.height) {
            this.canvasChat.width = this.canvas.width;
            this.canvasChat.height = this.canvas.height;
        }

        if (this.canvasPlayerList.width !== this.canvas.width || this.canvasPlayerList.height !== this.canvas.height) {
            this.canvasPlayerList.width = this.canvas.width;
            this.canvasPlayerList.height = this.canvas.height;
        }

        if (this.canvasGuiItemCount.width !== this.canvas.width || this.canvasGuiItemCount.height !== this.canvas.height) {
            this.canvasGuiItemCount.width = this.canvas.width;
            this.canvasGuiItemCount.height = this.canvas.height;
        }

        this.minecraft.screenRenderer.initialize();

        if (this.minecraft.currentScreen !== null) {
            this.minecraft.currentScreen.setup(this.minecraft, this.width, this.height);
        }

        this.minecraft.ingameOverlay.chatOverlay.setDirty();

        if (this.minecraft.isInGame()) {
            this.minecraft.worldRenderer.render(0);
            this.minecraft.onRender(0)
        }
    }

    updateScaleFactor() {
        let wrapperWidth = this.wrapper.offsetWidth;
        let wrapperHeight = this.wrapper.offsetHeight;

        // On mobile, prefer the largest GUI scale so touch targets stay big
        let minWidth = this.mobileDevice ? 240 : 320;
        let minHeight = this.mobileDevice ? 160 : 240;

        let scale;
        for (scale = 1; wrapperWidth / (scale + 1) >= minWidth && wrapperHeight / (scale + 1) >= minHeight; scale++) {
            // Empty
        }

        this.scaleFactor = scale;
        this.width = Math.ceil(wrapperWidth / scale);
        this.height = Math.ceil(wrapperHeight / scale);
    }

    isCursorLockedToCanvas() {
        return document.pointerLockElement === this.canvas;
    }

    isLocked() {
        return this.focusState.isLock() && this.minecraft.currentScreen === null;
    }

    updateFocusState(state) {
        if (state.getIntent() === this.focusState || state === this.focusState) {
            return;
        }

        let prevLock = this.focusState.isLock();
        let nextLock = state.isLock();

        if (this.minecraft.settings.tvmode) {
            if (state === FocusStateType.REQUEST_LOCK) {
                state = FocusStateType.LOCKED;
            } else if (state === FocusStateType.REQUEST_EXIT) {
                state = FocusStateType.EXITED;
            }
            nextLock = state.isLock();
            if (prevLock === nextLock && this.focusState === state) {
                return;
            }
        }

        this.focusState = state;
        document.body.style.cursor = (nextLock && !this.mobileDevice) ? 'none' : 'default';

        this.requestCursorUpdate();

        if (prevLock !== nextLock) {
            let currentScreen = this.minecraft.currentScreen;

            if (currentScreen === null && !nextLock) {
                this.minecraft.displayScreen(new GuiIngameMenu());
            }

            if (!(currentScreen instanceof GuiLoadingScreen) && nextLock) {
                this.minecraft.displayScreen(null);
                this.lastIngameSwitchTime = Date.now();
            }
        }

        this.updateMobileUIState();
    }

    requestCursorUpdate() {
        if (this.minecraft.settings.tvmode || this.mobileDevice) {
            return;
        }

        if (this.mouseInsideWindow && this.focusState.isLock() !== this.isCursorLockedToCanvas()) {
            if (this.focusState.isLock()) {
                this.canvas.requestPointerLock();
            } else {
                document.exitPointerLock();
            }
        }
    }

    detectTouchDevice() {
        const isCoarseOnly = window.matchMedia("(pointer: coarse) and not (pointer: fine)").matches;
        const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent);

        return isCoarseOnly || (isMobileUA && navigator.maxTouchPoints > 0);
    }

    getMemoryLimit() {
        return this.getMemoryValue("jsHeapSizeLimit", 1);
    }

    getMemoryAllocated() {
        return this.getMemoryValue("totalJSHeapSize", 0);
    }

    getMemoryUsed() {
        return this.getMemoryValue("usedJSHeapSize", 0);
    }

    getMemoryValue(key, fallbackValue = 0) {
        let performance = window.performance || window.msPerformance || window.webkitPerformance || window.mozPerformance;
        if (performance && performance.memory && performance.memory[key]) {
            return performance.memory[key];
        }
        return fallbackValue;
    }

    getGPUName() {
        let gl = this.canvasWorld.getContext("webgl2");
        const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
        return gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
    }

    openUrl(url, newTab) {
        if (newTab) {
            window.open(url, '_blank').focus();
        } else {
            window.location = url;
        }
    }

    close() {
        this.openUrl(Minecraft.URL_GITHUB);
    }

    async getClipboardText() {
        return navigator.clipboard.readText();
    }

    isMobileDevice() {
        return this.mobileDevice;
    }

    pullMouseMotionX() {
        let value = this.mouseMotionX;
        this.mouseMotionX = 0;
        return value;
    }

    pullMouseMotionY() {
        let value = this.mouseMotionY;
        this.mouseMotionY = 0;
        return value;
    }

    initialSoundEngine() {
        if (!this.minecraft.soundManager.isCreated()) {
            this.minecraft.soundManager.create(this.minecraft.worldRenderer);
        }
    }

    registerListener(parent, event, listener = null, preventDefaults = true) {
        parent.addEventListener(event, event => {
            if (preventDefaults) {
                event.preventDefault();
            }

            if (listener !== null) {
                listener(event);
            }
        });
    }
}