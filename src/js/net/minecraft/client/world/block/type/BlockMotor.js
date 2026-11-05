import Block from "../Block.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import MotorRenderer from "../../../render/MotorRenderer.js";
import ShaftRenderer from "../../../render/ShaftRenderer.js";
import ShaftDrive from "../ShaftDrive.js";

// Output normal for each face id (0 bottom, 1 top, 2 north, 3 south, 4 west,
// 5 east), the numbering placement uses.
const OUTPUT_NORMALS = [
    [0, -1, 0],
    [0, 1, 0],
    [0, 0, -1],
    [0, 0, 1],
    [-1, 0, 0],
    [1, 0, 0]
];

// Player yaw index (0 south, 1 west, 2 north, 3 east) to the face the motor's
// drive end points at: it faces the player, the way a furnace or chest does.
const YAW_TO_FACE = [2, 5, 3, 4];

/**
 * A pink concrete motor. It turns whatever shaft or cog its drive end points
 * at, at 16 RPM, and that motion spreads through the assembly from there (see
 * ShaftDrive). With no motor in an assembly, its shafts and cogs stand still.
 *
 * The drive end faces the player who placed it (never the face that was
 * clicked), so you point it at whatever stands behind you as you place it.
 */
export default class BlockMotor extends Block {

    /** Revolutions per minute the motor turns its output at. */
    static RPM = 16;

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Motor";
        this.shiftDescription = "Outputs 10,000 SU @ 16 RPM";
        this.hardness = 2.0;
        this.sound = Block.sounds.stone;
        this.multipart = true;
        this.inventoryTab = EnumCreativeInventoryTab.FACTORIO;

        // Read by ShaftDrive to tell motors apart from the parts they turn.
        this.isShaftMotor = true;
    }

    /** Facing is the face id of the drive end (0 bottom .. 5 east). */
    getFacing(data) {
        const facing = (data | 0) & 7;
        return facing <= 5 ? facing : 3;
    }

    /** Unit vector the drive end points along. */
    getOutputNormal(data) {
        return OUTPUT_NORMALS[this.getFacing(data)];
    }

    /** The axle a driven part must have to take this motor's output. */
    getOutputAxis(data) {
        return ShaftRenderer.getAxisFromFace(this.getFacing(data));
    }

    /** +1 or -1: which way the motor turns its output. */
    getOutputDirection(data) {
        return 1;
    }

    getOutputRpm(data) {
        return BlockMotor.RPM;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        // Only the player's yaw matters: the drive end faces them, whichever
        // face of a block the motor was clicked onto.
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_FACE[dirIndex];
    }

    /** Icon, break particles and any non-part rendering use the model texture. */
    getTextureForFace(face) {
        return MotorRenderer.TEXTURE;
    }

    /** Full shape: the casing plus the half-shaft on the drive end. */
    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return [
            ...MotorRenderer.getParts(this.getFacing(data)),
            ...MotorRenderer.getRodParts(this.getFacing(data))
        ];
    }

    /** The casing is bolted down: it never turns. */
    getStaticMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return MotorRenderer.getParts(this.getFacing(data));
    }

    /** Only the drive rod turns, on the output axle through the middle. */
    getRotatingMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        return MotorRenderer.getRodParts(this.getFacing(data));
    }

    /** The motor always runs, so its rod turns at 16 RPM all the time. */
    getRenderRotation(world, x, y, z, data, tick) {
        // Without a world this is the inventory icon, which must stay upright.
        if (!world) {
            return 0;
        }

        return ShaftRenderer.getRotationForAxis(
            this.getOutputAxis(data),
            ShaftRenderer.angleFor(BlockMotor.RPM, 1, tick)
        );
    }

    // The client places the block before the server sends its metadata back, so
    // the drive end is turned to face the local player straight away.
    onBlockPlaced(world, x, y, z, face) {
        const player = world && world.minecraft && world.minecraft.player;
        if (!player || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(world, x, y, z, face, player.rotationYaw));
    }

    // A motor makes or breaks a driven assembly, so the parts around it have to
    // be re-classified: a still part gets a mesh of its own once it is driven.
    onBlockAdded(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    onBlockRemoved(world, x, y, z) {
        ShaftDrive.refreshAround(world, x, y, z);
    }

    getPreferredToolType() {
        return 'pickaxe';
    }
}
