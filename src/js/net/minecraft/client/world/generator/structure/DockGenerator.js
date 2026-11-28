import {BlockRegistry} from "../../block/BlockRegistry.js";
import Generator from "../Generator.js";

const AIR_ID = 0;

const DIRECTIONS = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1]
];

/**
 * Small wooden dock that grows out of a beach into the water.
 *
 * Layout, looking down (L = oak log, P = oak planks):
 *
 *   L P P L
 *   L P P L
 *   L P P L   <- rows run from the shore out over the water
 *   L P P L
 *   L P P L   <- last row carries the tall corner posts
 *
 * The deck is laid into the top water layer, so its surface is exactly at the
 * water line instead of floating one block above it. The oak logs along the
 * sides are rotated to run lengthwise along the walkway. Oak log posts drop
 * from the deck to the sea floor, and on the last row they continue one block
 * above the deck so the end of the dock is marked by two posts sticking up.
 */
export default class DockGenerator extends Generator {

    static LENGTH = 6;             // one shore row plus five rows over water
    static MAX_WATER_DEPTH = 6;    // deepest floor a dock will stand on
    static ATTEMPTS = 10;          // shoreline searches per chunk

    constructor(world, seed, seaLevel = 120) {
        super(world, seed);

        this.seaLevel = seaLevel;

        this.LOG_ID = BlockRegistry.LOG.getId();
        this.PLANK_ID = BlockRegistry.WOOD.getId();
        this.WATER_ID = BlockRegistry.WATER.getId();
    }

    generateAtChunk(chunkX, chunkZ) {
        // Docks are a landmark, not coastline decoration: keep them sparse.
        if (this.random.nextInt(4) !== 0) {
            return false;
        }

        for (let attempt = 0; attempt < DockGenerator.ATTEMPTS; attempt++) {
            const x = chunkX * 16 + this.random.nextInt(16);
            const z = chunkZ * 16 + this.random.nextInt(16);

            const start = this.random.nextInt(DIRECTIONS.length);
            for (let i = 0; i < DIRECTIONS.length; i++) {
                const [dx, dz] = DIRECTIONS[(start + i) % DIRECTIONS.length];
                if (this.buildDock(x, z, dx, dz)) {
                    return true;
                }
            }
        }

        return false;
    }

    buildDock(x, z, dx, dz) {
        const sea = this.seaLevel;
        const length = DockGenerator.LENGTH;

        // Walkway axis and the perpendicular used for the two-block width.
        const px = -dz;
        const pz = dx;

        // The deck replaces the top water layer, so it sits at the water line.
        const deckY = sea - 1;

        // Log metadata: 1 runs the log along X, 2 runs it along Z.
        const logData = dx !== 0 ? 1 : 2;

        // The anchor must be dry, flat land with its surface at the waterline.
        const anchorId = this.getBlock(x, deckY, z);
        if (anchorId === AIR_ID || anchorId === this.WATER_ID) {
            return false;
        }
        if (this.getBlock(x, sea, z) !== AIR_ID) {
            return false;
        }

        // Every row past the shore must be open water we can bridge.
        const floors = [];
        for (let t = 1; t < length; t++) {
            const wx = x + dx * t;
            const wz = z + dz * t;

            if (this.getBlock(wx, deckY, wz) !== this.WATER_ID) {
                return false;
            }
            if (this.getBlock(wx, sea, wz) !== AIR_ID) {
                return false;
            }

            const floorY = this.getFloorY(wx, wz);
            if (floorY < deckY - DockGenerator.MAX_WATER_DEPTH) {
                return false;
            }
            floors.push(floorY);
        }

        // Never cut into terrain: the rows past the shore must be the top
        // water layer or open air, and nothing anywhere may sit above the deck.
        // The shore row itself lies on the beach, so it only replaces the top
        // ground layer there.
        for (let t = 0; t < length; t++) {
            for (let p = -1; p <= 2; p++) {
                const colX = x + dx * t + px * p;
                const colZ = z + dz * t + pz * p;

                if (t !== 0) {
                    const id = this.getBlock(colX, deckY, colZ);
                    if (id !== AIR_ID && id !== this.WATER_ID) {
                        return false;
                    }
                }
                if (this.getBlock(colX, sea, colZ) !== AIR_ID) {
                    return false;
                }
            }
        }

        // Deck: two wide oak plank walkway with an oak log edge on either side.
        for (let t = 0; t < length; t++) {
            const rowX = x + dx * t;
            const rowZ = z + dz * t;

            for (let p = 0; p <= 1; p++) {
                this.place(rowX + px * p, deckY, rowZ + pz * p, this.PLANK_ID);
            }
            for (const p of [-1, 2]) {
                this.place(rowX + px * p, deckY, rowZ + pz * p, this.LOG_ID, logData);
            }
        }

        // Oak log pillars under both edges, from the sea floor up to the deck.
        // On the last row they run one block past the deck, so the dock ends
        // in two posts that stick up out of the walkway.
        for (let t = 1; t < length; t++) {
            const rowX = x + dx * t;
            const rowZ = z + dz * t;
            const topY = t === length - 1 ? sea : deckY - 1;

            for (const p of [-1, 2]) {
                const colX = rowX + px * p;
                const colZ = rowZ + pz * p;

                for (let y = floors[t - 1] + 1; y <= topY; y++) {
                    const id = this.getBlock(colX, y, colZ);
                    if (id === AIR_ID || id === this.WATER_ID) {
                        this.place(colX, y, colZ, this.LOG_ID);
                    }
                }
            }
        }

        return true;
    }

    /** Topmost block of the sea floor, ignoring the water above it. */
    getFloorY(x, z) {
        for (let y = this.seaLevel - 1; y >= 0; y--) {
            const id = this.getBlock(x, y, z);
            if (id !== AIR_ID && id !== this.WATER_ID) {
                return y;
            }
        }
        return 0;
    }

    getBlock(x, y, z) {
        return this.world.getBlockAt(x, y, z);
    }

    place(x, y, z, typeId, data = 0) {
        this.world.setBlockAt(x, y, z, typeId, data);
    }
}
