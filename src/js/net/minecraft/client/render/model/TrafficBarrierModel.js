import { loadModelAsset, loadTextureAsset } from "./CustomModel.js";

const MODEL_ASSET = "model/barrier/model.obj";
const TEXTURE_ASSET = "model/barrier/texture.png";

export default function getTrafficBarrierModel() {
    return loadModelAsset(MODEL_ASSET);
}

export function getTrafficBarrierTexture() {
    return loadTextureAsset(TEXTURE_ASSET);
}
