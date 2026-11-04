import * as THREE from "../../../../../../../../libraries/three.module.js";

export default class GuiPlayerTexture {

    static upscale(image, scale) {
        const w = image.width * scale;
        const h = image.height * scale;

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;

        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(image, 0, 0, w, h);

        return canvas;
    }

    static createSharpTexture(resources, sourceImage = null) {
        const img = sourceImage || resources['char.png'];
        if (!img) return null;

        const canvas = GuiPlayerTexture.upscale(img, 4);
        const texture = new THREE.CanvasTexture(canvas);
        texture.magFilter = THREE.NearestFilter;
        texture.minFilter = THREE.NearestFilter;
        texture.generateMipmaps = false;

        return texture;
    }

}
