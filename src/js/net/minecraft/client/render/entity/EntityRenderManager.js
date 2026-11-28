import PlayerRenderer from "./entity/PlayerRenderer.js";
import PlayerEntity from "../../entity/PlayerEntity.js";
import PlayerEntityMultiplayer from "../../entity/PlayerEntityMultiplayer.js";
import ItemEntity from "../../entity/ItemEntity.js";
import ItemRenderer from "./entity/ItemRenderer.js";
import CreeperEntity from "../../entity/CreeperEntity.js";
import CreeperRenderer from "./entity/CreeperRenderer.js";
import RagdollEntity from "../../entity/RagdollEntity.js";
import RagdollRenderer from "./entity/RagdollRenderer.js";
import ContraptionEntity from "../../entity/ContraptionEntity.js";
import ContraptionRenderer from "./entity/ContraptionRenderer.js";

export default class EntityRenderManager {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;

        this.renderers = new Map();
        this.push(PlayerEntity, PlayerRenderer);
        this.push(PlayerEntityMultiplayer, PlayerRenderer);
        this.push(ItemEntity, ItemRenderer);
        this.push(CreeperEntity, CreeperRenderer);
        this.push(RagdollEntity, RagdollRenderer);
        this.push(ContraptionEntity, ContraptionRenderer);
    }

    // Renderers are matched on the class itself, never on constructor.name:
    // minifiers rename class expressions, and several unrelated entities then
    // share the same name, so a name lookup hands them the wrong renderer.
    push(entityType, entityRenderer) {
        this.renderers.set(entityType, entityRenderer);
    }

    createEntityRendererByEntity(entity) {
        // Subclasses without their own renderer (PlayerEntityMultiplayer) walk
        // up to the nearest registered parent class.
        let entityType = entity.constructor;
        while (typeof entityType === "function") {
            const renderer = this.renderers.get(entityType);
            if (renderer) {
                return new renderer.prototype.constructor(this.worldRenderer);
            }
            entityType = Object.getPrototypeOf(entityType);
        }
        return null;
    }
}
