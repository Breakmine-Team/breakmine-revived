import PlayerRenderer from "./entity/PlayerRenderer.js";
import PlayerEntity from "../../entity/PlayerEntity.js";
import PlayerEntityMultiplayer from "../../entity/PlayerEntityMultiplayer.js";
import ItemEntity from "../../entity/ItemEntity.js";
import ExperienceOrbEntity from "../../entity/ExperienceOrbEntity.js";
import ItemRenderer from "./entity/ItemRenderer.js";
import ExperienceOrbRenderer from "./entity/ExperienceOrbRenderer.js";
import CreeperEntity from "../../entity/CreeperEntity.js";
import CreeperRenderer from "./entity/CreeperRenderer.js";
import MobRenderer from "./entity/MobRenderer.js";
import MobArrowRenderer from "./entity/MobArrowRenderer.js";
import { MOB_ENTITY_TYPES } from "../../entity/MobEntity.js";

export default class EntityRenderManager {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;

        this.renderers = [];
        this.push(PlayerEntity, PlayerRenderer);
        this.push(PlayerEntityMultiplayer, PlayerRenderer);
        this.push(ItemEntity, ItemRenderer);
        this.push(ExperienceOrbEntity, ExperienceOrbRenderer);
        this.push(CreeperEntity, CreeperRenderer);
        this.push({ name: 'MobArrowEntity' }, MobArrowRenderer);
        for (const type of Object.keys(MOB_ENTITY_TYPES)) this.renderers[type] = MobRenderer;
    }

    push(entityType, entityRenderer) {
        this.renderers[entityType.name] = entityRenderer;
    }

    createEntityRendererByEntity(entity) {
        const renderer = this.renderers[entity.entityType] ?? this.renderers[entity.constructor.name];
        if (!renderer) {
            return null;
        }
        return new renderer(this.worldRenderer, entity.entityType);
    }
}
