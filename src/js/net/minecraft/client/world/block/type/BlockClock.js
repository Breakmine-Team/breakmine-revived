import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

// Which face shows the clock face for each metadata value. The numbering is the
// one the furnace and the chest use (2 north, 3 south, 4 west, 5 east).
const FACING_FACES = {
    2: EnumBlockFace.NORTH,
    3: EnumBlockFace.SOUTH,
    4: EnumBlockFace.WEST,
    5: EnumBlockFace.EAST
};

// Player yaw index (0 south, 1 west, 2 north, 3 east) to the face that looks
// back at the player, so the clock is readable from where it was placed.
const YAW_TO_FACING = [2, 5, 3, 4];

const PLANK_TEXTURE = "oak_planks";
const CLOCK_TEXTURE = "clock";
const HAND_TEXTURE = "black_concrete";
const SECOND_HAND_TEXTURE = "red_concrete";

// Hand sizes in pixels of the 16x16 block face.
const HOUR_HAND = {width: 1.4, length: 4.0};
const MINUTE_HAND = {width: 0.9, length: 6.0};
const SECOND_HAND = {width: 0.5, length: 6.5};

// Small gap between the face and the hands, so they never z-fight with it.
const HAND_STANDOFF = 1 / 512;
const HAND_THICKNESS = 1 / 128;

/**
 * A clock: an oak plank block with a clock face on one side and three hands in
 * front of it.
 *
 * The hands are multipart geometry turned by the renderer every frame, so the
 * block never has to be re-meshed as time passes. The casing goes into the
 * chunk mesh (its face textures depend on the facing), while each hand becomes
 * its own rotating mesh (see getRotatingGroups). 
 */
