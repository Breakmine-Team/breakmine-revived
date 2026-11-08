import Block from "../Block.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

// Player yaw index (0 south, 1 west, 2 north, 3 east) to the axle that points
// at the player: looking north or south gives a Z axle, east or west an X axle.
const YAW_TO_AXIS = [
    ShaftRenderer.AXIS.Z,
    ShaftRenderer.AXIS.X,
    ShaftRenderer.AXIS.Z,
    ShaftRenderer.AXIS.X
];

/**
 * A block whose shape is built from shaft-renderer parts: shafts, half-shafts
 * and cogs.
 *
 * Subclasses choose the parts, the material and how they mesh; this class
 * turns those into multipart geometry for the axis it was placed with (the way
 * the player was looking, or upright when placed on a top or bottom face) and
 * reports the spin angle for the renderer's animation clock.
 *
 * A part does not turn by itself. Its speed and direction come from ShaftDrive:
 * with a motor somewhere in the assembly it turns at the motor's RPM (reversed
 * for each pair of cogs in mesh), and with nothing driving it the angle stays
 * at zero so the block sits still.
 */
export default class BlockShaftPart extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.multipart = true;
        this.hardness = 1.5;
        this.sound = Block.sounds.stone;

        // Read by ShaftDrive to recognise parts that can carry rotation.
        this.isShaftPart = true;
    }

    // Shaft parts are machinery rather than terrain: they keep flat lighting
    // and cast no shading onto the blocks around them.
    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    /**
     * The parts to draw, each `{part, texture, teethTexture, negative}`.
     * See ShaftRenderer.PART for the available kinds.
     */
    getShaftParts() {
        return [{part: ShaftRenderer.PART.SHAFT, texture: this.getShaftTexture()}];
    }

    /** Texture of the plain parts (shafts, half-shafts, cog casing). */
    getShaftTexture() {
        return 'stone';
    }

    /** Icon, break particles and any non-part rendering use the part texture. */
    getTextureForFace(face) {
        return this.getShaftTexture();
    }

    /** True for cogs, whose teeth mesh with a neighbouring cog's teeth. */
    isCog() {
        return false;
    }

    /**
     * Radius of the cog wheel this part meshes with, in block units. Two cogs in
     * mesh turn at speeds in inverse proportion to their radii, so this is what
     * gives a gear ratio. The built-in cog's teeth reach 9px out from the axle.
     */
    getCogRadius() {
        return 9 / 16;
    }

    /** What is turning this block right now: {rpm, direction}. */
    getDrive(world, x, y, z, tick) {
        return ShaftDrive.resolve(world, x, y, z, tick);
    }

    /** Revolutions per minute this block turns at. 0 when nothing drives it. */
    getShaftRpm(world, x, y, z, tick) {
        return this.getDrive(world, x, y, z, tick).rpm;
    }

    /** +1 or -1: which way this block turns. */
    getShaftDirection(world, x, y, z, tick) {
        return this.getDrive(world, x, y, z, tick).direction;
    }

    getAxis(data) {
        return ShaftRenderer.getAxis(data);
    }

    /**
     * A part with a vertical axle stands on the block below it rather than
     * lying against a side, so it needs its own collision shape.
     */
    isUprightPart(data) {
        return this.getAxis(data) === ShaftRenderer.AXIS.Y;
    }

    /**
     * The axle runs along the way the player was looking, so the part faces
     * them. Placing one on a block's top or bottom face stands it upright
     * instead, which is the only way to build a vertical run.
     */
    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const faceId = BlockShaftPart.getFaceId(face);
        if (faceId === 0 || faceId === 1) {
            return ShaftRenderer.AXIS.Y;
        }

        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_AXIS[dirIndex];
    }

    /**
     * The clicked face as the 0-5 id the rest of the game uses (0 bottom,
     * 1 top, 2 north, 3 south, 4 west, 5 east). The client hands placement an
     * EnumBlockFace, the server a number, so both are accepted.
     */
    static getFaceId(face) {
        if (typeof face === "number") {
            return face | 0;
        }
        if (!face) {
            return -1;
        }
        if (face.y < 0) return 0;
        if (face.y > 0) return 1;
        if (face.z < 0) return 2;
        if (face.z > 0) return 3;
        if (face.x < 0) return 4;
        if (face.x > 0) return 5;

        return -1;
    }

    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return ShaftRenderer.buildParts(this.getShaftParts(), this.getAxis(data));
    }

    getRenderRotation(world, x, y, z, data, tick) {
        return ShaftRenderer.getRotation(
            this.getAxis(data),
            this.getShaftRpm(world, x, y, z, tick),
            this.getShaftDirection(world, x, y, z, tick),
            tick
        );
    }

    // The client places the block before the server sends its metadata back, so
    // orientation is set here from the local player's yaw to avoid the part
    // showing up on the wrong axis for a moment.
    onBlockPlaced(world, x, y, z, face) {
        const player = world && world.minecraft && world.minecraft.player;
        if (!player || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(world, x, y, z, face, player.rotationYaw));
    }

    // Adding or removing a part changes which assembly is driven, so the
    // surrounding cells need re-meshing (and this tick's drive results are
    // stale).
    onBlockAdded(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);

        // Watch this part for two drives fighting over the run it belongs to.
        if (world && typeof world.scheduleBlockTick === 'function') {
            world.scheduleBlockTick(x, y, z, 20);
        }
    }

    /**
     * A shaft with two drives pulling it in opposite directions shears and
     * breaks. The snap splits the run, so afterwards each source drives its own
     * half and the conflict is gone. Two drives at different speeds but the
     * same direction are not a conflict - the faster one wins (see
     * ShaftDrive.compute), so they leave the run in one piece.
     */
    onBlockTick(world, x, y, z) {
        if (!world) {
            return;
        }

        if (typeof world.scheduleBlockTick === 'function') {
            world.scheduleBlockTick(x, y, z, 20);
        }

        if (typeof world.setBlockAt !== 'function') {
            return;
        }

        const candidate = ShaftDrive.findSnapCandidate(world, x, y, z);
        if (candidate === null || candidate !== ShaftDrive.keyOf(x, y, z)) {
            return;
        }

        world.setBlockAt(x, y, z, 0);
        ShaftDrive.refreshAround(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }
}
