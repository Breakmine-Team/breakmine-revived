import EntityRenderer from "../EntityRenderer.js";
import Tessellator from "../../Tessellator.js";
import MathHelper from "../../../../util/MathHelper.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";
import BlockRenderType from "../../../../util/BlockRenderType.js";
import BlockTorch from "../../../world/block/type/BlockTorch.js";

export default class ItemRenderer extends EntityRenderer {
    constructor(worldRenderer) {
        super(null);
        this.worldRenderer = worldRenderer;
        this.blockRenderer = this.worldRenderer.blockRenderer;
        this.material = null;
        this.mesh = null;
        this.geometry = null;
    }

    disposeMesh() {
        if (this.mesh) {
            this.group.remove(this.mesh);
            if (this.geometry) {
                this.geometry.dispose(); 
            }
            this.geometry = null;
            this.mesh = null;
        }
    }

    hideMesh() {
        if (this.group) {
            this.group.visible = false;
        }
    }

    rebuild(entity) {
        let meta = {};
        this.fillMeta(entity, meta);
        this.group.buildMeta = meta;

        this.disposeMesh();

        const block = entity.getBlock();

        if (block) {
            this.group.visible = true;
            let brightness = meta.brightness;
            this.mesh = this.blockRenderer.renderBlockInNullWorld(
                this.group,
                block,
                brightness
            );

            if (this.mesh) {
                this.geometry = this.mesh.geometry;
                this.mesh.position.set(0, 0.2, 0);
                this.mesh.renderOrder = 10000;
                this.mesh.material.depthWrite = false;
            }
        } else {
            this.group.visible = false;
        }
    }

    render(entity, partialTicks) {
        if (entity.isDead) {
            this.group.visible = false;
            return;
        }

        // Rebuild only when needed
        if (this.isRebuildRequired(entity)) {
            this.rebuild(entity);
        }

        // Interpolate entity position
        let interpolatedX = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        let interpolatedY = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        let interpolatedZ = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        // Set group position to interpolated entity position
        this.group.position.set(interpolatedX, interpolatedY, interpolatedZ);
        this.group.updateMatrix();

        // Set mesh transformations
        if (this.mesh) {
            this.mesh.position.set(0, 0.2, 0);
            if (entity.getBlock()?.getRenderType() === BlockRenderType.ITEM || entity.getBlock()?.getRenderType() === BlockRenderType.DECORATION) {
                this.mesh.scale.set(0.4, 0.4, 0.4);
            } else if (entity.getBlock() instanceof BlockTorch) {
                this.mesh.scale.set(0.4, 0.4, 0.4);
            } else {
                this.mesh.scale.set(0.25, 0.25, 0.25);
            }
            this.mesh.rotation.y = MathHelper.toRadians(entity.prevRotationPitch + (entity.rotationPitch - entity.prevRotationPitch) * partialTicks);
            this.mesh.updateMatrix();
        }

        this.group.visible = true;
    }

    prepareModel(entity) {
        if (this.isRebuildRequired(entity)) {
            this.rebuild(entity);
        }
    }
    
    fillMeta(entity, meta) {
        meta.brightness = entity.getEntityBrightness();
        meta.blockId = entity.getBlockId();
    }

    isRebuildRequired(entity) {
        if (typeof this.group.buildMeta === "undefined") {
            return true;
        }

        let currentMeta = {};
        this.fillMeta(entity, currentMeta);
        let previousMeta = this.group.buildMeta;
        return JSON.stringify(currentMeta) !== JSON.stringify(previousMeta);
    }
}
