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

        this.boundingBox = new BoundingBox(0.0, 0.0, 0.0, 1.0, 1.0, 1.0);

        this.sound = Block.sounds.stone;

        this.description = null;
        this.shiftDescription = null;

        this.hardness = 1.0;

        Block.blocks.set(id, this);

        this.path = false;
        this.noFaceCull = false;
        this.multipart = false;

        this.renderInside = null;

        this.inventoryTab = EnumCreativeInventoryTab.BUILDING_BLOCKS;

        this.mod = "Breakmine";

        this.hasBlockEntityFlag = false;
    }

    hasBlockEntity() {
        return this.hasBlockEntityFlag;
    }

    createBlockEntity(world, x, y, z) {
        return null;
    }

    onBlockEntityLoaded(world, x, y, z, entity) {
    }

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

    getMultipart(world, x, y, z) {
        return null;
    }

    getRotatingMultipart(world, x, y, z) {
        return null;
    }

    getStaticMultipart(world, x, y, z) {
        return null;
    }

    getRotatingGroups(world, x, y, z) {
        return null;
    }

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

    getRenderRotation(world, x, y, z, data, tick) {
        return 0;
    }

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

    getCollisionBoundingBoxFor(world, x, y, z, query) {
        return this.getCollisionBoundingBox(world, x, y, z);
    }

    onBlockAdded(world, x, y, z) {

    }

    onBlockPlaced(world, x, y, z, face) {

    }

    getPlacementMetadata(world, x, y, z, face, yaw = 0) {
        return 0;
    }

    collisionRayTrace(world, x, y, z, start, end) {
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

                return closestHit;
            }
        }

        let bbox = this.getBoundingBox(world, x, y, z);
        if (!bbox) {
            return null;
        }
        return this.raytraceBoundingBox(bbox, x, y, z, start, end);
    }

    static getPartBoundingBox(part) {
        if (!Array.isArray(part)) {
            return null;
        }

        let data = part[2];
        if (!data) {
            return null;
        }

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

    
    isVecInsideYZBounds(point, bbox = null) {
        let bounds = bbox || this.boundingBox;
        return point == null ? false : point.y >= bounds.minY
            && point.y <= bounds.maxY
            && point.z >= bounds.minZ
            && point.z <= bounds.maxZ;
    }

    
    isVecInsideXZBounds(point, bbox = null) {
        let bounds = bbox || this.boundingBox;
        return point == null ? false : point.x >= bounds.minX
            && point.x <= bounds.maxX
            && point.z >= bounds.minZ
            && point.z <= bounds.maxZ;
    }

    
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
