import BlockRenderType from "../../../util/BlockRenderType.js";
import EnumBlockFace from "../../../util/EnumBlockFace.js";
import MovingObjectPosition from "../../../util/MovingObjectPosition.js";
import BoundingBox from "../../../util/BoundingBox.js";
import EnumCreativeInventoryTab from "../../gui/EnumCreativeInventoryTab.js";

export default class Block {

    static blocks = new Map();

    static sounds = {};

    static handHardnessMultiplier = 1.0;

    constructor(id, textureSlotId = id) {
        this.id = id;
        this.textureSlotId = textureSlotId;

        // Bounding box
        this.boundingBox = new BoundingBox(0.0, 0.0, 0.0, 1.0, 1.0, 1.0);

        // Default sound
        this.sound = Block.sounds.stone;

        // Description for tooltips
        this.description = null;

        // Block hardness (in ticks to break at 20 ticks/sec)
        this.hardness = 1.0;

        // Register block
        Block.blocks.set(id, this);

        this.path = false;
        this.noFaceCull = false;
        this.multipart = false;

        // Optional array of sub-block parts (same format as getMultipart) to
        // render inside this block after its own shape.
        this.renderInside = null;

        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;

        this.mod = "Breakmine";

        this.hasBlockEntityFlag = false;
    }

    /**
     * Override and return true if this block should own a BlockEntity at
     * every placed position.
     */
    hasBlockEntity() {
        return this.hasBlockEntityFlag;
    }

    /**
     * Called by the World when a block of this type is placed (or loaded
     * from save without a stored entity). MUST return a BlockEntity instance
     * or null. Default returns null even when hasBlockEntity() is true, so
     * subclasses MUST override both together.
     */
    createBlockEntity(world, x, y, z) {
        return null;
    }

    /**
     * Called once after the World finishes hydrating a block entity from NBT.
     * Useful for blocks that need to sync render state (e.g. update the
     * displayed name) when loading from save.
     */
    onBlockEntityLoaded(world, x, y, z, entity) {
        // override
    }

    /**
     * Called when a block entity at this position is marked dirty. The block
     * can use this to trigger a chunk rebuild for visual changes. Default
     * implementation just calls world.onBlockChanged(x, y, z).
     */
    onBlockEntityChanged(world, x, y, z, entity) {
        if (world && typeof world.onBlockChanged === "function") {
            world.onBlockChanged(x, y, z);
        }
    }

    onRender(world, x, y, z, blockRenderer) {
        return false;
    }

    isReplaceable(world, x, y, z) {
        return false;
    }

    handHardnessMultiplier() {
        return 1.0;
    }

    getPreferredToolType() {
        return null;
    }

    setHardness(hardness) {
        this.hardness = hardness;
        return this;
    }

    getHardness() {
        return this.hardness;
    }

    getDescription() {
        return this.description ?? "Unnamed Block";
    }

    getDrop(world, x, y, z) {
        return [this.id, 1];
    }

    getMultipart(world, x, y, z) {
        return null;
    }

    getModel() {
        return null;
    }

    getId() {
        return this.id;
    }

    getRenderType() {
        return BlockRenderType.BLOCK;
    }

    getParticleTextureFace() {
        return EnumBlockFace.TOP;
    }

    getTextureForFace(face, data, x, y, z, world) {
        return 'missing';
    }

    getRotationForFace(face, data, x, y, z, world) {
        return 0;
    }

    /**
     * Returns a slide offset for face animation. The value should be between 0-16,
     * where 0 means no slide and 8 means half-face slide (shifts right half left
     * and left half right, wrapped). Override this to implement animated face sliding.
     * Can also return an object mapping faces to offsets.
     * 
     * @param {EnumBlockFace} face - The face to slide
     * @param {number} x - Block X position
     * @param {number} y - Block Y position
     * @param {number} z - Block Z position
     * @param {World} world - The world instance
     * @param {number} tick - Current tick for animation timing
     * @returns {number|object} Slide offset between 0-16, or map of face->offset
     */
    doSlideFaceAnimate(face, x, y, z, world, tick) {
        return 0;
    }

