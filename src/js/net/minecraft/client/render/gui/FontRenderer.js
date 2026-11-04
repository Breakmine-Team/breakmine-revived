import Gui from "../../gui/Gui.js";
import MathHelper from "../../../util/MathHelper.js";

export default class FontRenderer {

    static FONT_HEIGHT = 8;

    static BITMAP_SIZE = 16;
    static FIELD_SIZE = 8;

    static COLOR_CODE_INDEX_LOOKUP = "0123456789abcdef";
    static CHAR_INDEX_LOOKUP = "\u00c0\u00c1\u00c2\u00c8\u00ca\u00cb\u00cd\u00d3\u00d4\u00d5\u00da\u00df\u00e3\u00f5\u011f\u0130\u0131\u0152\u0153\u015e\u015f\u0174\u0175\u017e\u0207\u0000\u0000\u0000\u0000\u0000\u0000\u0000 !\"#$%&\'()*+,-./0123456789:;<=>?@ABCDEFGHIJKLMNOPQRSTUVWXYZ[\\]^_`abcdefghijklmnopqrstuvwxyz{|}~\u0000\u00c7\u00fc\u00e9\u00e2\u00e4\u00e0\u00e5\u00e7\u00ea\u00eb\u00e8\u00ef\u00ee\u00ec\u00c4\u00c5\u00c9\u00e6\u00c6\u00f4\u00f6\u00f2\u00fb\u00f9\u00ff\u00d6\u00dc\u00f8\u00a3\u00d8\u00d7\u0192\u00e1\u00ed\u00f3\u00fa\u00f1\u00d1\u00aa\u00ba\u00bf\u00ae\u00ac\u00bd\u00bc\u00a1\u00ab\u00bb\u2591\u2592\u2593\u2502\u2524\u2561\u2562\u2556\u2555\u2563\u2551\u2557\u255d\u255c\u255b\u2510\u2514\u2534\u252c\u251c\u2500\u253c\u255e\u255f\u255a\u2554\u2569\u2566\u2560\u2550\u256c\u2567\u2568\u2564\u2565\u2559\u2558\u2552\u2553\u256b\u256a\u2518\u250c\u2588\u2584\u258c\u2590\u2580\u03b1\u03b2\u0393\u03c0\u03a3\u03c3\u03bc\u03c4\u03a6\u0398\u03a9\u03b4\u221e\u2205\u2208\u2229\u2261\u00b1\u2265\u2264\u2320\u2321\u00f7\u2248\u00b0\u2219\u00b7\u221a\u207f\u00b2\u25a0\u0000";
    static COLOR_PREFIX = '\u00a7';

    static COLOR_HEX_MAP = {
        '0': '000000',
        '1': '0000aa',
        '2': '00aa00',
        '3': '00aaaa',
        '4': 'aa0000',
        '5': 'aa00aa',
        '6': 'ffaa00',
        '7': 'aaaaaa',
        '8': '555555',
        '9': '5555ff',
        'a': '55ff55',
        'b': '55ffff',
        'c': 'ff5555',
        'd': 'ff55ff',
        'e': 'ffff55',
        'f': 'ffffff',
        'g': 'ddd605',
        'h': 'e3d4d1',
        'i': 'cecaca',
        'j': '443a3b',
        'm': '971607',
        'n': 'b4684d',
        'p': 'deb12d',
        'q': '47a036',
        's': '2cbaa8',
        't': '21497b',
        'u': '9a5cc6'
    };

    constructor(minecraft) {
        this.charWidths = [];

        this.filterCache = {};
        this.lastAppliedFilter = null;

        this.isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        this.texture = minecraft.resources["gui/font.png"];

        let bitMap = this.createBitMap(this.texture);

        for (let i = 0; i < 256; i++) {
            this.charWidths[i] = this.calculateCharacterWidthAt(bitMap, i % FontRenderer.BITMAP_SIZE, Math.floor(i / FontRenderer.BITMAP_SIZE)) + 2;
        }
    }

