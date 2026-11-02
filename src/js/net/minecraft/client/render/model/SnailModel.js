import { loadModelAsset, loadTextureAsset } from "./CustomModel.js";

const MODEL_ASSET = "model/snail/model.obj";
const TEXTURE_ASSET = "model/snail/texture.png";

export default function getSnailModel() {
    return loadModelAsset(MODEL_ASSET);
}

export function getSnailTexture() {
    return loadTextureAsset(TEXTURE_ASSET);
}