    getTransparency() {
        return 0.0;
    }

    getAmbientOcclusion() {
        return true;
    }

    canCastAmbientOcclusion() {
        return true;
    }

    minimumToolLevel() {
        return null;
    }

    isItem() {
        return false;
    }
    
    onUse(world, x, y, z, itemstack, hitFace) {
        //
    }

    shouldRenderFace(world, x, y, z, face) {
        let typeId = world.getBlockAtFace(x, y, z, face);
        if (typeId === 0) {
            return true;
        }

        let block = Block.getById(typeId);
        return block === null || block.isTranslucent();
    }

    getColor(world, x, y, z, face) {
        return 0xffffff;
    }

    getParticleColor(world, x, y, z) {
        return this.getColor(world, x, y, z, this.getParticleTextureFace());
    }

    pickedItem() {
        return this.id;
    }

    getLightValue(world, x, y, z) {
        return 0;
    }

    isSolid() {
        return true;
    }

    isHalf(world, x, y, z) {
        return false;
    }

    isTranslucent() {
        return false;
    }

    getOpacity() {
        return 1.0;
    }

    canInteract() {
        return true;
    }

    isLiquid() {
        return false;
    }

    isLava() {
        return false;
    }

    getSound() {
        return this.sound;
    }

    getBoundingBox(world, x, y, z) {
        return this.boundingBox;
    }

    getCollisionBoundingBox(world, x, y, z) {
        if (this.isSolid()) {
            return this.boundingBox;
        }
        return null;
    }

    onBlockAdded(world, x, y, z) {

    }

    onBlockPlaced(world, x, y, z, face) {

    }

    collisionRayTrace(world, x, y, z, start, end) {
        // Raytrace against multipart bounding boxes if this is a multipart block
        if (this.multipart) {
            let multipart = this.getMultipart(world, x, y, z);
            if (Array.isArray(multipart) && multipart.length > 0) {
                let closestHit = null;
                let closestDistance = Infinity;

                for (let part of multipart) {
                    let bbox = Block.getPartBoundingBox(part);
                    if (!bbox) continue;

                    let hit = this.raytraceBoundingBox(bbox, x, y, z, start, end);
                    if (hit) {
                        let distance = start.squareDistanceTo(hit.vector);
                        if (distance < closestDistance) {
                            closestDistance = distance;
                            closestHit = hit;
                        }
                    }
                }

                // The multipart parts are the whole shape of this block, so when
                // none of them are hit there is nothing else to test. Falling back
                // to the full block box would make the empty parts selectable.
                return closestHit;
            }
        }

        // Default raytrace against this block's actual bounding box, which may be
        // smaller than a full block (slabs, torches, panels, dust, ...)
        let bbox = this.getBoundingBox(world, x, y, z);
        if (!bbox) {
            return null;
        }
        return this.raytraceBoundingBox(bbox, x, y, z, start, end);
    }

    /**
     * Returns the block-local bounding box of a multipart part entry, or null when
     * the entry has no box. Parts are either ["block", blockId, bbox] or
     * ["blockClass"/"texture", id, { block| texture, bbox }].
     */
    static getPartBoundingBox(part) {
        if (!Array.isArray(part)) {
            return null;
        }

        let data = part[2];
        if (!data) {
            return null;
        }

        // Wrapped form: { block, bbox } / { texture, bbox }
        if (typeof data.minX === "undefined" && typeof data.bbox !== "undefined") {
            data = data.bbox;
        }

        return typeof data.minX === "number" ? data : null;
    }

