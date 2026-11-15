import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

const PX = 1 / 16;

// 2x2 pixels wide, centred in the block.
const POLE_MIN = PX * 7;
const POLE_MAX = PX * 9;

const POLE_COLOR = 0x939393;

// Rendered as a flat white texture that is tinted to POLE_COLOR.
const POLE_TEXTURE = "blank_white";

class PolePart {
    getTextureForFace() {
        return POLE_TEXTURE;
    }

    getRotationForFace() {
        return 0;
    }

    getColor() {
        return POLE_COLOR;
    }

    isTranslucent() {
        return false;
    }

    // The pole is thin, so it must not hide the faces of neighbouring blocks.
    occludesNeighborFaces() {
        return false;
    }
}

const POLE_PART = new PolePart();

const CORE = new BoundingBox(POLE_MIN, 0, POLE_MIN, POLE_MAX, 1, POLE_MAX);

const SIDES = [
    {dx: -1, dz: 0},
    {dx: 1, dz: 0},
    {dx: 0, dz: -1},
    {dx: 0, dz: 1}
];

function armBoundingBox(dx, dz) {
    if (dx === -1) {
        return new BoundingBox(0, POLE_MIN, POLE_MIN, POLE_MIN, POLE_MAX, POLE_MAX);
    }
    if (dx === 1) {
        return new BoundingBox(POLE_MAX, POLE_MIN, POLE_MIN, 1, POLE_MAX, POLE_MAX);
    }
    if (dz === -1) {
        return new BoundingBox(POLE_MIN, POLE_MIN, 0, POLE_MAX, POLE_MAX, POLE_MIN);
    }
    return new BoundingBox(POLE_MIN, POLE_MIN, POLE_MAX, POLE_MAX, POLE_MAX, 1);
}

export default class BlockPole extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Pole";
        this.hardness = 0.5;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;

        this.boundingBox = CORE;
        this.multipart = true;
        this.noFaceCull = true;
        this.isPole = true;
    }

    getTextureForFace() {
        return POLE_TEXTURE;
    }

    getColor() {
        return POLE_COLOR;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getOpacity() {
        return 0;
    }

    // Vertical poles line up through the full-height core, horizontal ones join
    // through a 2x2 arm at mid height so neighbours read as one continuous run.
    getMultipart(world, x, y, z) {
        const parts = [
            ["blockClass", 0, {block: POLE_PART, bbox: CORE}]
        ];

        if (world === null || world === undefined) {
            return parts;
        }

        for (const {dx, dz} of SIDES) {
            const neighbor = Block.getById(world.getBlockAt(x + dx, y, z + dz));
            if (neighbor === null || neighbor.isPole !== true) {
                continue;
            }
            parts.push(["blockClass", 0, {block: POLE_PART, bbox: armBoundingBox(dx, dz)}]);
        }

        return parts;
    }

    onBlockAdded(world, x, y, z) {
        this.refreshNeighbors(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        this.refreshNeighbors(world, x, y, z);
    }

    refreshNeighbors(world, x, y, z) {
        if (!world || typeof world.onBlockChanged !== "function") {
            return;
        }

        for (const {dx, dz} of SIDES) {
            world.onBlockChanged(x + dx, y, z + dz);
        }
        world.onBlockChanged(x, y - 1, z);
        world.onBlockChanged(x, y + 1, z);
    }
}
