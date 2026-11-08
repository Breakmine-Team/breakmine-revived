import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import BoundingBox from "../../../../util/BoundingBox.js";

/*
 * The table model.
 *
 * The shape comes from a Blockbench model: a short stub of axle under a wide,
 * flat gear case made of two thin plates, the upper one being the table itself.
 * The case is fourteen pixels across, so it sits just inside its cell.
 *
 * The whole block turns, axle and all, so a driven turntable visibly spins the
 * table, and whoever stands on it is carried round with it.
 */

const P = (pixels) => pixels / 16;

const AXLE_TEXTURE = 'spruce_log';
const CASE_TEXTURE = 'spruce_planks';
const TOP_TEXTURE = 'stone';

// Icon, break particles and any non-part rendering use the casing texture.
const TEXTURE = CASE_TEXTURE;

// [minX, minY, minZ, maxX, maxY, maxZ] in 1/16 pixels.
const AXLE = [6, 0, 6, 10, 7, 10];
const CASE_LOWER = [1, 3.9, 1, 15, 5.9, 15];
const CASE_UPPER = [1, 5.9, 1, 15, 7.9, 15];

function toBox(box) {
    const [x0, y0, z0, x1, y1, z1] = box;

    return {
        minX: P(x0), minY: P(y0), minZ: P(z0),
        maxX: P(x1), maxY: P(y1), maxZ: P(z1)
    };
}

function part(box, texture) {
    return ['texture', texture, {
        texture: texture,
        bbox: toBox(box)
    }];
}

/** The axle stub, the lower gear case and the table on top. */
function getParts() {
    return [
        part(AXLE, AXLE_TEXTURE),
        part(CASE_LOWER, CASE_TEXTURE),
        part(CASE_UPPER, TOP_TEXTURE)
    ];
}

/**
 * A turntable: a wide plate on a shaft, which carries anyone standing on it
 * round at the speed the plate is turning.
 *
 * It is a shaft part on a vertical axle, so a motor, a water wheel or a shaft
 * run drives it. Its speed reaches the player through getTurntableSpin, which
 * PlayerEntity calls each tick for the block under its feet.
 */
export default class BlockTurntable extends BlockShaftPart {

    /** One RPM is one turn a minute: 360 / 60 / 20 degrees a tick. */
    static DEGREES_PER_RPM = 0.3;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Turntable";
        this.shiftDescription = "Consumes 200 SU";
        this.hardness = 1.5;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // Read by PlayerEntity to recognise the block it is standing on.
        this.isTurntable = true;
    }

    /** The table is built from its own plates, not plain shaft parts. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return TEXTURE;
    }

    getTextureForFace(face) {
        return TEXTURE;
    }

    getMultipart(world, x, y, z) {
        return getParts();
    }

    /** The plate lies flat, whichever face it was placed against. */
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Y;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Y;
    }

    /**
     * Degrees per tick to turn the player standing on this table, or 0 when
     * nothing is driving it. Negative turns the other way.
     */
    getTurntableSpin(world, x, y, z) {
        const tick = (world && world.ticks) || 0;

        // The same speed and the same way the table itself is drawn turning,
        // so a reversed drive carries the rider round the other way.
        const rpm = this.getShaftRpm(world, x, y, z, tick);
        const direction = this.getShaftDirection(world, x, y, z, tick) < 0 ? -1 : 1;

        if (!Number.isFinite(rpm) || rpm === 0) {
            return 0;
        }

        return direction * rpm * BlockTurntable.DEGREES_PER_RPM;
    }

    /** +1 or -1: the way the table is turning right now. */
    getSpinDirection(world, x, y, z) {
        return this.getShaftDirection(world, x, y, z, (world && world.ticks) || 0) < 0 ? -1 : 1;
    }

    /** Only the table plate is solid: it stands half a block tall. */
    getBoundingBox(world, x, y, z) {
        return new BoundingBox(0.0, 0.0, 0.0, 1.0, 0.5, 1.0);
    }

    getCollisionBoundingBox(world, x, y, z) {
        return this.getBoundingBox(world, x, y, z);
    }

    getPreferredToolType() {
        return 'axe';
    }
}