    raytraceBoundingBox(bbox, x, y, z, start, end) {
        start = start.addVector(-x, -y, -z);
        end = end.addVector(-x, -y, -z);

        let vec3 = start.getIntermediateWithXValue(end, bbox.minX);
        let vec31 = start.getIntermediateWithXValue(end, bbox.maxX);
        let vec32 = start.getIntermediateWithYValue(end, bbox.minY);
        let vec33 = start.getIntermediateWithYValue(end, bbox.maxY);
        let vec34 = start.getIntermediateWithZValue(end, bbox.minZ);
        let vec35 = start.getIntermediateWithZValue(end, bbox.maxZ);

        if (!this.isVecInsideYZBounds(vec3, bbox)) vec3 = null;
        if (!this.isVecInsideYZBounds(vec31, bbox)) vec31 = null;
        if (!this.isVecInsideXZBounds(vec32, bbox)) vec32 = null;
        if (!this.isVecInsideXZBounds(vec33, bbox)) vec33 = null;
        if (!this.isVecInsideXYBounds(vec34, bbox)) vec34 = null;
        if (!this.isVecInsideXYBounds(vec35, bbox)) vec35 = null;

        let vec36 = null;
        if (vec3 != null && (vec36 == null || start.squareDistanceTo(vec3) < start.squareDistanceTo(vec36))) vec36 = vec3;
        if (vec31 != null && (vec36 == null || start.squareDistanceTo(vec31) < start.squareDistanceTo(vec36))) vec36 = vec31;
        if (vec32 != null && (vec36 == null || start.squareDistanceTo(vec32) < start.squareDistanceTo(vec36))) vec36 = vec32;
        if (vec33 != null && (vec36 == null || start.squareDistanceTo(vec33) < start.squareDistanceTo(vec36))) vec36 = vec33;
        if (vec34 != null && (vec36 == null || start.squareDistanceTo(vec34) < start.squareDistanceTo(vec36))) vec36 = vec34;
        if (vec35 != null && (vec36 == null || start.squareDistanceTo(vec35) < start.squareDistanceTo(vec36))) vec36 = vec35;

        if (vec36 == null) return null;

        let face = null;
        if (vec36 === vec3) face = EnumBlockFace.WEST;
        else if (vec36 === vec31) face = EnumBlockFace.EAST;
        else if (vec36 === vec32) face = EnumBlockFace.BOTTOM;
        else if (vec36 === vec33) face = EnumBlockFace.TOP;
        else if (vec36 === vec34) face = EnumBlockFace.NORTH;
        else if (vec36 === vec35) face = EnumBlockFace.SOUTH;

        return new MovingObjectPosition(vec36.addVector(x, y, z), face, x, y, z);
    }

    /**
     * Checks if a vector is within the Y and Z bounds of the block.
     */
    isVecInsideYZBounds(point, bbox = null) {
        let bounds = bbox || this.boundingBox;
        return point == null ? false : point.y >= bounds.minY
            && point.y <= bounds.maxY
            && point.z >= bounds.minZ
            && point.z <= bounds.maxZ;
    }

    /**
     * Checks if a vector is within the X and Z bounds of the block.
     */
    isVecInsideXZBounds(point, bbox = null) {
        let bounds = bbox || this.boundingBox;
        return point == null ? false : point.x >= bounds.minX
            && point.x <= bounds.maxX
            && point.z >= bounds.minZ
            && point.z <= bounds.maxZ;
    }

    /**
     * Checks if a vector is within the X and Y bounds of the block.
     */
    isVecInsideXYBounds(point, bbox = null) {
        let bounds = bbox || this.boundingBox;
        return point == null ? false : point.x >= bounds.minX
            && point.x <= bounds.maxX
            && point.y >= bounds.minY
            && point.y <= bounds.maxY;
    }

    onMouseButton(world, x, y, z, button) {
        return false;
    }

    static getById(typeId) {
        let block = Block.blocks.get(typeId);
        return typeof block === "undefined" ? null : block;
    }
}
