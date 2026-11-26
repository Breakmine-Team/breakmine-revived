import EntityRenderer from "../EntityRenderer.js";
import BallEntity from "../../../entity/BallEntity.js";
import * as THREE from "../../../../../../../../libraries/three.module.js";

const BALL_TEXTURE = "ball";
const SEGMENTS = 16;
const RINGS = 12;

// Entities are lit by their own baked vertex colours, so the ball gets a fixed
// top-left sun direction baked into the sphere instead of a scene light.
const SUN_DIRECTION = new THREE.Vector3(-0.45, 0.8, 0.35).normalize();

export default class BallRenderer extends EntityRenderer {

    constructor(worldRenderer) {
        super(null);
        this.worldRenderer = worldRenderer;
        this.mesh = null;
        this.geometry = null;
        this.rolling = new THREE.Quaternion();
        this.rollAxis = new THREE.Vector3();
        this.rollDelta = new THREE.Quaternion();
        this.shadeVector = new THREE.Vector3();
    }

    buildMesh() {
        const geometry = new THREE.SphereGeometry(BallEntity.RADIUS, SEGMENTS, RINGS);
        this.geometry = geometry;

        const atlas = this.worldRenderer.textureAtlas;
        if (atlas && atlas.isLoaded()) {
            // The sphere's uvs span 0..1, so squeeze them into the ball tile.
            // Atlas uvs are in image space while the texture is uploaded
            // flipped, so v has to be converted the way block faces do it.
            const uvs = atlas.getUVs(BALL_TEXTURE);
            const minV = 1 - uvs.maxV;
            const maxV = 1 - uvs.minV;
            const uv = geometry.attributes.uv;
            for (let i = 0; i < uv.count; i++) {
                uv.setXY(
                    i,
                    uvs.minU + uv.getX(i) * (uvs.maxU - uvs.minU),
                    minV + uv.getY(i) * (maxV - minV)
                );
            }
            uv.needsUpdate = true;
        }

        geometry.setAttribute(
            "color",
            new THREE.BufferAttribute(new Float32Array(geometry.attributes.normal.count * 3), 3)
        );
        this.updateShading();

        const material = new THREE.MeshBasicMaterial({
            map: atlas && atlas.isLoaded() ? atlas.getTexture() : null,
            vertexColors: true
        });

        this.mesh = new THREE.Mesh(geometry, material);
        this.mesh.frustumCulled = false;
        this.group.add(this.mesh);
    }

    render(entity, partialTicks) {
        if (entity.isDead) {
            this.group.visible = false;
            return;
        }

        if (this.mesh === null) {
            this.buildMesh();
        }

        const x = entity.prevX + (entity.x - entity.prevX) * partialTicks;
        const y = entity.prevY + (entity.y - entity.prevY) * partialTicks;
        const z = entity.prevZ + (entity.z - entity.prevZ) * partialTicks;

        // Entity positions are the bottom of the bounding box, the sphere is
        // centred on it.
        this.group.position.set(x, y + BallEntity.RADIUS, z);

        const deltaX = entity.x - entity.prevX;
        const deltaZ = entity.z - entity.prevZ;
        const distance = Math.sqrt(deltaX * deltaX + deltaZ * deltaZ);
        if (distance > 1e-5) {
            // Rolling forward around the axis perpendicular to the movement.
            this.rollAxis.set(deltaZ, 0.0, -deltaX).normalize();
            this.rollDelta.setFromAxisAngle(this.rollAxis, distance / BallEntity.RADIUS);
            this.rolling.premultiply(this.rollDelta);
            this.mesh.quaternion.copy(this.rolling);

            // The sphere texture spins with the ball, so the baked light has to
            // be recomputed in world space or it would spin along with it.
            this.updateShading();
        } else if (this.mesh.quaternion.equals(this.rolling) === false) {
            this.mesh.quaternion.copy(this.rolling);
        }

        // The texture is a white panelled shell, so the ball's concrete colour
        // comes in as the material tint on top of the baked light.
        const brightness = entity.getEntityBrightness();
        const color = entity.color ?? 0xffffff;
        this.mesh.material.color.setRGB(
            ((color >> 16 & 255) / 255) * brightness,
            ((color >> 8 & 255) / 255) * brightness,
            ((color & 255) / 255) * brightness
        );

        this.group.visible = true;
    }

    updateShading() {
        const normals = this.geometry.attributes.normal;
        const colors = this.geometry.attributes.color;

        for (let i = 0; i < normals.count; i++) {
            this.shadeVector
                .set(normals.getX(i), normals.getY(i), normals.getZ(i))
                .applyQuaternion(this.rolling);

            const dot = this.shadeVector.x * SUN_DIRECTION.x
                + this.shadeVector.y * SUN_DIRECTION.y
                + this.shadeVector.z * SUN_DIRECTION.z;
            const shade = 0.55 + 0.45 * Math.max(0.0, dot);

            colors.setXYZ(i, shade, shade, shade);
        }

        colors.needsUpdate = true;
    }
}
