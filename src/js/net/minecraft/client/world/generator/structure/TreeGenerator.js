import {BlockRegistry} from "../../block/BlockRegistry.js";
import Generator from "../Generator.js";

export default class TreeGenerator extends Generator {

    constructor(world, seed, woodType = "oak") {
        super(world, seed);

        this.size = 8;
        this.woodType = woodType;
        this.leaveBlock = BlockRegistry[`${woodType.toUpperCase()}_LEAVES`] || BlockRegistry.LEAVE;
        this.logBlock = BlockRegistry[`${woodType.toUpperCase()}_LOG`] || BlockRegistry.LOG;
    }

    generateAtBlock(x, y, z) {
        let height = this.random.nextInt(3) + 4;
        if (this.woodType === "spruce") {
            height += 3;
        }
        if (y < 1 || y + height + 1 > Generator.TOTAL_HEIGHT) {
            return false;
        }

        for (let totalY = y; totalY <= y + 1 + height; totalY++) {
            let radius = 1;
            if (totalY === y) radius = 0;
            if (totalY >= (y + 1 + height) - 2) radius = 2;
            for (let totalX = x - radius; totalX <= x + radius; totalX++) {
                for (let totalZ = z - radius; totalZ <= z + radius; totalZ++) {
                    if (totalY >= 0 && totalY < Generator.TOTAL_HEIGHT) {
                        let typeId = this.world.getBlockAt(totalX, totalY, totalZ);
                        if (typeId !== 0 && typeId !== this.leaveBlock.getId()) {
                            return;
                        }
                    } else {
                        return;
                    }
                }
            }
        }

        let typeIdBelowTree = this.world.getBlockAt(x, y - 1, z);
        if (typeIdBelowTree !== BlockRegistry.GRASS.getId() && typeIdBelowTree !== BlockRegistry.DIRT.getId() || y >= Generator.TOTAL_HEIGHT - height - 1) {
            return false;
        }

        this.world.setBlockAt(x, y - 1, z, BlockRegistry.DIRT.getId());

        if (this.woodType === "spruce") {
            let radii = [3,3,2,2,1,1,0];
            for (let i = 0; i < radii.length; i++) {
                let totalY = y + i + 2;
                let radius = radii[i];
                for (let dx = -radius; dx <= radius; dx++) {
                    for (let dz = -radius; dz <= radius; dz++) {
                        if (Math.abs(dx) + Math.abs(dz) <= radius + 1) {
                            let tx = x + dx, tz = z + dz;
                            if (this.world.getBlockAt(tx, totalY, tz) === 0) {
                                this.world.setBlockAt(tx, totalY + 4, tz, this.leaveBlock.getId());
                            }
                        }
                    }
                }
            }
            for (let i = 0; i < height + 2; i++) {
                let typeId = this.world.getBlockAt(x, y + i, z);
                if (typeId === 0 || typeId === this.leaveBlock.getId()) {
                    this.world.setBlockAt(x, y + i, z, this.logBlock.getId());
                }
            }
        } else {
            for (let totalY = (y - 3) + height; totalY <= y + height; totalY++) {
                let offsetY = totalY - (y + height);
                let radius = Math.floor(1 - offsetY / 2);
                
                for (let totalX = x - radius; totalX <= x + radius; totalX++) {
                    let offsetX = totalX - x;
                    for (let totalZ = z - radius; totalZ <= z + radius; totalZ++) {
                        let offsetZ = totalZ - z;
                        
                        // Unconditionally skip the 4 corners of the second-to-top layer
                        if (offsetY === -1 && Math.abs(offsetX) === radius && Math.abs(offsetZ) === radius) {
                            continue;
                        }

                        if (Math.abs(offsetX) !== radius || Math.abs(offsetZ) !== radius || (this.random.nextInt(2) !== 0 && offsetY !== 0)) {
                            this.world.setBlockAt(totalX, totalY, totalZ, this.leaveBlock.getId());
                        }
                    }
                }
            }
            for (let i = 0; i < height; i++) {
                let typeId = this.world.getBlockAt(x, y + i, z);
                if (typeId === 0 || typeId === this.leaveBlock.getId()) {
                    this.world.setBlockAt(x, y + i, z, this.logBlock.getId());
                }
            }
        }

        return true;
    }
}