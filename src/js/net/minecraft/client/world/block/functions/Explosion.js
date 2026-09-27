import Block from "../Block.js";

export default function explodeCraterAt(world, x, y, z, radius, size) {
    const CENTER_X = x;
    const CENTER_Y = y;
    const CENTER_Z = z;
    const RADIUS = radius / 2;
    const RADIUS_SQUARED = RADIUS * RADIUS;
    for (let x1 = CENTER_X - size; x1 <= CENTER_X + size; x1++) {
        for (let z1 = CENTER_Z - size; z1 <= CENTER_Z + size; z1++) {
            for (let y1 = CENTER_Y - size; y1 <= CENTER_Y + size; y1++) {
                const dx = CENTER_X - x1;
                const dy = CENTER_Y - y1;
                const dz = CENTER_Z - z1;

                const distanceSquared = (dx * dx) + (dy * dy) + (dz * dz);
                if (distanceSquared <= RADIUS_SQUARED) {
                    if (world.getBlockAt(x1, y1, z1) !== 7 && world.getBlockAt(x1, y1, z1) !== 49) {
                        let gotType = world.getBlockAt(x1, y1, z1);
                        if (gotType === 46 || gotType === 69 || gotType === 122) {
                            world.setBlockAt(x, y, z, 0, true);
                            
                            let size2 = 5;
                            let radius2 = 3;
                            if (gotType === 69) {
                                size2 = 120;
                                radius2 = 120/2;
                            } else if (gotType === 122) {
                                size2 = 500;
                                radius2 = 500/2;
                            }
                            explodeCraterAt(world, x1, y1, z1, size2, radius2);
                            world.minecraft.soundManager.playSound(
                                "explode",
                                x1,
                                y1,
                                z1,
                                1.0,
                                1.0
                            );
                        }
                        world.setBlockAt(x1, y1, z1, 0, true);
                        //console.log(Math.trunc(world.minecraft.player.getBlockPosX()), Math.trunc(world.minecraft.player.getBlockPosY()), Math.trunc(world.minecraft.player.getBlockPosZ()));
                        //console.log(x1, y1, z1);
                        if (Math.trunc(world.minecraft.player.getBlockPosX()) === x1 && Math.trunc(world.minecraft.player.getBlockPosY()) === y1 && Math.trunc(world.minecraft.player.getBlockPosZ()) === z1) {
                            if (!world.minecraft.player.creative) {
                                if (gotType === 69 || gotType === 122) {
                                    world.minecraft.player.health = 0;
                                    world.minecraft.player.typeOfDeath = 'wiped off the face of the Earth';
                                } else {
                                    world.minecraft.player.health += -3;
                                    world.minecraft.player.typeOfDeath = 'blew up';
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}