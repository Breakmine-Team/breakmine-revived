import BoundingBox from "../../../../util/BoundingBox.js";
import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import BlockClock from "./BlockClock.js";
import ItemEntity from "../../../entity/ItemEntity.js";

const CLOCK_FACE_TEXTURE = "clockface";
const HOUR_HAND_TEXTURE = "black_concrete";
const SECOND_HAND_TEXTURE = "red_concrete";

// Metadata is the face the clock hangs on: the clicked face of the supporting
// block, which is also the direction the clock face points. The order matches
// the face ids the network and the rest of the game use (0 = bottom, 1 = top,
// 2 = north, 3 = south, 4 = west, 5 = east), not EnumBlockFace.values().
const MOUNT_FACES = [
    EnumBlockFace.BOTTOM,
    EnumBlockFace.TOP,
    EnumBlockFace.NORTH,
    EnumBlockFace.SOUTH,
    EnumBlockFace.WEST,
    EnumBlockFace.EAST
];

// Only the face plane is drawn, so the slab is just deep enough to be a
// comfortable hitbox; the clock sits flush against the block it hangs on.
const PANEL_THICKNESS = 1 / 16;

const HAND_STANDOFF = 1 / 512;
const HAND_THICKNESS = 1 / 128;

const HANDS = [
    {width: 1.4, length: 4.0, texture: HOUR_HAND_TEXTURE, standoff: 0},
    {width: 0.9, length: 6.0, texture: HOUR_HAND_TEXTURE, standoff: HAND_THICKNESS},
    {width: 0.5, length: 6.5, texture: SECOND_HAND_TEXTURE, standoff: HAND_THICKNESS * 2}
];

export default class BlockMountableClock extends Block {

    constructor(id, textureSlotId) {
        super(id, textureSlotId);
        this.description = "Mountable Clock";
        this.hardness = 1.0;
        this.sound = Block.sounds.wood;
        this.multipart = true;
        this.inventoryTab = EnumCreativeInventoryTab.DECORATION;
    }

    getPreferredToolType() {
        return 'axe';
    }

    isSolid() {
        return false;
    }

    getOpacity() {
        return 0;
    }

    // The panel only covers a thin slice of the cell, so it must neither hide
    // its neighbours' faces nor stand in for a full block when lighting.
    occludesNeighborFaces() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    usesMultipartShape() {
        return false;
    }

    getCollisionBoundingBox(world, x, y, z) {
        return null;
    }

    getTextureForFace(face) {
        return CLOCK_FACE_TEXTURE;
    }

    getMountFace(face) {
        return MOUNT_FACES[BlockMountableClock.getFaceIndex(face)];
    }

    static getFaceIndex(face) {
        if (typeof face === 'number') {
            return face >= 0 && face < MOUNT_FACES.length ? face : 0;
        }
        if (!face) {
            return 0;
        }

        for (let i = 0; i < MOUNT_FACES.length; i++) {
            if (MOUNT_FACES[i].x === face.x && MOUNT_FACES[i].y === face.y && MOUNT_FACES[i].z === face.z) {
                return i;
            }
        }

        return 0;
    }

    canPlaceAt(world, x, y, z, face) {
        if (!world || typeof world.isSolidBlockAt !== 'function') {
            return true;
        }

        const outward = this.getMountFace(face);
        return world.isSolidBlockAt(x - outward.x, y - outward.y, z - outward.z);
    }

    getPlacementMetadata(world, x, y, z, face) {
        return BlockMountableClock.getFaceIndex(face);
    }

    onBlockPlaced(world, x, y, z, face) {
        if (face === null || face === undefined) {
            return;
        }

        world.setBlockDataAt(x, y, z, BlockMountableClock.getFaceIndex(face));
    }

    onNeighborBlockChange(world, x, y, z) {
        if (!this.canPlaceAt(world, x, y, z, world.getBlockDataAt(x, y, z))) {
            this.breakWithDrop(world, x, y, z);
        }
    }

    breakWithDrop(world, x, y, z) {
        if (world.getBlockAt(x, y, z) !== this.id) {
            return;
        }

        world.setBlockAt(x, y, z, 0);
        const [itemId, count] = this.getDrop(world, x, y, z);
        if (typeof world.dropItem === "function") {
            world.dropItem(itemId, x, y, z);
        } else if (world.minecraft?.worldRenderer
            && typeof world.addEntity === "function"
            && (typeof world.minecraft.isSingleplayer !== "function" || world.minecraft.isSingleplayer())) {
            for (let i = 0; i < count; i++) {
                world.addEntity(new ItemEntity(world.minecraft, world, itemId, x, y, z));
            }
        }
    }

    getBoundingBox(world, x, y, z) {
        const face = this.getMountFace(world ? world.getBlockDataAt(x, y, z) : 0);
        const box = BlockMountableClock.panelBox(face);
        return new BoundingBox(box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ);
    }

