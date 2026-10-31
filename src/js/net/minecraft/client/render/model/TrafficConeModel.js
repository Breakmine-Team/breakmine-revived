import { loadModelAsset, loadTextureAsset } from "./CustomModel.js";

const MODEL_ASSET = "model/cone/model.obj";
const TEXTURE_ASSET = "model/cone/texture.png";

export default function getTrafficConeModel() {
    return loadModelAsset(MODEL_ASSET);
}

export function getTrafficConeTexture() {
    return loadTextureAsset(TEXTURE_ASSET);
}
