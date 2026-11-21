import * as THREE from "../../../../../../../libraries/three.module.js";
import { base64Assets } from "../../../../../../resources.js";
import { loadModelAsset } from "./CustomModel.js";

const MODEL_ASSET = "model/trafficlight/model.obj";
const BASE_TEXTURE_ASSET = "model/trafficlight/texture.png";

const OVERLAY_TEXTURE_ASSETS = {
    none: "model/trafficlight/none.png",
    red: "model/trafficlight/red.png",
    yellow: "model/trafficlight/yellow.png",
    green: "model/trafficlight/green.png"
};

// Index matches the state stored in bits 3-4 of the block metadata.
export const TRAFFIC_LIGHT_STATES = ["none", "red", "yellow", "green"];

const textureCache = new Map();

export default function getTrafficLightModel() {
    return loadModelAsset(MODEL_ASSET);
}

export function getTrafficLightTexture(state = "none") {
    const name = OVERLAY_TEXTURE_ASSETS[state] ? state : "none";
    const cached = textureCache.get(name);
    if (cached) {
        return cached;
    }

    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const context = canvas.getContext("2d");

    const texture = new THREE.Texture(canvas);
    texture.magFilter = THREE.NearestFilter;
    texture.minFilter = THREE.NearestFilter;
    texture.wrapS = THREE.ClampToEdgeWrapping;
    texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false;
    texture.needsUpdate = true;

    textureCache.set(name, texture);

    const baseSrc = base64Assets[BASE_TEXTURE_ASSET];
    const overlaySrc = base64Assets[OVERLAY_TEXTURE_ASSETS[name]];
    if (!baseSrc || !overlaySrc) {
        console.warn(`[TrafficLightModel] Missing bundled traffic light texture for state '${name}'`);
        return texture;
    }

    // The overlay PNGs are translucent lamp masks: they dim the lenses that are
    // not active. Drawing them over the base texture bakes the state into a
    // single texture, so the model still renders as one opaque mesh.
    const base = new Image();
    const overlay = new Image();
    let loaded = 0;

    const drawComposite = () => {
        if (++loaded < 2) {
            return;
        }

        canvas.width = base.naturalWidth || base.width || 32;
        canvas.height = base.naturalHeight || base.height || 32;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.drawImage(base, 0, 0, canvas.width, canvas.height);
        context.drawImage(overlay, 0, 0, canvas.width, canvas.height);
        texture.needsUpdate = true;
    };

    base.onload = drawComposite;
    overlay.onload = drawComposite;
    base.src = baseSrc;
    overlay.src = overlaySrc;

    return texture;
}
