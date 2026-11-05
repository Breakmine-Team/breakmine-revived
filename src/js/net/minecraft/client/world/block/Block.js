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

        // Extra tooltip lines shown while shift is held. When set, the tooltip
        // shows a grey "[Shift for info]" hint until shift is pressed.
        // Either a string (newline separated) or an array of lines.
        this.shiftDescription = null;

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

    /**
     * Extra tooltip lines revealed while shift is held. Return null (the
     * default) for blocks that have nothing more to say.
     */
    getShiftDescription() {
        return this.shiftDescription ?? null;
    }

    setShiftDescription(shiftDescription) {
        this.shiftDescription = shiftDescription;
        return this;
    }

    getDrop(world, x, y, z) {
        return [this.id, 1];
    }

    /**
     * Normalize a getDrop() result into a list of [itemId, count] pairs. The
     * classic shape is a single [itemId, count]; blocks that drop several
     * different items (mature wheat: wheat + seeds) return a list of them.
     */
    static normalizeDrops(drop) {
        if (!Array.isArray(drop) || drop.length === 0) {
            return [];
        }

        if (typeof drop[0] === 'number') {
            return drop.length >= 2 && drop[1] > 0 ? [[drop[0], drop[1]]] : [];
        }

        const drops = [];
        for (const entry of drop) {
            if (Array.isArray(entry) && typeof entry[0] === 'number' && entry[1] > 0) {
                drops.push([entry[0], entry[1]]);
            }
        }
        return drops;
    }

    /**
     * The parts this block is drawn (and, for multipart blocks, collided) as.
     * Each entry is one of:
     *
     *   ["block", blockId, bbox]
     *   ["blockClass", blockClass, {block, bbox}]
     *   ["texture", textureName, {texture, bbox}]
     *
     * `bbox` is block-local ({minX..maxZ} in 0-1). An optional `rotation`
     * (degrees: a single Y angle, an [x, y, z] array or an {x, y, z} object)
     * turns that part around `pivot` (block-local, same shapes), which defaults
     * to the middle of the part so it spins in place. Parts turn visually: the
     * collision and hit boxes stay axis-aligned on the unrotated boxes.
     */
    getMultipart(world, x, y, z) {
        return null;
    }

    /**
     * The subset of getMultipart() that turns while the block itself is
     * animated - a motor's drive rod, a gearbox's axle stubs.
     *
     * A block that returns parts here is rendered in pieces: getStaticMultipart()
     * goes into the section mesh, and these parts become the block's own turning
     * mesh. Return null to have the whole block turn as one piece.
     */
    getRotatingMultipart(world, x, y, z) {
        return null;
    }

    /** The still part of a block that spins only some of its pieces. */
    getStaticMultipart(world, x, y, z) {
        return null;
    }

    /**
     * Groups of parts that turn on different axles, each `{parts, axis}`, or
     * null to turn the moving parts as one piece. A gearbox uses this for its
     * crossed axle pairs.
     */
    getRotatingGroups(world, x, y, z) {
        return null;
    }

    /**
     * True when the parts returned by getMultipart() are also the block's
     * physical shape: they are used for collision and for the hit selection.
     * Blocks that only *render* as parts but are otherwise walked through
     * (scaffolding) return false and keep using getBoundingBox() and
     * getCollisionBoundingBoxFor() instead.
     */
    usesMultipartShape() {
        return true;
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
     * How far this block turns around its own center while rendered, in
     * degrees. Return a number to spin it around the Y axis, or an
     * [x, y, z] array ({x, y, z} also works) to turn it around several axes at
     * once; the angles are applied in X, Y, Z order around the middle of the
     * block's cell, so the block keeps its position and its original faces.
     * Return 0 for a block that does not rotate.
     *
     * The rotation is baked into the chunk mesh, so a block that turns over
     * time has to ask for a rebuild (world.onBlockChanged(x, y, z)) when the
     * angle changes.
     *
     * @param {World|null} world
     * @param {number} x
     * @param {number} y
     * @param {number} z
     * @param {number} data block metadata nibble
     * @param {number|null} tick animation clock the renderer is using, in
     *   game ticks. Use it for time-based turns instead of world.ticks, which
     *   does not advance on the client in multiplayer.
     * @returns {number|number[]|{x:number,y:number,z:number}}
     */
    getRenderRotation(world, x, y, z, data, tick) {
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

    shouldRenderFace(world, x, y, z, face, prefetchedTypeId) {
        let typeId = prefetchedTypeId !== undefined ? prefetchedTypeId : world.getBlockAtFace(x, y, z, face);
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

    getOpacity(world, x, y, z, block) {
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

    /**
     * Collision box for one specific sweep of a moving entity. `query` carries
     * the swept `region` and whether the entity is moving `downward` this step,
     * so a block can collide differently depending on which way the entity is
     * going (scaffolding only catches entities landing on its top plate).
     * Blocks with a direction-independent box do not need to override this.
     */
    getCollisionBoundingBoxFor(world, x, y, z, query) {
        return this.getCollisionBoundingBox(world, x, y, z);
    }

    onBlockAdded(world, x, y, z) {

    }

    onBlockPlaced(world, x, y, z, face) {

    }

    /**
     * Pure placement metadata computation used by the server during block
     * placement. Blocks that carry directional state override this, so the
     * server never needs a hand-written list of special-cased block IDs.
     *
     * @param {number} face 0-5, 0 = bottom
     * @param {number} yaw player yaw in degrees
     */
    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        return 0;
    }

    collisionRayTrace(world, x, y, z, start, end) {
        // Raytrace against multipart bounding boxes if this is a multipart block
        // whose parts are its real shape.
        if (this.multipart && this.usesMultipartShape()) {
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
