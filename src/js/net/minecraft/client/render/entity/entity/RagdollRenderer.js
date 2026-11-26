import EntityRenderer from "../EntityRenderer.js";
import ModelRenderer from "../../model/renderer/ModelRenderer.js";
import * as AuthLib from "../../../network/AuthLib.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";

const MODEL_SCALE = 7.0 / 120.0;

// The player model is built with Y pointing down and X mirrored. A child turned
// half a turn around Z and scaled by MODEL_SCALE maps the model's own axes onto
// blocks, so a body transform can drive its part directly.
const MODEL_ORIENTATION = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);

// Vanilla player part layout: the same boxes, texture offsets and mirroring the
// default skin uses, with each part hanging off its own rotation point.
const PART_DEFINITIONS = [
    {
        name: "head",
        create: () => new ModelRenderer("head", 64, 32)
            .setTextureOffset(0, 0)
            .addBox(-4.0, -8.0, -4.0, 8, 8, 8)
    },
    {
        name: "body",
        create: () => new ModelRenderer("body", 64, 32)
            .setTextureOffset(16, 16)
            .addBox(-4.0, 0.0, -2.0, 8, 12, 4)
    },
    {
        name: "rightArm",
        create: () => new ModelRenderer("right_arm", 64, 32)
            .setTextureOffset(40, 16)
            .setRotationPoint(-5.0, 2.0, 0.0)
            .addBox(-3.0, -2.0, -2.0, 4, 12, 4)
    },
    {
        name: "leftArm",
        create: () => new ModelRenderer("left_arm", 64, 32)
            .setTextureOffset(40, 16)
            .setRotationPoint(5.0, 2.0, 0.0)
            .addBox(-1.0, -2.0, -2.0, 4, 12, 4, 0, true)
    },
    {
        name: "rightLeg",
        create: () => new ModelRenderer("right_leg", 64, 32)
            .setTextureOffset(0, 16)
            .setRotationPoint(-2.0, 12.0, 0.0)
            .addBox(-2.0, 0.0, -2.0, 4, 12, 4)
    },
    {
        name: "leftLeg",
        create: () => new ModelRenderer("left_leg", 64, 32)
            .setTextureOffset(0, 16)
            .setRotationPoint(2.0, 12.0, 0.0)
            .addBox(-2.0, 0.0, -2.0, 4, 12, 4, 0, true)
    }
];

export default class RagdollRenderer extends EntityRenderer {

    constructor(worldRenderer) {
        super(null);

        this.worldRenderer = worldRenderer;

        this.texture = worldRenderer.minecraft.getThreeTexture("char.png");
        this.texture.magFilter = THREE.NearestFilter;
        this.texture.minFilter = THREE.NearestFilter;

        // A dead player's body wears the skin they had while alive.
        this.skinTextures = new Map();
        this.pendingSkinLoads = new Map();
        this.lastEntity = null;
        this.boundTexture = null;

        this.containers = {};
        this.parts = {};

        this.position = new THREE.Vector3();
        this.rotation = new THREE.Quaternion();
        this.offset = new THREE.Vector3();
        this.hurtActive = false;

        this.nametagGroup = new THREE.Object3D();
        this.nametagSprite = null;
        this.nametagTexture = null;
        this.nametagName = null;
        worldRenderer.overlay.add(this.nametagGroup);

        for (const definition of PART_DEFINITIONS) {
            // Each part lives in its own container, which the rigid body moves.
            const container = new THREE.Object3D();
            const model = new THREE.Object3D();
            model.quaternion.copy(MODEL_ORIENTATION);
            model.scale.setScalar(MODEL_SCALE);
            model.updateMatrix();

            container.add(model);
            this.group.add(container);

            this.containers[definition.name] = container;
            this.parts[definition.name] = {model: model, renderer: definition.create()};
        }
    }

    // The default skin stands in until the real one has loaded.
    getTextureForEntity(entity) {
        const username = entity && entity.displayName ? entity.displayName : null;

        if (!username) {
            return this.texture;
        }

        if (this.skinTextures.has(username)) {
            return this.skinTextures.get(username);
        }

        if (!this.pendingSkinLoads.has(username)) {
            this.pendingSkinLoads.set(username, this.loadSkinTexture(username));
        }

        return this.texture;
    }

    async loadSkinTexture(username) {
        try {
            const image = new Image();
            image.onload = () => {
                const texture = new THREE.CanvasTexture(image);
                texture.magFilter = THREE.NearestFilter;
                texture.minFilter = THREE.NearestFilter;
                texture.generateMipmaps = false;

                this.skinTextures.set(username, texture);
                this.pendingSkinLoads.delete(username);

                this.tessellator.bindTexture(texture);
                this.boundTexture = texture;
                this.group.buildMeta = undefined;
                if (this.lastEntity) {
                    this.rebuild(this.lastEntity);
                }
            };
            image.onerror = () => {
                this.pendingSkinLoads.delete(username);
                this.skinTextures.set(username, this.texture);
            };
            image.src = await AuthLib.getSkinImageUrl(username);
        } catch (error) {
            this.pendingSkinLoads.delete(username);
            this.skinTextures.set(username, this.texture);
            console.warn(`Failed to load skin for corpse ${username}:`, error);
        }
    }

