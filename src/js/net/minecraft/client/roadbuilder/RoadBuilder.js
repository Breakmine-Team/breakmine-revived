import * as THREE from "../../../../../../libraries/three.module.js";
import Block from "../world/block/Block.js";
import BlockPosition from "../../util/BlockPosition.js";
import { BlockRegistry } from "../world/block/BlockRegistry.js";

const MIN_WIDTH = 1;
const MAX_WIDTH = 15;
const MAX_ROAD_BLOCKS = 8192;

const LAYERS_PER_BLOCK = 8;
const SLOPE_START = 1 / 16;

export default class RoadBuilder {

    constructor(minecraft) {
        this.minecraft = minecraft;

        this.start = null;
        this.width = 3;
        this.variantIndex = 0;

        this.world = null;

        this.previewGroup = new THREE.Group();
        this.previewGroup.visible = false;
        this.previewMesh = null;
        this.previewKey = null;
        this.previewMaterial = null;
        this.templateGeometries = new Map();
    }

    get variants() {
        return [
            {
                name: "Black",
                blockId: BlockRegistry.PAVEMENT_BLACK.id,
                slopeBlockId: BlockRegistry.PAVEMENT_BLACK_SLOPE.id
            },
            {
                name: "White",
                blockId: BlockRegistry.PAVEMENT_WHITE.id,
                slopeBlockId: BlockRegistry.PAVEMENT_WHITE_SLOPE.id
            }
        ];
    }

    getVariant() {
        const variants = this.variants;
        return variants[this.variantIndex % variants.length];
    }

    isToolSelected() {
        const player = this.minecraft.player;
        if (!player || !player.inventory) {
            return false;
        }

        const heldItem = player.inventory.getItemInSelectedSlot();
        if (!heldItem || heldItem.isEmpty()) {
            return false;
        }

        return Block.getById(heldItem.getType())?.isRoadBuilder === true;
    }

