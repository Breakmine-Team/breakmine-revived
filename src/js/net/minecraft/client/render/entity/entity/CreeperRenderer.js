import ModelCreeper from '../../model/model/ModelCreeper.js';
import EntityRenderer from '../EntityRenderer.js';
import * as THREE from '../../../../../../../../libraries/three.module.js';

/**
 * Renderer for the Creeper entity.
 */
export default class CreeperRenderer extends EntityRenderer {
    constructor(worldRenderer) {
        // Initialize with the Creeper model
        super(new ModelCreeper());

        this.worldRenderer = worldRenderer;

        // Load the standard creeper texture
        this.texture = worldRenderer.minecraft.getThreeTexture('creeper.png');
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.minFilter = THREE.NearestFilter;
    }

    prepareModel(entity) {
        this.model.texture = this.texture;
        this.tessellator.bindTexture(this.texture);
    }

    render(entity, partialTicks) {
        this.prepareModel(entity);
        super.render(entity, partialTicks);
        this.group.position.setY(this.group.position.y - ((1/16) * 5.6)); //fix floating
    }

    fillMeta(entity, meta) {
        super.fillMeta(entity, meta);
        meta.shadowSize = 0.5; 
    }
}