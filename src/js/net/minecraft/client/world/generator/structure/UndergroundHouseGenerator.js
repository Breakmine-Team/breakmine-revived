import { BlockRegistry } from "../../block/BlockRegistry.js";
import Generator from "../Generator.js";

export default class UndergroundHouseGenerator extends Generator {

    static STRUCT = 9;    
    static HEIGHT = 6;    

    // Hard limit on how many different y levels a single house may use, so a
    // run of shaft rooms can never turn into an endless vertical corridor.
    static MAX_FLOORS = 6;

    static FACES = ["n", "e", "s", "w"];

    constructor(world, seed) {
        super(world, seed);

        this._s = (typeof seed === "number" ? seed : 0) ^ 0x9e3779b9;
        this.rng = this._mulberry32(this._s);

        const R = BlockRegistry;
        this.B = {
            COBBLE: R.COBBLE_STONE.id,
            PLANKS: R.WOOD.id,
            MOSSY: R.MOSSY_COBBLESTONE.id,
            LAVA: R.LAVA.id,
            WATER: R.WATER.id,
            FURNACE: R.FURNACE.id,
            CHEST: R.CHEST.id,
            LADDER: R.OAK_LADDER.id,
            FENCE: R.FENCE.id,
            TABLE: R.OAK_TABLE.id,
            BOOKSHELF: R.BOOKSHELF.id,
            BRICK: R.BRICK.id,
            FARMLAND: R.FARMLAND.id,
            WHEAT: R.WHEAT_CROP.id,
            BUSH: R.BUSH.id,
            BROWN_WOOL: R.BROWN_WOOL.id,
            WHITE_WOOL: R.WHITE_WOOL.id,
            RED_WOOL: R.RED_WOOL.id,
            GRAY_WOOL: R.GRAY_WOOL.id,
            CRAFTING_TABLE: R.CRAFTING_TABLE.id,
        };

        this.SHELL = [this.B.COBBLE, this.B.MOSSY];

        this.roomBoxes = [];
        this.connections = [];
    }


