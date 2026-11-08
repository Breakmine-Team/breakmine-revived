import * as THREE from "../../../../../../libraries/three.module.js";
import Block from "../world/block/Block.js";
import BlockRenderType from "../../util/BlockRenderType.js";
import { applyHeldItemDisplay } from './HeldItemModel.js';
import Tessellator from "./Tessellator.js";

export default class FirstPersonItemRenderer {

    constructor(worldRenderer) {
        this.worldRenderer = worldRenderer;
        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(70, 1, 0.05, 100);
        this.cameraGroup = new THREE.Object3D();
        this.armTransformGroup = new THREE.Object3D();
        this.armTransformGroup.matrixAutoUpdate = false;
        this.cameraGroup.add(this.armTransformGroup);
        this.scene.add(this.cameraGroup);
        this.itemId = -1;
        this.generatedItem = false;
        this.poseMatrix = new THREE.Matrix4();
        this.transformMatrix = new THREE.Matrix4();
        this.viewportSize = new THREE.Vector2();
    }

    clearModel() {
        while (this.armTransformGroup.children.length > 0) {
            const child = this.armTransformGroup.children[0];
            this.armTransformGroup.remove(child);
            child.traverse(node => {
                if (!node.isMesh) return;
                node.geometry?.dispose();
                node.material?.map?.dispose();
                node.material?.dispose();
            });
        }
        this.itemId = -1;
        this.generatedItem = false;
    }

    rebuild(itemStack, brightness) {
        this.clearModel();

        const block = Block.getById(itemStack.getType());
        if (!block) return;

        const displayGroup = new THREE.Object3D();
        let model = null;

        if (block.getRenderType() === BlockRenderType.ITEM) {
            model = block.tex === 'trident'
                ? this.worldRenderer.blockRenderer.createTridentItemModel()
                : this.worldRenderer.blockRenderer.createGeneratedItemMesh(block, brightness, true);
            if (!model) return;
            this.generatedItem = true;
            applyHeldItemDisplay(displayGroup, block.tex, false, true, block.itemDisplay?.firstperson_righthand);
            displayGroup.position.multiplyScalar(1 / 16);
            if (block.tex === 'trident') model.scale.multiplyScalar(1 / 16);
        } else {
            const renderer = this.worldRenderer.blockRenderer;
            const meshGroup = new THREE.Object3D();
            renderer.tessellator.startDrawing();
            renderer.renderBlock(null, block, false, 0, 0, 0);
            model = renderer.tessellator.draw(meshGroup);
            model.geometry.center();
            displayGroup.rotation.y = Math.PI / 4;
            displayGroup.scale.setScalar(0.4);
        }

        model.traverse(node => {
            if (!node.isMesh) return;
            node.material = node.material.clone();
            // clone() drops onBeforeCompile: without re-applying the tile
            // wrap, oversized multipart bboxes bleed into the neighbouring
            // atlas tiles in the hand while looking fine in the world.
            if (node.geometry?.getAttribute('aTileRect')) {
                Tessellator.applyTileWrap(node.material);
            }
            node.material.depthTest = true;
            node.material.depthWrite = true;
            node.renderOrder = 1;
        });
        displayGroup.add(model);
        this.armTransformGroup.add(displayGroup);
        this.itemId = itemStack.getType();
    }

    update(itemStack, brightness, equipProgress, swingProgress, partialTicks, currentSwing = null, usingItem = null) {
        if (this.itemId !== itemStack.getType() || this.armTransformGroup.children.length === 0) {
            this.rebuild(itemStack, brightness);
        }

        this.cameraGroup.visible = true;
        this.cameraGroup.position.set(0, 0, 0);
        this.cameraGroup.rotation.set(0, 0, 0, 'ZYX');
        this.cameraGroup.scale.set(1, 1, 1);

        const player = this.worldRenderer.minecraft.player;
        if (this.worldRenderer.minecraft.settings.viewBobbing) {
            this.worldRenderer.bobbingAnimation(player, this.cameraGroup, partialTicks);
        }

        const pitchArm = player.prevRenderArmPitch + (player.renderArmPitch - player.prevRenderArmPitch) * partialTicks;
        const yawArm = player.prevRenderArmYaw + (player.renderArmYaw - player.prevRenderArmYaw) * partialTicks;
        this.cameraGroup.rotateX((player.rotationPitch - pitchArm) * Math.PI / 1800);
        this.cameraGroup.rotateY((player.rotationYaw - yawArm) * Math.PI / 1800);

        // Apply current light to both generated flat items and voxel block
        // models. Baking brightness into voxel vertex colors during rebuild
        // made held blocks stay at their old brightness after lighting changed.
        const light = Math.max(0, Math.min(1, Number(brightness) || 0));
        this.armTransformGroup.traverse(node => {
            if (node.isMesh && node.material?.color) {
                node.material.color.setRGB(light, light, light);
            }
        });

        const matrix = this.poseMatrix.identity();
        if (usingItem?.hand === 'main_hand') {
            this.applyEatTransform(
                matrix,
                usingItem.remainingTicks,
                partialTicks,
                usingItem.durationTicks
            );
            this.applyItemArmTransform(matrix, equipProgress);
        } else {
            this.applyItemArmTransform(matrix, equipProgress);
        }
        if (!usingItem && currentSwing?.hand === 'main_hand') {
            this.applySwingTransform(matrix, swingProgress, currentSwing.animation?.type);
        }
        this.armTransformGroup.matrix.copy(matrix);
        this.armTransformGroup.matrixWorldNeedsUpdate = true;
    }