export default class BlockClock extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Clock";
        this.hardness = 1.0;
        this.sound = Block.sounds.wood;
        this.multipart = true;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getPreferredToolType() {
        return 'axe';
    }

    /** Facing is the face id (2 north .. 5 east) the clock face looks along. */
    getFacing(data) {
        const facing = (data | 0) & 7;
        return FACING_FACES[facing] ? facing : 2;
    }

    getFrontFace(data) {
        return FACING_FACES[this.getFacing(data)];
    }

    getTextureForFace(face, data) {
        return face === this.getFrontFace(data) ? CLOCK_TEXTURE : PLANK_TEXTURE;
    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        const dirIndex = Math.floor((yaw * 4 / 360) + 0.5) & 3;
        return YAW_TO_FACING[dirIndex];
    }

    onBlockPlaced(world, x, y, z, face) {
        const player = world && world.minecraft && world.minecraft.player;
        if (!player || world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockDataAt(x, y, z, this.getPlacementMetadata(world, x, y, z, face, player.rotationYaw));
    }

    /** The plank casing, with the clock face texture on the facing side. */
    getStaticMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const front = this.getFrontFace(data);

        return [["texture", PLANK_TEXTURE, {
            texture: PLANK_TEXTURE,
            bbox: {minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1},
            faces: {[front.getName()]: CLOCK_TEXTURE}
        }]];
    }

    /**
     * One hand lying against the clock face, pointing at 12. `width` and
     * `length` are in pixels of the face; the renderer turns the hand around
     * the block's middle, which is the centre of the face.
     */
    getHandParts(facing, width, length, texture = HAND_TEXTURE, standoffOffset = 0) {
        const halfWidth = (width / 16) / 2;
        const minY = 0.5;
        const maxY = 0.5 + length / 16;
        const u0 = 0.5 - halfWidth;
        const u1 = 0.5 + halfWidth;

        let outer = HAND_STANDOFF + standoffOffset;

        if (facing === 3 || facing === 1 || facing === 5 || facing === 6) {
            outer = outer + 1;
        }

        let inner = outer + HAND_THICKNESS;

        let bbox;
        if (facing === 2) {
            // North
            bbox = {minX: u0, minY, minZ: -inner, maxX: u1, maxY, maxZ: -outer};
        } else if (facing === 3) {
            // South - mirror Z offset relative to center
            bbox = {minX: u0, minY, minZ: outer, maxX: u1, maxY, maxZ: inner};
        } else if (facing === 4) {
            // West
            bbox = {minX: -inner, minY, minZ: u0, maxX: -outer, maxY, maxZ: u1};
        } else {
            // East - mirror X offset relative to center
            bbox = {minX: outer, minY, minZ: u0, maxX: inner, maxY, maxZ: u1};
        }

        return [["texture", texture, {texture, bbox}]];
    }

    getHourParts(facing) {
        return this.getHandParts(facing, HOUR_HAND.width, HOUR_HAND.length, HAND_TEXTURE, 0);
    }

    getMinuteParts(facing) {
        return this.getHandParts(facing, MINUTE_HAND.width, MINUTE_HAND.length, HAND_TEXTURE, HAND_THICKNESS);
    }

    getSecondParts(facing) {
        return this.getHandParts(facing, SECOND_HAND.width, SECOND_HAND.length, SECOND_HAND_TEXTURE, HAND_THICKNESS * 2);
    }

    getMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const facing = this.getFacing(data);

        return [
            ...this.getStaticMultipart(world, x, y, z),
            ...this.getHourParts(facing),
            ...this.getMinuteParts(facing),
            ...this.getSecondParts(facing)
        ];
    }

    /** Only the hands move; the plank casing stays in the chunk mesh. */
    getRotatingMultipart(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const facing = this.getFacing(data);

        return [
            ...this.getHourParts(facing),
            ...this.getMinuteParts(facing),
            ...this.getSecondParts(facing)
        ];
    }

    /** Each hand is its own mesh, so they can show different times. */
    getRotatingGroups(world, x, y, z) {
        const data = world ? world.getBlockDataAt(x, y, z) : 0;
        const facing = this.getFacing(data);

        return [
            {parts: this.getHourParts(facing)},
            {parts: this.getMinuteParts(facing)},
            {parts: this.getSecondParts(facing)}
        ];
    }

    /**
     * Ask for a mesh of its own so the hands animate. The casing is drawn from
     * getStaticMultipart(); this angle only has to be non-zero to keep the block
     * on the animated path, and is far too small to see.
     */
    getRenderRotation(world, x, y, z, data, tick) {
        return {x: 0, y: 0, z: 0.0001};
    }

    /** Hours, minutes, and discrete seconds since midnight, in degrees clockwise from 12. */
    static getTimeAngles(now = new Date()) {
        const seconds = now.getSeconds(); // Integer seconds for ticking behavior
        const minutes = now.getMinutes() + seconds / 60;
        const hours = (now.getHours() % 12) + minutes / 60;

        return {
            hour: hours * 30,
            minute: minutes * 6,
            second: seconds * 6
        };
    }

    /**
     * Turn a clockwise angle from 12 into the renderer rotation for one hand.
     * The sign depends on which side of the block the face is: looking at the
     * south face, clockwise is a negative Z turn, and so on.
     */
    static getHandRotation(facing, degrees) {
        switch (facing) {
            case 2:
                return {x: 0, y: 0, z: degrees};
            case 3:
                return {x: 0, y: 0, z: -degrees};
            case 4:
                return {x: degrees, y: 0, z: 0};
            case 5:
                return {x: -degrees, y: 0, z: 0};
            default:
                return {x: 0, y: 0, z: 0};
        }
    }

    /** Rotation for the hour hand (group 0), minute hand (group 1), or second hand (group 2). */
    getGroupRotation(index, world, x, y, z, tick) {
        // The inventory icon and other world-less previews keep the hands at 12.
        if (!world) {
            return {x: 0, y: 0, z: 0};
        }

        const data = world.getBlockDataAt(x, y, z);
        const angles = BlockClock.getTimeAngles();
        
        let degrees;
        if (index === 0) {
            degrees = angles.hour;
        } else if (index === 1) {
            degrees = angles.minute;
        } else {
            degrees = angles.second;
        }

        return BlockClock.getHandRotation(this.getFacing(data), degrees);
    }
}