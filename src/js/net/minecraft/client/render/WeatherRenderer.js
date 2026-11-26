import * as THREE from "../../../../../../libraries/three.module.js";

const RAIN_RADIUS = 3;              // 7x7 block footprint centred on the player
const DROPS_PER_COLUMN = 10;
const COLUMN_COUNT = (RAIN_RADIUS * 2 + 1) * (RAIN_RADIUS * 2 + 1) - 1;  // player's own column excluded
const DROP_COUNT = COLUMN_COUNT * DROPS_PER_COLUMN;
const SPAWN_ABOVE = 12;             // drops spawn up to this far above the surface

export default class WeatherRenderer {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.columns = [];
        for (let dx = -RAIN_RADIUS; dx <= RAIN_RADIUS; dx++) {
            for (let dz = -RAIN_RADIUS; dz <= RAIN_RADIUS; dz++) {
                // Never rain in the column the player is standing in.
                if (dx === 0 && dz === 0) {
                    continue;
                }
                this.columns.push({ dx, dz });
            }
        }

        this.drops = [];
        for (let i = 0; i < DROP_COUNT; i++) {
            this.drops.push({
                x: 0,
                y: 0,
                z: 0,
                ground: 0,
                speed: 20,
                length: 1,
                flip: false,
                active: false
            });
        }

        this.positions = new Float32Array(DROP_COUNT * 12);
        this.uvs = new Float32Array(DROP_COUNT * 8);
        this.indices = new Uint16Array(DROP_COUNT * 6);

        for (let i = 0; i < DROP_COUNT; i++) {
            const vertex = i * 4;
            const index = i * 6;
            this.indices[index] = vertex;
            this.indices[index + 1] = vertex + 1;
            this.indices[index + 2] = vertex + 2;
            this.indices[index + 3] = vertex;
            this.indices[index + 4] = vertex + 2;
            this.indices[index + 5] = vertex + 3;
        }

        this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
        this.uvAttribute = new THREE.BufferAttribute(this.uvs, 2);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute('position', this.positionAttribute);
        this.geometry.setAttribute('uv', this.uvAttribute);
        this.geometry.setIndex(new THREE.BufferAttribute(this.indices, 1));

        this.texture = minecraft.getThreeTexture('misc/rain.png');

        this.material = new THREE.MeshBasicMaterial({
            map: this.texture || null,
            color: 0xffffff,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            side: THREE.DoubleSide,
            fog: true
        });

        this.mesh = new THREE.Mesh(this.geometry, this.material);
        // Rain quads are blended and depth-write free, so they must never be
        // rendered into the shadow map.
        this.mesh.userData.isTranslucent = true;
        this.mesh.frustumCulled = false;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.renderOrder = 900;
        this.mesh.visible = false;

        this.right = new THREE.Vector3();

        this.surfaceHeights = null;
        this.columnBlockX = null;
        this.columnBlockZ = null;
        this.activeWorld = null;
        this.surfaceMissing = false;
        this.surfaceRetryAt = 0;