    /** + or - while the tool is held. */
    adjustWidth(delta) {
        if (!delta) {
            return;
        }

        const next = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, this.width + Math.sign(delta)));
        if (next === this.width) {
            return;
        }

        this.width = next;
        this.previewKey = null;
        this.minecraft.addMessageToChat(`§aRoad width: §f${this.width}`);
    }

    /** R while the tool is held. */
    cycleVariant() {
        const variants = this.variants;
        this.variantIndex = (this.variantIndex + 1) % variants.length;
        this.previewKey = null;
        this.minecraft.addMessageToChat(`§aRoad variant: §f${this.getVariant().name}`);
    }

    handleUse(world, x, y, z, hitFace) {
        if (!world || world.isFieldLocalWorld) {
            return;
        }
        if (x === undefined || y === undefined || z === undefined) {
            return;
        }

        if (this.world !== world) {
            this.world = world;
            this.start = null;
            this.previewKey = null;
        }

        const point = { x, y, z };
        const player = this.minecraft.player;

        if (this.start === null) {
            this.start = point;
            this.previewKey = null;
            this.minecraft.addMessageToChat(
                `§aRoad start: §f${x} ${y} ${z}§a. Width §f${this.width}§a, variant §f${this.getVariant().name}§a. +/- for width, R for variant, right-click the other end.`
            );
            if (player) {
                player.swingArm();
            }
            return;
        }

        if (!this.isValidPath(this.start, point)) {
            if (this.start.x === point.x && this.start.z === point.z) {
                this.minecraft.addMessageToChat(
                    "§cRoad needs two different horizontal positions."
                );
            } else {
                this.minecraft.addMessageToChat(
                    "§cRoad is too steep. Slopes may rise or fall at most one block per block."
                );
            }
            return;
        }

        const cells = this.getCells(this.start, point, this.width);
        const placements = this.getPlacements(cells);
        if (placements.length > MAX_ROAD_BLOCKS) {
            this.minecraft.addMessageToChat(
                `§cRoad is too large (${placements.length} blocks, max ${MAX_ROAD_BLOCKS}).`
            );
            return;
        }

        const placed = this.build(world, placements);
        this.minecraft.addMessageToChat(
            `§aBuilt ${placed} road block${placed === 1 ? "" : "s"} (width ${this.width}, ${this.getVariant().name}).`
        );

        this.start = null;
        this.previewKey = null;
        this.hidePreview();

        if (player) {
            player.swingArm();
        }
    }

    isValidPath(start, end) {
        if (!start || !end) {
            return false;
        }

        const dx = end.x - start.x;
        const dz = end.z - start.z;
        const horizontal = Math.hypot(dx, dz);
        if (horizontal < 1e-6) {
            return false;
        }

        // 45 degrees is the steepest road that can be built without holes.
        return Math.abs(end.y - start.y) <= horizontal + 1e-6;
    }

    /**
     * Sample the centre line and stamp a width-wide cross-section at every
     * step. Each cell carries the interpolated top surface height, so both
     * diagonal roads and roads that climb/descend are handled by the same
     * pass.
     */
    getCells(start, end, width) {
        const x0 = start.x + 0.5;
        const z0 = start.z + 0.5;
        const x1 = end.x + 0.5;
        const z1 = end.z + 0.5;

        const dx = x1 - x0;
        const dz = z1 - z0;
        const length = Math.hypot(dx, dz);

        const cells = new Map();
        if (length < 1e-6) {
            return cells;
        }

        const dirX = dx / length;
        const dirZ = dz / length;
        const perpX = -dirZ;
        const perpZ = dirX;

        const half = width >> 1;
        const firstOffset = -half;
        const lastOffset = width - 1 - half;

        const startTop = start.y + 1;
        const endTop = end.y + 1;
        const step = 0.5;
        const steps = Math.max(1, Math.ceil(length / step));

        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const centerX = x0 + dx * t;
            const centerZ = z0 + dz * t;
            const surface = startTop + (endTop - startTop) * t;

            for (let offset = firstOffset; offset <= lastOffset; offset++) {
                const x = Math.floor(centerX + perpX * offset);
                const z = Math.floor(centerZ + perpZ * offset);
                cells.set(`${x},${z}`, { x, z, surface });
            }
        }

        return cells;
    }

    /**
     * Resolve road cells into concrete block states. A full pavement block
     * forms the base; a fractional surface height is filled with a pavement
     * slope layer (1-8 layers) on top of it.
     */
    getPlacements(cells) {
        const variant = this.getVariant();
        const placements = new Map();

        const add = (x, y, z, typeId, data) => {
            placements.set(`${x},${y},${z}`, { x, y, z, typeId, data });
        };

        for (const cell of cells.values()) {
            const surface = cell.surface;
            const floor = Math.floor(surface);
            const fraction = surface - floor;

            if (fraction >= 1 - SLOPE_START) {
                add(cell.x, floor, cell.z, variant.blockId, 0);
                continue;
            }

            add(cell.x, floor - 1, cell.z, variant.blockId, 0);

            const layers = Math.round(fraction * LAYERS_PER_BLOCK);
            if (layers > 0) {
                add(
                    cell.x,
                    floor,
                    cell.z,
                    variant.slopeBlockId,
                    Math.min(LAYERS_PER_BLOCK - 1, layers - 1)
                );
            }
        }

        return [...placements.values()];
    }

    build(world, placements) {
        const worldHeight = world.constructor?.TOTAL_HEIGHT ?? 256;
        let placed = 0;

        for (const placement of placements) {
            if (placement.y < 0 || placement.y >= worldHeight) {
                continue;
            }
            if (world.getBlockAt(placement.x, placement.y, placement.z) === placement.typeId &&
                world.getBlockDataAt(placement.x, placement.y, placement.z) === placement.data) {
                continue;
            }

            world.setBlockAt(placement.x, placement.y, placement.z, placement.typeId, placement.data);
            this.notifyServer(world, placement);
            placed++;
        }

        return placed;
    }

    /**
     * The server only knows about the tool item, so each road block is sent as
     * a normal block placement. The clicked cell is the one below the target
     * and the top face selects the target Y. The optional trailing metadata
     * byte preserves slope layer counts in multiplayer.
     */
    notifyServer(world, placement) {
        const minecraft = this.minecraft;
        if (!minecraft || minecraft.isSingleplayer()) {
            return;
        }

        const controller = minecraft.playerController;
        if (!controller || typeof controller.sendBlockPlacementPacket !== "function") {
            return;
        }
        if (placement.y <= 0) {
            return;
        }

        controller.sendBlockPlacementPacket(
            new BlockPosition(placement.x, placement.y - 1, placement.z),
            1,
            { id: placement.typeId },
            placement.data
        );
    }

    updatePreview(worldRenderer, player) {
        const scene = worldRenderer.scene;
        if (scene && this.previewGroup.parent !== scene) {
            if (this.previewGroup.parent) {
                this.previewGroup.parent.remove(this.previewGroup);
            }
            scene.add(this.previewGroup);
        }

        if (this.world !== this.minecraft.world) {
            this.world = this.minecraft.world;
            this.start = null;
            this.previewKey = null;
        }

        if (!player || player.spectator || !this.minecraft.settings.showPreview || !this.isToolSelected() || this.start === null) {
            this.hidePreview();
            return;
        }

        const hit = worldRenderer.lastHitResult;
        if (!hit || hit.fieldCell) {
            this.hidePreview();
            return;
        }

        // Build into the selected block, not into the cell in front of its
        // clicked face.
        const end = { x: hit.x, y: hit.y, z: hit.z };

        if (!this.isValidPath(this.start, end)) {
            this.hidePreview();
            return;
        }

        const key = `${this.start.x},${this.start.y},${this.start.z}|${end.x},${end.y},${end.z}|${this.width}|${this.variantIndex}`;
        if (key === this.previewKey) {
            this.previewGroup.visible = true;
            return;
        }

        const cells = this.getCells(this.start, end, this.width);
        const placements = this.getPlacements(cells);
        if (placements.length > MAX_ROAD_BLOCKS) {
            this.hidePreview();
            return;
        }

        this.rebuildPreview(worldRenderer, placements);
        this.previewKey = key;
    }

    hidePreview() {
        this.previewGroup.visible = false;
    }

    rebuildPreview(worldRenderer, placements) {
        if (this.previewMesh !== null) {
            this.previewGroup.remove(this.previewMesh);
            this.previewMesh.dispose();
            this.previewMesh = null;
        }

        const geometry = this.getTemplateGeometry(worldRenderer, this.getVariant().blockId);
        if (!geometry) {
            this.hidePreview();
            return;
        }

        const material = this.getPreviewMaterial(worldRenderer);
        const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
        const matrix = new THREE.Matrix4();

        for (let i = 0; i < placements.length; i++) {
            const placement = placements[i];
            const isSlope = placement.typeId === this.getVariant().slopeBlockId;
            const height = isSlope
                ? (((placement.data & 7) + 1) / LAYERS_PER_BLOCK)
                : 1;

            matrix.makeScale(1, height, 1);
            matrix.setPosition(placement.x + 0.5, placement.y + height / 2, placement.z + 0.5);
            mesh.setMatrixAt(i, matrix);
        }

        mesh.instanceMatrix.needsUpdate = true;
        mesh.renderOrder = 10000;
        this.previewGroup.add(mesh);
        this.previewMesh = mesh;
        this.previewGroup.visible = true;
    }

    getTemplateGeometry(worldRenderer, blockId) {
        if (this.templateGeometries.has(blockId)) {
            return this.templateGeometries.get(blockId);
        }

        const block = Block.getById(blockId);
        if (!block) {
            return null;
        }

        const group = new THREE.Group();
        const mesh = worldRenderer.blockRenderer.renderBlockInNullWorld(group, block, 1);
        if (!mesh) {
            return null;
        }

        const geometry = mesh.geometry;
        group.remove(mesh);
        if (mesh.material && typeof mesh.material.dispose === "function") {
            mesh.material.dispose();
        }

        this.templateGeometries.set(blockId, geometry);
        return geometry;
    }

    getPreviewMaterial(worldRenderer) {
        if (this.previewMaterial === null) {
            const material = worldRenderer.blockRenderer.getUnlitGUIMaterial(
                0.1,
                worldRenderer.blockRenderer.tessellator
            );
            material.opacity = 0.45;
            material.transparent = true;
            material.depthWrite = false;
            this.previewMaterial = material;
        }

        // The atlas texture can be rebound after a texture-pack change.
        const atlasTexture = worldRenderer.blockRenderer.tessellator.unlitMaterial.map;
        if (this.previewMaterial.map !== atlasTexture) {
            this.previewMaterial.map = atlasTexture;
            this.previewMaterial.needsUpdate = true;
        }

        return this.previewMaterial;
    }
}
