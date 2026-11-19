import * as THREE from "../../../../../../libraries/three.module.js";
import Block from "../world/block/Block.js";

// Renders the blocks that World.blockAnimations is currently moving. The world
// cell is already cleared while an animation runs, so this draws a one-off mesh
// of the block and slides it from the source cell to the destination cell.
export default class BlockAnimationRenderer {

    constructor(minecraft) {
        this.minecraft = minecraft;
        this.world = null;

        this.group = new THREE.Group();
        this.group.matrixAutoUpdate = false;
        this.group.updateMatrix();

        this.holders = new Map();
    }

    attachToScene() {
        const scene = this.minecraft?.worldRenderer?.scene;
        if (scene && this.group.parent !== scene) {
            scene.add(this.group);
        }
    }

    clear() {
        for (const animation of [...this.holders.keys()]) {
            this.disposeHolder(animation);
        }
    }

    disposeHolder(animation) {
        const holder = this.holders.get(animation);
        if (!holder) return;

        for (const mesh of [...holder.children]) {
            holder.remove(mesh);
            if (mesh.geometry) mesh.geometry.dispose();
            if (mesh.material) {
                if (Array.isArray(mesh.material)) {
                    mesh.material.forEach(material => material.dispose());
                } else {
                    mesh.material.dispose();
                }
            }
        }

        this.group.remove(holder);
        this.holders.delete(animation);
    }

    update() {
        const world = this.minecraft?.world || null;
        if (world !== this.world) {
            this.clear();
            this.world = world;
        }

        if (!world || !Array.isArray(world.blockAnimations) || world.blockAnimations.length === 0) {
            this.clear();
            return;
        }

        this.attachToScene();

        const now = typeof performance !== "undefined" && typeof performance.now === "function"
            ? performance.now()
            : Date.now();
        const animations = world.blockAnimations;

        for (const animation of [...this.holders.keys()]) {
            if (!animations.includes(animation)) {
                this.disposeHolder(animation);
            }
        }

        // Iterate a copy: finishing an animation removes it from the world list.
        for (const animation of [...animations]) {
            let holder = this.holders.get(animation);
            if (!holder) {
                holder = this.buildHolder(animation);
                if (!holder) continue;
                this.holders.set(animation, holder);
            }

            const progress = animation.duration > 0
                ? Math.min(1, Math.max(0, (now - animation.startTime) / animation.duration))
                : 1;

            const base = holder.userData.base;
            holder.position.set(
                base.x + (animation.toX - animation.fromX) * progress,
                base.y + (animation.toY - animation.fromY) * progress,
                base.z + (animation.toZ - animation.fromZ) * progress
            );

            if (progress >= 1) {
                this.disposeHolder(animation);
                if (typeof world.finishBlockAnimation === "function") {
                    world.finishBlockAnimation(animation);
                }
            }
        }
    }

    buildHolder(animation) {
        const world = this.minecraft?.world;
        const blockRenderer = this.minecraft?.worldRenderer?.blockRenderer;
        if (!world || !blockRenderer) return null;

        const block = Block.getById(animation.blockId);
        if (!block) return null;

        // Block geometry is built relative to the section origin, so the holder
        // sits at the origin of the source section and slides from there.
        const base = {
            x: (animation.fromX >> 4) << 4,
            y: (animation.fromY >> 4) << 4,
            z: (animation.fromZ >> 4) << 4
        };

        const holder = new THREE.Group();
        holder.position.set(base.x, base.y, base.z);
        holder.userData.base = base;
        this.group.add(holder);

        const renderWorld = this.createRenderWorld(
            world, block, animation.data, animation.fromX, animation.fromY, animation.fromZ);

        const tessellator = blockRenderer.tessellator;
        tessellator.startDrawing();
        tessellator.setRenderingPass(block.isTranslucent());
        blockRenderer.beginModelPass();
        blockRenderer.renderBlock(renderWorld, block, false,
            animation.fromX, animation.fromY, animation.fromZ);

        if (tessellator.addedVertices > 0) {
            tessellator.draw(holder);
        }
        blockRenderer.flushModelPasses(holder);

        if (holder.children.length === 0) {
            this.group.remove(holder);
            return null;
        }

        if (block.isTranslucent()) {
            for (const mesh of holder.children) {
                if (!mesh.material) continue;
                mesh.material.transparent = true;
                mesh.material.depthWrite = false;
                mesh.renderOrder = 10000;
            }
        }

        // Tessellator.draw() disables matrix auto updates on the target group;
        // this holder moves every frame, so keep its matrix live.
        holder.matrixAutoUpdate = true;
        holder.updateMatrix();

        return holder;
    }

    // The source cell is empty while the block moves, so make the renderer see
    // the moving block at its old position for textures, culling and data.
    createRenderWorld(world, block, data, px, py, pz) {
        const isTarget = (x, y, z) => x === px && y === py && z === pz;

        return new Proxy(world, {
            get(target, prop) {
                switch (prop) {
                    case "getBlockAt":
                        return (x, y, z) => isTarget(x, y, z) ? block.id : target.getBlockAt(x, y, z);
                    case "getBlockDataAt":
                        return (x, y, z) => isTarget(x, y, z) ? data : target.getBlockDataAt(x, y, z);
                    default:
                        return target[prop];
                }
            }
        });
    }
}
