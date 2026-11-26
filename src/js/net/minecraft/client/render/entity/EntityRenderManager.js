import PlayerRenderer from "./entity/PlayerRenderer.js";
import PlayerEntity from "../../entity/PlayerEntity.js";
import PlayerEntityMultiplayer from "../../entity/PlayerEntityMultiplayer.js";
import ItemEntity from "../../entity/ItemEntity.js";
import ItemRenderer from "./entity/ItemRenderer.js";
import CreeperEntity from "../../entity/CreeperEntity.js";
import CreeperRenderer from "./entity/CreeperRenderer.js";
import BallEntity from "../../entity/BallEntity.js";
import BallRenderer from "./entity/BallRenderer.js";
import RagdollEntity from "../../entity/RagdollEntity.js";
import RagdollRenderer from "./entity/RagdollRenderer.js";

export default class EntityRenderManager {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;

        this.renderers = [];
        this.push(PlayerEntity, PlayerRenderer);
        this.push(PlayerEntityMultiplayer, PlayerRenderer);
        this.push(ItemEntity, ItemRenderer);
        this.push(CreeperEntity, CreeperRenderer);
        this.push(BallEntity, BallRenderer);
        this.push(RagdollEntity, RagdollRenderer);
    }

    push(entityType, entityRenderer) {
        this.renderers[entityType.name] = entityRenderer;
    }

    createEntityRendererByEntity(entity) {
        if (!(entity.constructor.name in this.renderers)) {
            return null;
        }
        return new this.renderers[entity.constructor.name]["prototype"]["constructor"](this.worldRenderer);
    }
}