    prepareModel(entity) {
        this.lastEntity = entity;

        // A fresh skin (or a body that now has a name) needs the meshes built
        // again, otherwise they keep sampling whatever was bound first.
        const texture = this.getTextureForEntity(entity);
        if (texture !== this.boundTexture) {
            this.tessellator.bindTexture(texture);
            this.boundTexture = texture;
            this.group.buildMeta = undefined;
        }

        if (this.isRebuildRequired(entity)) {
            this.rebuild(entity);
        }
    }

    rebuild(entity) {
        const meta = {};
        this.fillMeta(entity, meta);
        this.group.buildMeta = meta;

        const brightness = meta.brightness;
        this.tessellator.setColor(brightness, brightness, brightness);

        for (const name of Object.keys(this.parts)) {
            const part = this.parts[name];
            part.renderer.rebuild(this.tessellator, part.model);
        }

        // Rebuilt meshes come back white, so let the next frame re-apply a hurt
        // tint if the body is still flashing.
        this.hurtActive = false;
    }

    render(entity, partialTicks) {
        if (entity.isDead) {
            this.group.visible = false;
            return;
        }

        this.prepareModel(entity);

        for (const bone of entity.bones) {
            const container = this.containers[bone.name];
            if (!container) {
                continue;
            }

            const position = this.position.lerpVectors(bone.prevPos, bone.pos, partialTicks);
            const rotation = this.rotation.copy(bone.prevQuat).slerp(bone.quat, partialTicks);

            // The body state describes the centre of mass, while the renderer
            // needs the rotation point the model part hangs from.
            this.offset.copy(bone.center).applyQuaternion(rotation);

            container.position.copy(position).sub(this.offset);
            container.quaternion.copy(rotation);
        }

        this.applyHurtTint();
        this.renderNametag(entity, partialTicks);
        this.group.visible = true;
    }

    // Dead players keep their name floating over the body, so you know whose
    // corpse you are about to loot.
    renderNametag(entity, partialTicks) {
        const name = entity.displayName;

        if (!name) {
            this.nametagGroup.visible = false;
            return;
        }

        if (this.nametagTexture === null || this.nametagName !== name) {
            this.nametagName = name;

            const canvas = document.createElement("canvas");
            const ctx = canvas.getContext("2d");
            const fontRenderer = this.worldRenderer.minecraft.fontRenderer;

            let textWidth = 0;
            for (let i = 0; i < name.length; i++) {
                textWidth += fontRenderer.charWidths[name.charCodeAt(i)] || 6;
            }

            const padX = 4;
            const padY = 2;
            canvas.width = textWidth + padX * 2;
            canvas.height = 8 + padY * 2;

            ctx.imageSmoothingEnabled = false;
            ctx.fillStyle = "rgba(0, 0, 0, 0.4)";
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            fontRenderer.drawStringRaw(ctx, name, padX, padY, 0xFFFFFF, false, "8", false);

            if (this.nametagTexture) {
                this.nametagTexture.dispose();
            }
            this.nametagTexture = new THREE.CanvasTexture(canvas);
            this.nametagTexture.magFilter = THREE.NearestFilter;
            this.nametagTexture.minFilter = THREE.NearestFilter;
        }

        if (!this.nametagSprite) {
            this.nametagSprite = new THREE.Sprite(new THREE.SpriteMaterial({
                map: this.nametagTexture,
                transparent: true,
                depthTest: false
            }));
            this.nametagGroup.add(this.nametagSprite);
        }

        this.nametagSprite.material.map = this.nametagTexture;

        const x = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        const z = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;
        const top = entity.boundingBox ? entity.boundingBox.maxY : entity.y + 0.5;

        const worldScale = 0.016;
        this.nametagGroup.position.set(x, top + 0.35, z);
        this.nametagSprite.scale.set(
            this.nametagTexture.image.width * worldScale,
            this.nametagTexture.image.height * worldScale,
            1
        );
        this.nametagGroup.visible = true;
        this.nametagSprite.visible = true;
        this.nametagGroup.lookAt(this.worldRenderer.camera.position);
    }

    // A hit flashes the whole body red for a moment, the same way living
    // entities do, so damage is visible without moving the ragdoll.
    applyHurtTint() {
        const hurt = typeof performance !== "undefined"
            && performance.now() - this.hurtTimestamp < 300;

        if (hurt === this.hurtActive) {
            return;
        }

        this.hurtActive = hurt;

        this.group.traverse((child) => {
            if (!child.isMesh || !child.material) {
                return;
            }

            child.material.color.setHex(hurt ? 0xffaaaa : 0xffffff);
            child.material.vertexColors = hurt
                ? false
                : Boolean(child.geometry?.getAttribute?.("color"));
        });
    }
}
