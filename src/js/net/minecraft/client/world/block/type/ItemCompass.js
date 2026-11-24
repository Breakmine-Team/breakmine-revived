import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";
import Item from "../Item.js";

const FRAME_COUNT = 32;
const DEGREES_PER_FRAME = 360 / FRAME_COUNT;

export default class ItemCompass extends Item {

    constructor(id) {
        super(id, 0);
        this.description = "Compass";
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
    }

    getTextureForFace(face, data, x, y, z, world, holder = null) {
        const player = holder ?? world?.minecraft?.player;
        const spawn = world?.getSpawn?.();

        if (!player || !spawn) {
            return "compass_16";
        }

        const dx = spawn.x - player.x;
        const dz = spawn.z - player.z;
        const bearing = Math.atan2(dx, -dz) * (180 / Math.PI);
        const relative = (((bearing - player.rotationYaw) % 360) + 360) % 360;

        // Frame 16 points up (straight ahead); each frame turns 11.25 degrees.
        const frame = (Math.round(relative / DEGREES_PER_FRAME) + 16) % FRAME_COUNT;

        return `compass_${String(frame).padStart(2, "0")}`;
    }
}
