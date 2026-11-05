import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockShaftPart from "./BlockShaftPart.js";
import BearingRenderer from "../../../render/BearingRenderer.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import BearingDrive from "../BearingDrive.js";

/**
 * A mechanical bearing: the block that turns a whole structure.
 *
 * The bearing sits on a vertical axle and carries whatever is built on top of
 * it. When a shaft, cog, gearbox, motor or water wheel drives it, the bearing
 * hands that structure to the off-grid renderer - the OGR - and turns it at the
 * bearing's own speed, around the bearing's own axle (see BearingDrive).
 *
 * Nothing is driven, nothing turns: a bearing with no power in its assembly
 * leaves its structure resting on it, and stopping the drive puts every block
 * back on the grid where it came from.
 */
export default class BlockMechanicalBearing extends BlockShaftPart {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);

        this.description = "Mechanical Bearing";
        this.shiftDescription = "Consumes 500 SU";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // Read by ShaftDrive and BearingDrive to recognise the bearing.
        this.isMechanicalBearing = true;
    }

    /** The shape is the renderer's plate, collar and stub. */
    getShaftParts() {
        return [];
    }

    getShaftTexture() {
        return BearingRenderer.TEXTURE;
    }

    getTextureForFace(face) {
        return BearingRenderer.TEXTURE;
    }

    /** The bearing always stands upright, whichever face it was placed on. */
    getPlacementMetadata() {
        return ShaftRenderer.AXIS.Y;
    }

    getAxis(data) {
        return ShaftRenderer.AXIS.Y;
    }

    getMultipart(world, x, y, z) {
        // A bearing the server placed arrives without the local placement
        // hooks, so the first tessellation is the first moment the client can
        // be sure it exists: register it for driving here.
        BearingDrive.register(world, x, y, z);

        return [
            ...BearingRenderer.getCasingParts(),
            ...BearingRenderer.getShaftParts()
        ];
    }

    /** The plate is bolted down: only the axle on top of it turns. */
    getStaticMultipart(world, x, y, z) {
        return BearingRenderer.getCasingParts();
    }

    getRotatingMultipart(world, x, y, z) {
        return BearingRenderer.getShaftParts();
    }

    /**
     * The head plate turns with the OGR it carries, so it takes the field's own
     * angle rather than counting ticks from the RPM - the plate and the
     * structure on it stay locked together. With nothing carried the plate
     * still turns, showing the drive reaching the bare axle.
     */
    getRenderRotation(world, x, y, z, data, tick) {
        const field = world ? world.offGridField : null;
        const group = world ? BearingDrive.getGroup(world, x, y, z) : null;

        // Only the field this bearing actually filled carries its structure; a
        // field owned by another system must not turn the head plate.
        if (field && group !== null && group.field === field) {
            return {x: 0, y: field.rotation.y, z: 0};
        }

        return super.getRenderRotation(world, x, y, z, data, tick);
    }

    onBlockAdded(world, x, y, z) {
        super.onBlockAdded(world, x, y, z);
        BearingDrive.register(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        BearingDrive.unregister(world, x, y, z);
        BearingDrive.release(world, x, y, z);
        super.onBlockRemoved(world, x, y, z);
    }

    getPreferredToolType() {
        return 'axe';
    }
}