    calculateCharacterWidthAt(bitMap, indexX, indexY) {
        for (let x = indexX * FontRenderer.FIELD_SIZE + FontRenderer.FIELD_SIZE - 1; x >= indexX * FontRenderer.FIELD_SIZE; x--) {
            for (let y = indexY * FontRenderer.FIELD_SIZE; y < indexY * FontRenderer.FIELD_SIZE + FontRenderer.FIELD_SIZE; y++) {
                let i = (x + y * this.texture.width) * 4;

                let red = bitMap[i];
                let green = bitMap[i + 1];
                let blue = bitMap[i + 2];
                let alpha = bitMap[i + 3];

                if (red > 1 || green > 1 || blue > 1 || alpha > 1) {
                    return x - indexX * FontRenderer.FIELD_SIZE;
                }
            }
        }

        return 2;
    }

    drawString(stack, string, x, y, color = -1, shadow = true, noColor = true) {
        if (shadow) {
            this.drawStringRaw(stack, string, x + 1, y + 1, color, true, "8", noColor);
        }
        this.drawStringRaw(stack, string, x, y, color, false, "8", noColor);
    }

    getColorOfCharacter(character) {
        const char = character.toLowerCase();
        if (char === 'r') {
            return 0xFFFFFF; 
        }
        const hexString = FontRenderer.COLOR_HEX_MAP[char];

        if (hexString) {
            return parseInt(hexString, 16);
        }

        return -1;
    }

    drawStringRaw(stack, string, x, y, color = -1, isShadow = false, size = "8", noColor = true) {
        if (typeof string !== "string") string = String(string ?? "");
        stack.save();

        this.setColor(stack, color, isShadow);

        let localX = x;
        let bold = false;
        let italic = false;
        let underline = false;

        let solidIndex = FontRenderer.CHAR_INDEX_LOOKUP.indexOf('\u2588');
        if (solidIndex === -1) solidIndex = 0;
        let solidU = (solidIndex % FontRenderer.BITMAP_SIZE) * FontRenderer.FIELD_SIZE;
        let solidV = Math.floor(solidIndex / FontRenderer.BITMAP_SIZE) * FontRenderer.FIELD_SIZE;

        for (let i = 0; i < string.length; i++) {
            let character = string[i];

            if (character === FontRenderer.COLOR_PREFIX && i < string.length - 1) {
                let codeChar = string[i + 1].toLowerCase();

                if (string[i + 1] === FontRenderer.COLOR_PREFIX) {
                    character = FontRenderer.COLOR_PREFIX;
                    i++;
                } else {
                    if (codeChar === 'l') {
                        bold = true;
                    } else if (codeChar === 'o') {
                        italic = true;
                    } else if (codeChar === 'n') {
                        underline = true;
                    } else if (codeChar === 'r') {
                        bold = false;
                        italic = false;
                        underline = false;
                        this.setColor(stack, color, isShadow);
                    } else {
                        let newColor = this.getColorOfCharacter(codeChar);
                        if (newColor !== -1) {
                            if (noColor === false) {
                                this.setColor(stack, newColor, isShadow);
                            }
                            bold = false;
                            italic = false;
                            underline = false;
                        }
                    }
                    i++;
                    continue;
                }
            }

            let index = FontRenderer.CHAR_INDEX_LOOKUP.indexOf(character);
            let code = character.charCodeAt(0);
            let charWidth = this.charWidths[code] || 2;

            if (index !== -1) {
                let textureOffsetX = (index % FontRenderer.BITMAP_SIZE) * FontRenderer.FIELD_SIZE;
                let textureOffsetY = Math.floor(index / FontRenderer.BITMAP_SIZE) * FontRenderer.FIELD_SIZE;

                const drawGlyphAt = (offsetX) => {
                    if (italic) {
                        // Slices character into 2px high strips, shifting 1px right every 2px up
                        for (let row = 0; row < FontRenderer.FIELD_SIZE; row += 2) {
                            let shift = Math.floor((FontRenderer.FIELD_SIZE - 2 - row) / 2);
                            Gui.drawSpriteRGB(
                                stack, this.texture,
                                textureOffsetX, textureOffsetY + row,
                                FontRenderer.FIELD_SIZE, 2,
                                Math.floor(localX + offsetX + shift), Math.floor(y + row),
                                FontRenderer.FIELD_SIZE, 2,
                                this.r, this.g, this.b, 1.0
                            );
                        }
                    } else {
                        Gui.drawSpriteRGB(
                            stack, this.texture,
                            textureOffsetX, textureOffsetY,
                            FontRenderer.FIELD_SIZE, FontRenderer.FIELD_SIZE,
                            Math.floor(localX + offsetX), Math.floor(y),
                            FontRenderer.FIELD_SIZE, FontRenderer.FIELD_SIZE,
                            this.r, this.g, this.b, 1.0
                        );
                    }
                };

                drawGlyphAt(0);

                if (bold) {
                    drawGlyphAt(1);
                }

                if (underline) {
                    let totalWidth = charWidth + (bold ? 1 : 0);
                    Gui.drawSpriteRGB(
                        stack, this.texture,
                        solidU, solidV,
                        FontRenderer.FIELD_SIZE, FontRenderer.FIELD_SIZE,
                        Math.floor(localX), Math.floor(y + FontRenderer.FONT_HEIGHT + 1),
                        totalWidth, 1,
                        this.r, this.g, this.b, 1.0
                    );
                }
            }

            localX += charWidth + (bold ? 1 : 0);
        }

        stack.restore();
    }

