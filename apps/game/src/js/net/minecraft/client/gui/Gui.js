import Point from "../render/isometric/Point.js";
import IsometricRenderer from "../render/isometric/IsometricRenderer.js";
import EnumBlockFace from "../../util/EnumBlockFace.js";

export default class Gui {

    static spriteCache = {};
    static backgroundCache = null;

    constructor(minecraft = null) {
        this.minecraft = minecraft;
    }

    getTexture(id) {
        return this.minecraft.resources[id];
    }

    drawCenteredString(stack, string, x, y, color = -1, noColor = true) {
        this.minecraft.fontRenderer.drawString(stack, string, x - this.getStringWidth(stack, string, !noColor) / 2, y, color, true, noColor);
    }

    drawRightString(stack, string, x, y, color = -1, shadow = true) {
        this.minecraft.fontRenderer.drawString(stack, string, x - this.getStringWidth(stack, string), y, color, shadow);
    }

    drawString(stack, string, x, y, color = -1, shadow = true, noColor = true) {
        this.minecraft.fontRenderer.drawString(stack, string, x, y, color, shadow, noColor);
    }

    getStringWidth(stack, string, color = false) {
        if (color) {string = string.replace(/§./g, "")};
        return this.minecraft.fontRenderer.getStringWidth(stack, string);
    }

    drawRect(stack, left, top, right, bottom, color, alpha = 1) {
        stack.save();
        stack.fillStyle = color;
        stack.globalAlpha = alpha;
        stack.fillRect(Math.floor(left), Math.floor(top), Math.floor(right - left), Math.floor(bottom - top));
        stack.restore();
    }

    drawOutlineRect(stack, left, top, right, bottom, color, thickness = 1, alpha = 1) {
        stack.save();
        stack.strokeStyle = color;
        stack.lineWidth = Math.floor(thickness);
        stack.globalAlpha = alpha;

        const x = Math.floor(left);
        const y = Math.floor(top);
        const width = Math.floor(right - left);
        const height = Math.floor(bottom - top);
        const halfThickness = Math.floor(thickness / 2);
        stack.strokeRect(
            x + 0.5 + halfThickness,
            y + 0.5 + halfThickness,
            width - thickness - (thickness % 2),
            height - thickness - (thickness % 2)
        );
        stack.restore();
    }

    drawGradientRect(stack, left, top, right, bottom, color1, color2) {
        let gradient = stack.createLinearGradient(left + (right - left) / 2, top, left + (right - left) / 2, bottom - top);
        gradient.addColorStop(0, color1);
        gradient.addColorStop(1, color2);
        stack.fillStyle = gradient;
        stack.fillRect(left, top, right - left, bottom - top);
    }

    drawTexture(stack, texture, x, y, width, height, alpha = 1.0) {
        Gui.drawSprite(stack, texture, 0, 0, 256, 256, x, y, width, height, alpha);
    }

    drawSprite(stack, texture, spriteX, spriteY, spriteWidth, spriteHeight, x, y, width, height, alpha = 1.0) {
        Gui.drawSprite(stack, texture, spriteX, spriteY, spriteWidth, spriteHeight, x, y, width, height, alpha);
    }

    drawBackground(stack, texture, width, height, scale = 2) {

        if (!Gui.backgroundCache || Gui.backgroundCache.width !== width || Gui.backgroundCache.height !== height) {

            Gui.backgroundCache = new OffscreenCanvas(width, height);
            const cacheCtx = Gui.backgroundCache.getContext("2d");

            cacheCtx.save();

            // Disable image smoothing for pixel-perfect dirt texture
            cacheCtx.imageSmoothingEnabled = false;

            let pattern = cacheCtx.createPattern(texture, "repeat");

            cacheCtx.filter = "brightness(50%)";

            cacheCtx.scale(scale, scale);

            cacheCtx.rect(0, 0, width / scale, height / scale);
            cacheCtx.fillStyle = pattern;
            cacheCtx.fill();

            cacheCtx.restore();

        }

        stack.save();
        stack.globalAlpha = 1.0;
        stack.drawImage(Gui.backgroundCache, 0, 0);
        stack.restore();
    }

