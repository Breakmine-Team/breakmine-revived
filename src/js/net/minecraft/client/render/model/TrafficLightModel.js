import { loadModelAsset, loadTextureAsset } from "./CustomModel.js";

const MODEL_ASSET = "model/trafficlight/model.obj";
const TEXTURE_ASSET = "model/trafficlight/texture.png";

export default function getTrafficLightModel() {
    return loadModelAsset(MODEL_ASSET);
}

export function getTrafficLightTexture() {
    return loadTextureAsset(TEXTURE_ASSET);
}