    applyItemArmTransform(matrix, equipProgress) {
        matrix.multiply(this.transformMatrix.makeTranslation(0.56, -0.52 - (1 - equipProgress) * 0.6, -0.72));
    }

    applyEatTransform(matrix, remainingTicks, partialTicks, durationTicks) {
        const useTicks = (remainingTicks - partialTicks) + 1;
        const useProgress = useTicks / Math.max(1, durationTicks);

        if (useProgress < 0.8) {
            const jiggle = Math.abs(Math.cos(useTicks / 4 * Math.PI)) * 0.1;
            matrix.multiply(this.transformMatrix.makeTranslation(0, jiggle, 0));
        }

        const animation = 1 - Math.pow(useProgress, 27);
        matrix.multiply(this.transformMatrix.makeTranslation(
            animation * 0.6,
            animation * -0.5,
            0
        ));
        matrix.multiply(this.transformMatrix.makeRotationY(animation * 90 * Math.PI / 180));
        matrix.multiply(this.transformMatrix.makeRotationX(animation * 10 * Math.PI / 180));
        matrix.multiply(this.transformMatrix.makeRotationZ(animation * 30 * Math.PI / 180));
    }

    applySwingTransform(matrix, swingProgress, swingType) {
        const progress = Math.max(0, Math.min(1, swingProgress));
        const type = String(swingType || 'whack').toLowerCase();
        if (type === 'none') {
            return;
        }

        if (type === 'stab') {
            const segment = (value, start, end) => Math.max(0, Math.min(1, (value - start) / (end - start)));
            const inOutSine = value => -(Math.cos(Math.PI * value) - 1) / 2;
            const outBack = value => {
                const x = value - 1;
                return 1 + 2.70158 * x * x * x + 1.70158 * x * x;
            };
            const inOutExpo = value => {
                if (value === 0 || value === 1) return value;
                return value < 0.5
                    ? Math.pow(2, 20 * value - 10) / 2
                    : (2 - Math.pow(2, -20 * value + 10)) / 2;
            };
            const a = inOutSine(segment(progress, 0, 0.05));
            const b = outBack(segment(progress, 0.05, 0.2));
            const c = inOutExpo(segment(progress, 0.4, 1));
            matrix.multiply(this.transformMatrix.makeTranslation(
                0.1 * (a - b),
                -0.075 * (a - c),
                0.65 * (a - b)
            ));
            matrix.multiply(this.transformMatrix.makeRotationX(-70 * (a - c) * Math.PI / 180));
            matrix.multiply(this.transformMatrix.makeTranslation(0, 0, -0.25 * (c - b)));
            return;
        }

        const sqrtSwing = Math.sqrt(progress);
        const sinSqrtSwing = Math.sin(sqrtSwing * Math.PI);
        matrix.multiply(this.transformMatrix.makeTranslation(
            -0.4 * sinSqrtSwing,
            0.2 * Math.sin(sqrtSwing * Math.PI * 2),
            -0.2 * Math.sin(progress * Math.PI)
        ));
        matrix.multiply(this.transformMatrix.makeRotationY((45 - 20 * Math.sin(progress * progress * Math.PI)) * Math.PI / 180));
        matrix.multiply(this.transformMatrix.makeRotationZ(-20 * sinSqrtSwing * Math.PI / 180));
        matrix.multiply(this.transformMatrix.makeRotationX(-80 * sinSqrtSwing * Math.PI / 180));
        matrix.multiply(this.transformMatrix.makeRotationY(-Math.PI / 4));
    }

    render(renderer) {
        if (!this.cameraGroup.visible) return;

        const size = renderer.getSize(this.viewportSize);
        const aspect = size.width / Math.max(1, size.height);
        if (this.camera.aspect !== aspect) {
            this.camera.aspect = aspect;
            this.camera.updateProjectionMatrix();
        }

        this.scene.updateMatrixWorld(true);
        renderer.clearDepth();
        renderer.render(this.scene, this.camera);
    }
}