    getStringWidth(stack, string) {
        if (typeof stack === "string" && string === undefined) {
            string = stack;
        }
        if (typeof string !== "string") string = String(string ?? "");
        let length = 0;
        let bold = false;

        for (let i = 0; i < string.length; i++) {
            if (string[i] === FontRenderer.COLOR_PREFIX && i < string.length - 1) {
                let codeChar = string[i + 1].toLowerCase();

                if (string[i + 1] === FontRenderer.COLOR_PREFIX) {
                    let code = string[i].charCodeAt(0);
                    length += (this.charWidths[code] || 2) + (bold ? 1 : 0);
                    i++;
                } else {
                    if (codeChar === 'l') {
                        bold = true;
                    } else if (codeChar === 'r' || this.getColorOfCharacter(codeChar) !== -1) {
                        bold = false;
                    }
                    i++;
                }
            } else {
                let code = string[i].charCodeAt(0);
                length += (this.charWidths[code] || 2) + (bold ? 1 : 0);
            }
        }
        return length;
    }

    createBitMap(img) {
        let canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        canvas.getContext('2d').drawImage(img, 0, 0, img.width, img.height);
        return canvas.getContext('2d').getImageData(0, 0, img.width, img.height).data;
    }

    setColor(stack, color, isShadow = false) {
        if (color === -1) {
            color = 0xFFFFFF;
        }

        if (isShadow) {
            color = (color & 0xFCFCFC) >> 2; 
        }

        const r_int = (color & 0xFF0000) >> 16;
        const g_int = (color & 0x00FF00) >> 8;
        const b_int = (color & 0x0000FF);

        this.r = r_int / 255.0;
        this.g = g_int / 255.0;
        this.b = b_int / 255.0;
    }

    listFormattedStringToWidth(text, wrapWidth) {
        let resultLines = [];
        let hardLines = text.split("\n");

        for (let line of hardLines) {
            let remainingText = line;

            while (remainingText.length > 0) {
                let splitIndex = this.sizeStringToWidth(remainingText, wrapWidth);
                
                if (remainingText.length <= splitIndex) {
                    resultLines.push(remainingText);
                    break;
                } else {
                    let segment = remainingText.substring(0, splitIndex);
                    resultLines.push(segment);
                    remainingText = remainingText.substring(splitIndex);
                }
            }
        }

        return resultLines;
    }

    sizeStringToWidth(text, width) {
        let currentWidth = 0;
        let i = 0;
        let length = text.length;
        let bold = false;

        while (i < length) {
            let char = text[i];
            
            if (char === FontRenderer.COLOR_PREFIX && i + 1 < length) {
                let codeChar = text[i + 1].toLowerCase();

                if (text[i + 1] === FontRenderer.COLOR_PREFIX) {
                    let code = char.charCodeAt(0);
                    currentWidth += (this.charWidths[code] || 0) + (bold ? 1 : 0);
                    i++;
                } else {
                    if (codeChar === 'l') {
                        bold = true;
                    } else if (codeChar === 'r' || this.getColorOfCharacter(codeChar) !== -1) {
                        bold = false;
                    }
                    i++;
                }
            } else {
                let code = char.charCodeAt(0);
                currentWidth += (this.charWidths[code] || 0) + (bold ? 1 : 0);
            }

            if (currentWidth > width) {
                break;
            }
            i++;
        }

        return i;
    }
}