    _mulberry32(a) {
        return function () {
            a |= 0; a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    getRandomInt(min, max) {
        return Math.floor(this.rng() * (max - min + 1)) + min;
    }

    pick(arr) {
        return arr[this.getRandomInt(0, arr.length - 1)];
    }

    chance(percent) {
        return this.getRandomInt(0, 100) < percent;
    }


    
    static get PIECES() {
        return [
            { name: "storage",   conns: ["w"],       decorate: "storage" },
            { name: "library",   conns: ["n", "s"],  decorate: "library" },
            { name: "farm",      conns: ["n", "e", "s", "w"], decorate: "farm" },
            { name: "kitchen",   conns: ["n", "e", "s"], decorate: "kitchen" },
            { name: "bedroom",   conns: ["w"],       decorate: "bedroom" },
            { name: "forge",     conns: ["e", "w"],  decorate: "forge" },
            { name: "treasure",  conns: ["s"],       decorate: "treasure" },
            { name: "fungarium", conns: ["n", "e"],  decorate: "fungarium" },
            { name: "hallway",   conns: ["n", "s"],  decorate: "hallway" },
            { name: "hallway",   conns: ["n", "s"],  decorate: "hallway" },
        ];
    }

    
    static get SHAFT_PIECE() {
        return { name: "shaft", conns: [], decorate: "shaft" };
    }

    
    static rotateFace(face, r) {
        const order = ["n", "e", "s", "w"];
        return order[(order.indexOf(face) + r) % 4];
    }

    
    rotatedConns(piece, r) {
        return piece.conns.map(f => UndergroundHouseGenerator.rotateFace(f, r));
    }


    setBlock(x, y, z, id) {
        this.world.setBlockAt(x, y, z, id);
    }

    getBlock(x, y, z) {
        return this.world.getBlockAt(x, y, z);
    }

    isSolidAt(x, y, z) {
        const id = this.getBlock(x, y, z);
        return id !== 0 && id !== 999;
    }

    insideRoom(x, y, z) {
        for (const b of this.roomBoxes) {
            if (x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1 && z >= b.z0 && z <= b.z1) return true;
        }
        return false;
    }


    
    buildPiece(cornerX, cornerY, cornerZ, piece, r = 0) {
        const S = UndergroundHouseGenerator.STRUCT;
        const H = UndergroundHouseGenerator.HEIGHT;

        for (let lx = 0; lx < S; lx++) {
            for (let ly = 0; ly < H; ly++) {
                for (let lz = 0; lz < S; lz++) {
                    const edge = lx === 0 || lx === S - 1 || lz === 0 || lz === S - 1 || ly === 0 || ly === H - 1;
                    this.setBlock(cornerX + lx, cornerY + ly, cornerZ + lz,
                        edge ? this.pick(this.SHELL) : 0);
                }
            }
        }

        this.decoratePiece(cornerX, cornerY, cornerZ, piece, r);

        const mid = S >> 1;
        for (const f of this.rotatedConns(piece, r)) {
            for (let d = 1; d <= 2; d++) {
                for (let ly = 1; ly <= 3; ly++) {
                    for (let k = 0; k < 2; k++) {
                        let wx = cornerX, wz = cornerZ;
                        if (f === "n")      { wx += mid + k; wz += d; }
                        else if (f === "s") { wx += mid + k; wz += S - 1 - d; }
                        else if (f === "w") { wx += d; wz += mid + k; }
                        else                { wx += S - 1 - d; wz += mid + k; }
                        this.setBlock(wx, cornerY + ly, wz, 0);
                    }
                }
            }
        }

        this.roomBoxes.push({
            x0: cornerX, x1: cornerX + S - 1,
            y0: cornerY, y1: cornerY + H - 1,
            z0: cornerZ, z1: cornerZ + S - 1,
        });
    }

    
    placeLocal(cornerX, cornerY, cornerZ, r, lx, ly, lz, id) {
        const S = UndergroundHouseGenerator.STRUCT;
        let wx = lx, wz = lz;
        if (r === 1) { wx = S - 1 - lz; wz = lx; }
        else if (r === 2) { wx = S - 1 - lx; wz = S - 1 - lz; }
        else if (r === 3) { wx = lz; wz = S - 1 - lx; }
        this.setBlock(cornerX + wx, cornerY + ly, cornerZ + wz, id);
    }


    decoratePiece(cornerX, cornerY, cornerZ, piece, r) {
        const B = this.B;
        const S = UndergroundHouseGenerator.STRUCT;
        const H = UndergroundHouseGenerator.HEIGHT;
        const place = (lx, ly, lz, id) => this.placeLocal(cornerX, cornerY, cornerZ, r, lx, ly, lz, id);
        const mid = S >> 1; 

        const decorators = {
            storage: () => {
                const spots = [];
                for (let i = 2; i < S - 2; i++) {
                    spots.push([i, 1, 1]);
                    spots.push([i, 1, S - 2]);
                }
                for (let j = 2; j < S - 2; j++) spots.push([1, 1, j]);
                let n = 0;
                for (const [sx, sy, sz] of spots) {
                    if (n >= 3) break;
                    if (this.chance(30)) { place(sx, sy, sz, B.CHEST); n++; }
                }
            },
            library: () => {
                for (let i = 2; i < S - 2; i++) {
                    if (this.chance(75)) place(i, 1, 1, B.BOOKSHELF);
                    if (this.chance(55)) place(i, 2, 1, B.BOOKSHELF);
                    if (this.chance(60)) place(1, 1, i, B.BOOKSHELF);
                }
                place(mid, 1, mid + 2, B.TABLE);
            },
            farm: () => {
                for (let i = 1; i < S - 1; i++) {
                    for (let j = 1; j < S - 1; j++) {
                        if (i === mid) {
                            place(i, 0, j, B.WATER);
                        } else {
                            place(i, 0, j, B.FARMLAND);
                            place(i, 1, j, B.WHEAT);
                        }
                    }
                }
            },
            kitchen: () => {
                let furnaces = 0;
                for (let i = 2; i < S - 2; i++) {
                    if (furnaces < 2 && this.chance(30)) { place(i, 1, 1, B.FURNACE); furnaces++; }
                    else place(i, 1, 1, B.WHITE_WOOL);
                }
                place(mid, 1, 1, B.CRAFTING_TABLE);
                place(1, 1, mid, B.TABLE);
            },
            bedroom: () => {
                const bedMat = this.pick([B.RED_WOOL, B.WHITE_WOOL, B.BROWN_WOOL]);
                place(2, 1, 2, B.FENCE);
                place(2, 1, 3, bedMat);
                place(2, 1, 4, bedMat);
                for (let i = 4; i < S - 3; i++) {
                    for (let j = 4; j < S - 3; j++) {
                        if (this.chance(50)) place(i, 0, j, this.pick([B.GRAY_WOOL, bedMat, B.WHITE_WOOL]));
                    }
                }
            },
            forge: () => {
                place(mid, 0, mid, B.LAVA);
                place(2, 1, S - 2, B.FURNACE);
                if (this.chance(70)) place(3, 1, S - 2, B.FURNACE);
            },
            treasure: () => {
                place(mid, 1, mid, B.CHEST);
                if (this.chance(60)) place(mid, 2, mid, B.CHEST);
                const corners = [[2, 2], [2, S - 3], [S - 3, 2], [S - 3, S - 3]];
                for (const [ix, iz] of corners) {
                    if (this.chance(70)) place(ix, 1, iz, B.CHEST);
                }
            },
            fungarium: () => {
                for (let i = 2; i < S - 2; i++) {
                    for (let j = 2; j < S - 2; j++) {
                        if (this.chance(30)) place(i, 1, j, B.BUSH);
                    }
                }
            },
            shaft: () => {
                const a = S >> 1, b = (S >> 1) + 1;
                for (let lx = 1; lx < S - 1; lx++) {
                    for (let ly = 1; ly < H - 1; ly++) {
                        for (let lz = 1; lz < S - 1; lz++) {
                            const inShaft = lx >= a && lx <= b && lz >= a && lz <= b;
                            place(lx, ly, lz, inShaft ? 0 : this.pick(this.SHELL));
                        }
                    }
                }
                for (let ly = 1; ly < H - 1; ly++) {
                    place(a, ly, a, B.LADDER);
                    place(a, ly, a - 1, B.COBBLE);   
                }
            },
            hallway: () => {
                for (let lx = 0; lx < S; lx++) {
                    for (let ly = 1; ly < H - 1; ly++) {
                        for (let lz = 0; lz < S; lz++) {
                            if (ly <= 3 && (lx === mid || lx === mid + 1)) {
                                place(lx, ly, lz, 0);          
                            } else {
                                place(lx, ly, lz, this.pick(this.SHELL)); 
                            }
                        }
                    }
                }
            },
        };

        (decorators[piece.decorate] || decorators.storage)();
    }


    
    carveDoorAt(cornerX, cornerY, cornerZ, face) {
        const S = UndergroundHouseGenerator.STRUCT;
        const mid = S >> 1; 
        for (let ly = 1; ly <= 3; ly++) {
            if (face === "n") {
                this.setBlock(cornerX + mid, cornerY + ly, cornerZ, 0);
                this.setBlock(cornerX + mid + 1, cornerY + ly, cornerZ, 0);
            } else if (face === "s") {
                this.setBlock(cornerX + mid, cornerY + ly, cornerZ + S - 1, 0);
                this.setBlock(cornerX + mid + 1, cornerY + ly, cornerZ + S - 1, 0);
            } else if (face === "w") {
                this.setBlock(cornerX, cornerY + ly, cornerZ + mid, 0);
                this.setBlock(cornerX, cornerY + ly, cornerZ + mid + 1, 0);
            } else if (face === "e") {
                this.setBlock(cornerX + S - 1, cornerY + ly, cornerZ + mid, 0);
                this.setBlock(cornerX + S - 1, cornerY + ly, cornerZ + mid + 1, 0);
            }
        }
    }

    
    carveVertical(lower, upper) {
        const B = this.B;
        const S = UndergroundHouseGenerator.STRUCT;
        const a = S >> 1, b = (S >> 1) + 1; 

        const yLow = lower.y + 1;          
        const yHigh = upper.y + 2;         
        for (let y = yLow; y <= yHigh; y++) {
            if (y <= upper.y) {
                this.setBlock(lower.x + a, y, lower.z + a, B.LADDER);
                const back = this.getBlock(lower.x + a, y, lower.z + a - 1);
                if (back === undefined || back === 0) {
                    this.setBlock(lower.x + a, y, lower.z + a - 1, B.COBBLE);
                }
                this.setBlock(lower.x + b, y, lower.z + a, 0);
                this.setBlock(lower.x + a, y, lower.z + b, 0);
                this.setBlock(lower.x + b, y, lower.z + b, 0);
            } else {
                const cur = this.getBlock(lower.x + a, y, lower.z + a);
                if (cur !== B.LADDER) this.setBlock(lower.x + a, y, lower.z + a, 0);
                this.setBlock(lower.x + b, y, lower.z + a, 0);
                this.setBlock(lower.x + a, y, lower.z + b, 0);
                this.setBlock(lower.x + b, y, lower.z + b, 0);
            }
        }
        this.connections.push({ lower, upper });
    }

    
    connectHorizontal(parent, child, dir) {
        const opposite = { n: "s", s: "n", e: "w", w: "e" };
        this.carveDoorAt(parent.x, parent.y, parent.z, dir);
        this.carveDoorAt(child.x, child.y, child.z, opposite[dir]);
        this.connections.push({ a: parent, b: child, dir });
    }


    
    loadStructure(structure, x, y, z, randomCobblestone = false) {
        if (structure && typeof structure === "object") {
            Object.keys(structure).forEach(key => {
                const pos = key.split(",");
                let realId = structure[key];
                if (realId === 999) realId = 0;
                if (realId === this.B.COBBLE && randomCobblestone && this.chance(30)) realId = this.B.MOSSY;
                this.setBlock(Number(pos[0]) + x, Number(pos[1]) + y, Number(pos[2]) + z, realId);
            });
        } else {
            const piece = this.pick(UndergroundHouseGenerator.PIECES);
            this.buildPiece(x, y, z, piece, 0);
        }
    }

    
    getRandomPiece() {
        const rooms = UndergroundHouseGenerator.PIECES.filter(p => p.name !== "shaft");
        return this.pick(rooms);
    }

    
    pickMatchingPiece(requiredFace) {
        const candidates = [];
        for (const piece of UndergroundHouseGenerator.PIECES) {
            for (let r = 0; r < 4; r++) {
                if (this.rotatedConns(piece, r).includes(requiredFace)) {
                    candidates.push({ piece, r });
                }
            }
        }
        return this.pick(candidates);
    }

    checkNeighborStatus(x, y, z) {
        const BLOCK_OFFSET = 6;
        const neighborMap = {};
        const neighborOffsets = {
            e: { dx: BLOCK_OFFSET, dy: 0, dz: 0 },
            w: { dx: -BLOCK_OFFSET, dy: 0, dz: 0 },
            t: { dx: 0, dy: BLOCK_OFFSET, dz: 0 },
            b: { dx: 0, dy: -BLOCK_OFFSET, dz: 0 },
            n: { dx: 0, dy: 0, dz: -BLOCK_OFFSET },
            s: { dx: 0, dy: 0, dz: BLOCK_OFFSET },
        };
        for (const [direction, { dx, dy, dz }] of Object.entries(neighborOffsets)) {
            neighborMap[direction] = this.getBlock(x + dx, y + dy, z + dz) === 0;
        }
        return neighborMap;
    }


    
    generateAtBlock(x1, y1, z1, min = 15, max = 24) {
        const G = UndergroundHouseGenerator;
        const S = G.STRUCT, H = G.HEIGHT;
        const MAX_ROOMS = this.getRandomInt(min, max);
        const placed = new Set();
        const rooms = [];   
        const key = (x, y, z) => `${x},${y},${z}`;

        const origin = this.getRandomPiece();
        this.buildPiece(x1, y1, z1, origin, 0);
        rooms.push({ x: x1, y: y1, z: z1, piece: origin, r: 0 });
        placed.add(key(x1, y1, z1));

        const queue = [{ x: x1, y: y1, z: z1, depth: 0 }];
        const offsets = [
            { dx: 0, dz: -S, dir: "n" },
            { dx: S, dz: 0, dir: "e" },
            { dx: 0, dz: S, dir: "s" },
            { dx: -S, dz: 0, dir: "w" },
            { dx: 0, dz: 0, dy: H, dir: "t" },    
            { dx: 0, dz: 0, dy: -H, dir: "b" },
        ];

        let count = 1;

        // Distinct y levels used by the house. New floors are only allowed
        // while under MAX_FLOORS, which bounds how tall the house can get.
        const floors = new Set([y1]);

        while (queue.length > 0 && count < MAX_ROOMS) {
            const current = queue.shift();
            const { x, y, z, depth } = current;

            const maxBranches = depth === 0 ? 6 : this.getRandomInt(1, 3);
            const shuffled = [...offsets].sort(() => this.rng() - 0.5);
            let branches = 0;
            const here = rooms.find(r => r.x === x && r.y === y && r.z === z);

            const tryBranch = (o) => {
                const nx = x + o.dx, ny = y + (o.dy || 0), nz = z + o.dz;
                const nk = key(nx, ny, nz);
                if (placed.has(nk)) return false;
                if (![nx, ny, nz].every(Number.isFinite)) return false;
                if (o.dy && floors.size >= G.MAX_FLOORS) return false;

                const parent = here;
                if (!parent) return false;

                if (o.dy) {
                    const piece = UndergroundHouseGenerator.SHAFT_PIECE;
                    this.buildPiece(nx, ny, nz, piece, 0);
                    if (o.dy > 0) {
                        this.carveVertical(parent, { x: nx, y: ny, z: nz });
                    } else {
                        this.carveVertical({ x: nx, y: ny, z: nz }, parent);
                    }
                    rooms.push({ x: nx, y: ny, z: nz, piece, r: 0 });
                    floors.add(ny);
                } else {
                    // Shafts double as landings: the 2x2 chimney sits in the
                    // middle of the piece, so a doorway on any side opens into
                    // it and lets that floor spread out from the stairs.
                    const parentFaces = parent.piece.name === "shaft"
                        ? UndergroundHouseGenerator.FACES
                        : this.rotatedConns(parent.piece, parent.r);
                    if (!parentFaces.includes(o.dir)) return false;
                    const requiredFace = { n: "s", s: "n", e: "w", w: "e" }[o.dir];
                    const { piece, r } = this.pickMatchingPiece(requiredFace);
                    this.buildPiece(nx, ny, nz, piece, r);
                    this.connectHorizontal(parent, { x: nx, y: ny, z: nz }, o.dir);
                    rooms.push({ x: nx, y: ny, z: nz, piece, r });
                }

                placed.add(nk);
                queue.push({ x: nx, y: ny, z: nz, depth: depth + 1 });
                return true;
            };

            // Spread sideways first: every free horizontal neighbour of this
            // room is tried before a shaft is even considered, so the house
            // grows outwards rather than climbing.
            for (const o of shuffled) {
                if (o.dy) continue;
                if (branches >= maxBranches || count >= MAX_ROOMS) break;
                if (!tryBranch(o)) continue;
                branches++;
                count++;
            }

            // Ordinary rooms only dig once they have nowhere to go sideways,
            // but a shaft always keeps descending so the house can reach its
            // other floors. Never past the floor limit either way.
            const isShaftRoom = !!here && here.piece.name === "shaft";
            if ((branches === 0 || isShaftRoom) && floors.size < G.MAX_FLOORS) {
                for (const o of shuffled) {
                    if (!o.dy) continue;
                    if (branches >= maxBranches || count >= MAX_ROOMS) break;
                    if (!tryBranch(o)) continue;
                    branches++;
                    count++;
                }
            }

            if (branches === 0 && count < MAX_ROOMS && (current.retries || 0) < 4) {
                queue.push({ x, y, z, depth, retries: (current.retries || 0) + 1 });
            }
        }

        return true;
    }
}