    // The clock face covers the whole face of the neighbouring block and the
    // slab sits flush against the block it was mounted on, so every face gets a
    // full 1x1 clock right on the surface.
    static panelBox(face) {
        if (face === EnumBlockFace.TOP) {
            return {minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: PANEL_THICKNESS, maxZ: 1};
        }
        if (face === EnumBlockFace.BOTTOM) {
            return {minX: 0, minY: 1 - PANEL_THICKNESS, minZ: 0, maxX: 1, maxY: 1, maxZ: 1};
        }
        if (face === EnumBlockFace.NORTH) {
            return {minX: 0, minY: 0, minZ: 1 - PANEL_THICKNESS, maxX: 1, maxY: 1, maxZ: 1};
        }
        if (face === EnumBlockFace.SOUTH) {
            return {minX: 0, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: PANEL_THICKNESS};
        }
        if (face === EnumBlockFace.EAST) {
            return {minX: 0, minY: 0, minZ: 0, maxX: PANEL_THICKNESS, maxY: 1, maxZ: 1};
        }
        return {minX: 1 - PANEL_THICKNESS, minY: 0, minZ: 0, maxX: 1, maxY: 1, maxZ: 1};
    }

    
    // Depth of a hand along the mount axis. The hands float just in front of the
    // clock face, which is PANEL_THICKNESS out from the supporting block, so
    // they sit inside the clock's own cell instead of beyond it.
    static handDepth(face, hand) {
        const near = HAND_STANDOFF + hand.standoff;
        const far = near + HAND_THICKNESS;
        const inner = PANEL_THICKNESS + near;
        const outer = PANEL_THICKNESS + far;

        if (face === EnumBlockFace.NORTH || face === EnumBlockFace.WEST || face === EnumBlockFace.BOTTOM) {
            return {min: 1 - outer, max: 1 - inner};
        }
        return {min: inner, max: outer};
    }

    static handBox(face, hand) {
        const halfWidth = (hand.width / 16) / 2;
        const minU = 0.5 - halfWidth;
        const maxU = 0.5 + halfWidth;
        const minAlong = 0.5;
        const maxAlong = 0.5 + hand.length / 16;
        const depth = BlockMountableClock.handDepth(face, hand);

        if (face === EnumBlockFace.NORTH || face === EnumBlockFace.SOUTH) {
            return {
                minX: minU, minY: minAlong, minZ: depth.min,
                maxX: maxU, maxY: maxAlong, maxZ: depth.max
            };
        }
        if (face === EnumBlockFace.EAST || face === EnumBlockFace.WEST) {
            return {
                minX: depth.min, minY: minAlong, minZ: minU,
                maxX: depth.max, maxY: maxAlong, maxZ: maxU
            };
        }

        // Lying on a floor or hanging under a ceiling: the hands point towards
        // -Z, which is where the texture's 12 o'clock mark ends up.
        return {
            minX: minU, minY: depth.min, minZ: 0.5 - hand.length / 16,
            maxX: maxU, maxY: depth.max, maxZ: 0.5
        };
    }

    static getHandRotation(face, degrees) {
        switch (face) {
            case EnumBlockFace.NORTH:
                return {x: 0, y: 0, z: degrees};
            case EnumBlockFace.SOUTH:
                return {x: 0, y: 0, z: -degrees};
            case EnumBlockFace.WEST:
                return {x: degrees, y: 0, z: 0};
            case EnumBlockFace.EAST:
                return {x: -degrees, y: 0, z: 0};
            case EnumBlockFace.TOP:
                return {x: 0, y: -degrees, z: 0};
            default:
                return {x: 0, y: degrees, z: 0};
        }
    }

    getPanelPart(face) {
        return ["texture", CLOCK_FACE_TEXTURE, {
            texture: CLOCK_FACE_TEXTURE,
            bbox: BlockMountableClock.panelBox(face),
            faces: {[face.getName()]: CLOCK_FACE_TEXTURE},
            visibleFaces: [face.getName()]
        }];
    }

    getHandParts(face, index) {
        const hand = HANDS[index];
        return [["texture", hand.texture, {
            texture: hand.texture,
            bbox: BlockMountableClock.handBox(face, hand)
        }]];
    }

    getHourParts(face) {
        return this.getHandParts(face, 0);
    }

    getMinuteParts(face) {
        return this.getHandParts(face, 1);
    }

    getSecondParts(face) {
        return this.getHandParts(face, 2);
    }

    // Inventory slots and the held item render without a world, so there is no
    // stored mount face to read; lay the clock on its back there so the face is
    // visible from the item view.
    getDisplayFace(world, x, y, z) {
        return world ? this.getMountFace(world.getBlockDataAt(x, y, z)) : EnumBlockFace.TOP;
    }

    getStaticMultipart(world, x, y, z) {
        return [this.getPanelPart(this.getDisplayFace(world, x, y, z))];
    }

    // The section builder only keeps the static panel when the block also
    // reports rotating parts, so this has to list the hands.
    getRotatingMultipart(world, x, y, z) {
        const face = this.getDisplayFace(world, x, y, z);
        return [
            ...this.getHourParts(face),
            ...this.getMinuteParts(face),
            ...this.getSecondParts(face)
        ];
    }

    getRotatingParts(world, x, y, z) {
        return this.getRotatingMultipart(world, x, y, z);
    }

    getRotatingGroups(world, x, y, z) {
        const face = this.getDisplayFace(world, x, y, z);
        return [
            {parts: this.getHourParts(face)},
            {parts: this.getMinuteParts(face)},
            {parts: this.getSecondParts(face)}
        ];
    }

    getMultipart(world, x, y, z) {
        return [
            ...this.getStaticMultipart(world, x, y, z),
            ...this.getRotatingMultipart(world, x, y, z)
        ];
    }

    // A zero rotation would make the section builder treat the clock as static
    // and drop its moving hands.
    getRenderRotation(world, x, y, z, data, tick) {
        return {x: 0, y: 0, z: 0.0001};
    }

    getGroupRotation(index, world, x, y, z, tick) {
        if (!world) {
            return {x: 0, y: 0, z: 0};
        }

        const angles = BlockClock.getTimeAngles();
        const degrees = index === 0
            ? angles.hour
            : index === 1
                ? angles.minute
                : angles.second;

        return BlockMountableClock.getHandRotation(
            this.getMountFace(world.getBlockDataAt(x, y, z)),
            degrees
        );
    }
}
