import Item from "../Item.js";
import EnumCreativeInventoryTab from "../../../gui/EnumCreativeInventoryTab.js";

// The Physics Wand grabs a physics contraption and carries it around in front
// of the player. Letting go of the right mouse button drops it where it is, so
// the same tool moves machines and picks them up.
export default class ItemPhysicsWand extends Item {

    static TEXTURE = 'physics_staff';

    constructor(id, textureSlotId, description = "Physics Wand") {
        super(id, 0);
        this.description = description;
        this.shiftDescription = "RMB: grab a contraption\nRelease: drop it";
        this.inventoryTab = EnumCreativeInventoryTab.TOOLS;
        this.isPhysicsWand = true;
        this.isTool = true;
    }

    getTextureForFace(face) {
        return ItemPhysicsWand.TEXTURE;
    }

    onUse(world, x, y, z, itemstack, hitFace) {
        const minecraft = world && world.minecraft;
        if (minecraft && typeof minecraft.usePhysicsWand === "function") {
            minecraft.usePhysicsWand();
        }
    }
}
