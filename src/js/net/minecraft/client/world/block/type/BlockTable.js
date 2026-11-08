import Block from "../Block.js";
import BoundingBox from "../../../../util/BoundingBox.js";

export default class BlockTable extends Block {

    constructor(id, textureSlotId, woodName, woodId, woodDisplayName) {
        super(id, textureSlotId);
        this.woodName = woodName;
        this.woodId = woodId;
        this.description = `${woodDisplayName} Table`;
        this.hardness = 2;
        this.multipart = true;
        this.noFaceCull = true;
        this.sound = Block.sounds.wood;
    }

    getPreferredToolType() {
        return 'axe';
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getAmbientOcclusion() {
        return true;
    }

    getTextureForFace(face) {
        return `${this.woodName}_planks`;
    }

    getModel(world, x, y, z) {
        const fac = 1 / 16;
        return [
            ["block", this.woodId, new BoundingBox(0, fac * 14, 0, 1, 1, 1)],
            ["block", this.woodId, new BoundingBox(fac * 1, 0, fac * 1, fac * 3, fac * 14, fac * 3)],
            ["block", this.woodId, new BoundingBox(fac * 13, 0, fac * 1, fac * 15, fac * 14, fac * 3)],
            ["block", this.woodId, new BoundingBox(fac * 1, 0, fac * 13, fac * 3, fac * 14, fac * 15)],
            ["block", this.woodId, new BoundingBox(fac * 13, 0, fac * 13, fac * 15, fac * 14, fac * 15)],
        ];
    }

    getMultipart(world, x, y, z) {
        if (world === null) {
            return this.getModel(world, x, y, z);
        }

        const fac = 1 / 16;
        const pole = new BoundingBox(0, fac * 14, 0, 1, 1, 1);
        const base = [
            ["block", this.woodId, pole],
        ];

        const legAt = (nx, ny, nz) => {
            const neighborId = world.getBlockAt(nx, ny, nz);
            return neighborId !== this.id;
        };

        if (legAt(x - 1, y, z) && legAt(x, y, z - 1)) {
            base.push(["block", this.woodId, new BoundingBox(fac * 1, 0, fac * 1, fac * 3, fac * 14, fac * 3)]);
        }
        if (legAt(x + 1, y, z) && legAt(x, y, z - 1)) {
            base.push(["block", this.woodId, new BoundingBox(fac * 13, 0, fac * 1, fac * 15, fac * 14, fac * 3)]);
        }
        if (legAt(x - 1, y, z) && legAt(x, y, z + 1)) {
            base.push(["block", this.woodId, new BoundingBox(fac * 1, 0, fac * 13, fac * 3, fac * 14, fac * 15)]);
        }
        if (legAt(x + 1, y, z) && legAt(x, y, z + 1)) {
            base.push(["block", this.woodId, new BoundingBox(fac * 13, 0, fac * 13, fac * 15, fac * 14, fac * 15)]);
        }

        return base;
    }

}
