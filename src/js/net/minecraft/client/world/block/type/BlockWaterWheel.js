import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import WaterWheelRenderer from "../../../render/WaterWheelRenderer.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

/**
 * The large spruce water wheel: an upright two-block wheel on a horizontal
 * axle, driven by water.
 *
 * Water touching the wheel turns it, and the wheel turns whatever shares its
 * axle, so it is a power source as well as a part (see ShaftDrive.findDriver).
 * A motor or a shaft run can also turn it when it stands in no water.
 */
export default class BlockWaterWheel extends BlockShaftPart {

    /** Revolutions per minute water turns the wheel at. */
    static RPM = 8;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Water Wheel";
        this.shiftDescription = "Outputs 900 SU @ 8 RPM";
        this.hardness = 2.0;
        this.sound = Block.sounds.wood;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // The wheel overhangs its cell into the neighbours' space.
        this.noFaceCull = true;

        // Read by ShaftDrive: this block can supply power on its own.
        this.isWaterWheel = true;
    }

    /** The whole shape is the wheel model; there are no plain shaft parts. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return WaterWheelRenderer.TEXTURE;
    }

    /** Icon, break particles and any non-part rendering use the plank texture. */
    getTextureForFace(face) {
        return WaterWheelRenderer.TEXTURE;
    }

    getMultipart(world, x, y, z) {
        return WaterWheelRenderer.getParts();
    }

    /**
     * The wheel always stands upright with its axle running north to south,
     * whichever face it was placed against and whichever way the player looked.
     */
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Z;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Z;
    }

    /** True for the water block, without importing the registry (cycles). */
    static isWaterBlock(block) {
        if (!block) {
            return false;
        }
        if (block.isWater === true || block.liquidType === 'water') {
            return true;
        }

        // BlockWater identifies itself as 'water' once registered.
        const name = `${block.identifier || ''} ${block.name || ''} ${block.description || ''}`;
        return /\bwater\b/i.test(name) && block.isShaftPart !== true;
    }

    /** True when water touches the wheel on any side. */
    hasWater(world, x, y, z) {
        if (!world || typeof world.getBlockAt !== 'function') {
            return false;
        }

        for (const step of ShaftDrive.NEIGHBOURS) {
            const typeId = world.getBlockAt(
                x + step.delta[0],
                y + step.delta[1],
                z + step.delta[2]
            );
            if (!typeId) {
                continue;
            }
            if (BlockWaterWheel.isWaterBlock(Block.getById(typeId))) {
                return true;
            }
        }

        return false;
    }

    /** What the water turns the wheel at, or null when it is dry. */
    getWaterDrive(world, x, y, z) {
        if (!this.hasWater(world, x, y, z)) {
            return null;
        }

        return {rpm: BlockWaterWheel.RPM, direction: 1};
    }

    getPreferredToolType() {
        return 'axe';
    }
}