        this.lastTime = performance.now();
    }

    // Top face of the highest solid block in this column, so rain lands on the
    // world surface instead of falling through roofs or into caves.
    findSurfaceHeight(x, z) {
        const world = this.minecraft.world;
        const chunk = world.getChunkAt(x >> 4, z >> 4);
        if (!chunk) {
            return null;
        }

        const topLayer = chunk.sections.length - 1;

        for (let layer = topLayer; layer >= 0; layer--) {
            const section = chunk.getSection(layer);
            if (!section || section.isEmpty()) {
                continue;
            }

            for (let y = 15; y >= 0; y--) {
                const blockY = (layer << 4) + y;
                if (world.isSolidBlockAt(x, blockY, z)) {
                    return blockY + 1;
                }
            }
        }

        return null;
    }

    updateColumns(blockX, blockZ, force = false) {
        if (!force && blockX === this.columnBlockX && blockZ === this.columnBlockZ) {
            return;
        }

        this.columnBlockX = blockX;
        this.columnBlockZ = blockZ;
        this.surfaceHeights = new Array(COLUMN_COUNT);
        this.surfaceMissing = false;

        for (let i = 0; i < COLUMN_COUNT; i++) {
            const column = this.columns[i];
            const surface = this.findSurfaceHeight(blockX + column.dx, blockZ + column.dz);
            this.surfaceHeights[i] = surface;
            if (surface === null) {
                this.surfaceMissing = true;
            }
        }
    }

    respawnDrop(drop, index, surface) {
        const column = this.columns[index % COLUMN_COUNT];
        const blockX = this.columnBlockX + column.dx;
        const blockZ = this.columnBlockZ + column.dz;

        drop.ground = surface;
        drop.x = blockX + Math.random();
        drop.z = blockZ + Math.random();
        drop.speed = 18 + Math.random() * 10;
        drop.length = 0.7 + Math.random() * 1.1;
        drop.y = surface + 1 + Math.random() * SPAWN_ABOVE;
        drop.active = true;
        drop.flip = Math.random() < 0.5;

        const uv = index * 8;
        if (drop.flip) {
            this.uvs[uv] = 1;
            this.uvs[uv + 1] = 1;
            this.uvs[uv + 2] = 0;
            this.uvs[uv + 3] = 1;
            this.uvs[uv + 4] = 0;
            this.uvs[uv + 5] = 0;
            this.uvs[uv + 6] = 1;
            this.uvs[uv + 7] = 0;
        } else {
            this.uvs[uv] = 0;
            this.uvs[uv + 1] = 1;
            this.uvs[uv + 2] = 1;
            this.uvs[uv + 3] = 1;
            this.uvs[uv + 4] = 1;
            this.uvs[uv + 5] = 0;
            this.uvs[uv + 6] = 0;
            this.uvs[uv + 7] = 0;
        }
        this.uvAttribute.needsUpdate = true;
    }

    hideDrop(index) {
        const offset = index * 12;
        for (let i = 0; i < 12; i++) {
            this.positions[offset + i] = 0;
        }
        return offset;
    }

    update() {
        const world = this.minecraft.world;
        if (!world) {
            this.mesh.visible = false;
            return;
        }

        const strength = world.rainStrength || 0;
        const visible = strength > 0.01 && world.worldType !== "hellish";
        this.mesh.visible = visible;

        if (!visible) {
            this.material.opacity = 0;
            this.lastTime = performance.now();
            return;
        }

        if (this.activeWorld !== world) {
            this.activeWorld = world;
            this.surfaceHeights = null;
            this.columnBlockX = null;
            this.columnBlockZ = null;
        }

        const now = performance.now();
        let delta = (now - this.lastTime) / 1000;
        this.lastTime = now;
        if (!Number.isFinite(delta) || delta < 0) {
            delta = 0;
        }
        delta = Math.min(delta, 0.1);

        const camera = this.minecraft.worldRenderer?.camera;
        if (!camera) {
            this.mesh.visible = false;
            return;
        }

        const player = this.minecraft.player;
        const centerX = player && Number.isFinite(player.x) ? player.x : camera.position.x;
        const centerZ = player && Number.isFinite(player.z) ? player.z : camera.position.z;
        const blockX = Math.floor(centerX);
        const blockZ = Math.floor(centerZ);

        this.updateColumns(blockX, blockZ);

        // Columns whose chunks had not arrived yet are retried periodically, so
        // rain still shows up when the player joins and never crosses a block.
        if (this.surfaceMissing && now - this.surfaceRetryAt > 200) {
            this.surfaceRetryAt = now;
            this.updateColumns(blockX, blockZ, true);
        }

        // Quads stay upright and face the camera horizontally, so the rain
        // texture is always seen straight on regardless of camera pitch.
        this.right.setFromMatrixColumn(camera.matrixWorld, 0);
        this.right.y = 0;
        if (this.right.lengthSq() < 0.000001) {
            this.right.set(1, 0, 0);
        }
        this.right.normalize();

        const thunder = world.thunderStrength || 0;
        this.material.opacity = (0.62 + 0.2 * thunder) * strength;

        const positions = this.positions;
        for (let i = 0; i < DROP_COUNT; i++) {
            const drop = this.drops[i];
            const columnIndex = i % COLUMN_COUNT;
            const surface = this.surfaceHeights[columnIndex];

            // Unloaded chunks have no surface to land on, so skip their columns.
            if (surface === null) {
                drop.active = false;
                this.hideDrop(i);
                continue;
            }

            const offsetColumnX = Math.floor(drop.x) - blockX;
            const offsetColumnZ = Math.floor(drop.z) - blockZ;
            const inFootprint = Math.abs(offsetColumnX) <= RAIN_RADIUS
                && Math.abs(offsetColumnZ) <= RAIN_RADIUS
                && !(offsetColumnX === 0 && offsetColumnZ === 0);

            if (!drop.active || !inFootprint || drop.y < drop.ground) {
                this.respawnDrop(drop, i, surface);
            }

            drop.y -= drop.speed * delta;

            // rain.png is 64x256, so the quad keeps its 1:4 aspect ratio.
            const height = drop.length * 2.6;
            const halfWidth = height * 0.125;
            const offsetX = this.right.x * halfWidth;
            const offsetZ = this.right.z * halfWidth;
            const topY = drop.y + height;

            const offset = i * 12;
            positions[offset] = drop.x - offsetX;
            positions[offset + 1] = drop.y;
            positions[offset + 2] = drop.z - offsetZ;
            positions[offset + 3] = drop.x + offsetX;
            positions[offset + 4] = drop.y;
            positions[offset + 5] = drop.z + offsetZ;
            positions[offset + 6] = drop.x + offsetX;
            positions[offset + 7] = topY;
            positions[offset + 8] = drop.z + offsetZ;
            positions[offset + 9] = drop.x - offsetX;
            positions[offset + 10] = topY;
            positions[offset + 11] = drop.z - offsetZ;
        }

        this.positionAttribute.needsUpdate = true;
    }
}
