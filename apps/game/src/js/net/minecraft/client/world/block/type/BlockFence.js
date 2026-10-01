import Block from "../Block.js";
import EnumBlockFace from "../../../../util/EnumBlockFace.js";
import BoundingBox from "../../../../util/BoundingBox.js";

export default class BlockFence extends Block {

    constructor(id, textureSlotId, woodName, woodId) {
        super(id, textureSlotId);
        this.description = woodName.charAt(0).toUpperCase() + woodName.slice(1) + " Fence";
        this.woodId = woodId;
        this.woodName = woodName;

        this.hardness = 2.0;
        this.multipart = true;
        this.noFaceCull = true;
    }
    
    getPreferredToolType() {
        return 'axe';
    }

    getAmbientOcclusion() {
        return false;
    }

    canCastAmbientOcclusion() {
        return false;
    }

    getTextureForFace(face, data, x, y, z, world) {
        return `${this.woodName}_planks`;
    }

    onBlockPlaced(world, x, y, z, face) {
        // Mark neighbors as modified so they update their connections
        world.onBlockChanged(x - 1, y, z);
        world.onBlockChanged(x + 1, y, z);
        world.onBlockChanged(x, y, z - 1);
        world.onBlockChanged(x, y, z + 1);
    }
    
    getMultipart(world, x, y, z) {
        const fac = 1/16;
        const pole = new BoundingBox(fac*6, 0, fac*6, fac*10, 1, fac*10);
        let base = [
            ["block", this.woodId, pole],
            ["bbox", this.woodId, pole]
        ];

        
        const neighbors = [
            {dx: 0, dy: 0, dz: -1}, {dx: 0, dy: 0, dz: 1},
            {dx: -1, dy: 0, dz: 0}, {dx: 1, dy: 0, dz: 0}
        ];

        if (world !== null) {
            for (const {dx, dy, dz} of neighbors) {
                const nx = x + dx;
                const ny = y + dy;
                const nz = z + dz;
                let blockAt = world.getBlockAt(nx, ny, nz);
                let blockTypeAt = Block.getById(blockAt);
                if (blockTypeAt !== null && (blockTypeAt.isSolid() || blockTypeAt instanceof BlockFence)) {
                    // X
                    if (dx === -1) {
                        base.push(["block", this.woodId, new BoundingBox(
                            0, fac*12, fac*7, 
                            0.5, fac*15, fac*9
                        )]);
                        base.push(["block", this.woodId, new BoundingBox(
                            0, fac*6, fac*7, 
                            0.5, fac*9, fac*9
                        )]);
                    }
                    if (dx === 1) {
                        base.push(["block", this.woodId, new BoundingBox(
                            0.5, fac*12, fac*7, 
                            1, fac*15, fac*9
                        )]);
                        base.push(["block", this.woodId, new BoundingBox(
                            0.5, fac*6, fac*7, 
                            1, fac*9, fac*9
                        )]);
                    }

                    // Z
                    if (dz === -1) {
                        base.push(["block", this.woodId, new BoundingBox(
                            fac*7, fac*12, 0, 
                            fac*9, fac*15, 0.5
                        )]);
                        base.push(["block", this.woodId, new BoundingBox(
                            fac*7, fac*6, 0, 
                            fac*9, fac*9, 0.5
                        )]);
                    }
                    if (dz === 1) {
                        base.push(["block", this.woodId, new BoundingBox(
                            fac*7, fac*12, 0.5, 
                            fac*9, fac*15, 1
                        )]);
                        base.push(["block", this.woodId, new BoundingBox(
                            fac*7, fac*6, 0.5, 
                            fac*9, fac*9, 1
                        )]);
                    }
                }
            }
        }

        return base;
    }
    
}