    renderBlock(stack, texture, block, x, y) {
        let scale = 0.18;

        let blockWidth = 32 * scale;

        let sideY = 16 * scale;
        let sideHeight = 40 * scale;
        let middleTopHeight = 32 * scale;
        let middleBottomHeight = 40 * scale;

        let topTip = new Point(0, -middleTopHeight);
        let center = new Point(0, 0);
        let bottomTip = new Point(0, middleBottomHeight);

        let topLeft = new Point(-blockWidth, -middleTopHeight + sideY);
        let bottomLeft = new Point(-blockWidth, -middleTopHeight + sideY + sideHeight);

        let topRight = new Point(blockWidth, -middleTopHeight + sideY);
        let bottomRight = new Point(blockWidth, -middleTopHeight + sideY + sideHeight);

        let trianglesLeft = IsometricRenderer.createTriangles(
            texture,
            topLeft,
            center,
            bottomTip,
            bottomLeft
        );

        let trianglesRight = IsometricRenderer.createTriangles(
            texture,
            center,
            topRight,
            bottomRight,
            bottomTip
        );

        let trianglesTop = IsometricRenderer.createTriangles(
            texture,
            topLeft,
            topTip,
            topRight,
            center
        );

        stack.save();
        stack.translate(x + 0.5, y + 0.5);
        stack.imageSmoothingEnabled = true;
        this.renderBlockFace(stack, texture, block, trianglesLeft, EnumBlockFace.NORTH);
        this.renderBlockFace(stack, texture, block, trianglesRight, EnumBlockFace.EAST);
        this.renderBlockFace(stack, texture, block, trianglesTop, EnumBlockFace.TOP);
        stack.restore();
    }

    renderBlockFace(stack, texture, block, triangles, face) {
        let textureIndex = block.getTextureForFace(face);
        let minU = (textureIndex % 16) / 16.0;
        let minV = Math.floor(textureIndex / 16) / 16.0;

        stack.save();

        IsometricRenderer.render(stack, triangles, _ => this.drawSprite(stack, texture, minU * 256, minV * 256, 16, 16, 0, 0, 256, 256));
        stack.restore();
    }

    mouseRightClicked(mouseX, mouseY, mouseButton) {

    }

    onScroll(mouseX, mouseY, amount) {

    }

    static colorize(image, r, g, b) {
        const imageSize = image.width;

        const offscreen = new OffscreenCanvas(imageSize, imageSize);
        const ctx = offscreen.getContext("2d");

        ctx.drawImage(image, 0, 0);

        const imageData = ctx.getImageData(0, 0, imageSize, imageSize);

        for (let i = 0; i < imageData.data.length; i += 4) {
            imageData.data[i + 0] *= r;
            imageData.data[i + 1] *= g;
            imageData.data[i + 2] *= b;
        }

        ctx.putImageData(imageData, 0, 0);

        return offscreen;
    }

    static drawSpriteRGB(stack, texture, spriteX, spriteY, spriteWidth, spriteHeight, x, y, width, height, r, g, b, alpha = 1.0) {
        const cacheKey = `${texture.id}_${r.toFixed(3)}_${g.toFixed(3)}_${b.toFixed(3)}`; 

        let coloredTexture = Gui.spriteCache[cacheKey];

        if (!coloredTexture) {
            coloredTexture = Gui.colorize(texture, r, g, b);
            Gui.spriteCache[cacheKey] = coloredTexture;
        }

        Gui.drawSprite(stack, coloredTexture, spriteX, spriteY, spriteWidth, spriteHeight, x, y, width, height, alpha);
    }

    static drawSprite(stack, texture, spriteX, spriteY, spriteWidth, spriteHeight, x, y, width, height, alpha = 1.0) {
        stack.save();
        stack.globalAlpha = alpha;
        stack.drawImage(
            texture,
            Math.floor(spriteX),
            Math.floor(spriteY),
            Math.floor(spriteWidth),
            Math.floor(spriteHeight),
            Math.floor(x),
            Math.floor(y),
            Math.floor(width),
            Math.floor(height)
        );
        stack.restore();
    }
}