import { VanillaChunk } from './chunk.mjs';

export class CarvingMask {
    constructor(minY, maxY) {
        if (![minY, maxY].every(Number.isSafeInteger) || maxY < minY) throw new RangeError('Invalid inclusive carving-mask Y range');
        this.minY = minY;
        this.maxY = maxY;
        this.height = maxY - minY + 1;
        this.bits = new Uint8Array(Math.ceil(256 * this.height / 8));
        this.size = 0;
    }

    #index(x, y, z) {
        if (![x, y, z].every(Number.isInteger) || x < 0 || x >= 16 || z < 0 || z >= 16 || y < this.minY || y > this.maxY) {
            throw new RangeError('Carving-mask position is outside its bounds');
        }
        return (x * 16 + z) * this.height + y - this.minY;
    }

    carve(x, y, z) {
        const index = this.#index(x, y, z);
        const byte = index >>> 3, bit = 1 << (index & 7);
        if (!(this.bits[byte] & bit)) {
            this.bits[byte] |= bit;
            this.size++;
        }
    }

    isCarved(x, y, z) {
        const index = this.#index(x, y, z);
        return (this.bits[index >>> 3] & (1 << (index & 7))) !== 0;
    }

    isEmpty() { return this.size === 0; }

    visit(visitor) {
        if (typeof visitor !== 'function') throw new TypeError('Expected a carving-mask visitor');
        for (let column = 0; column < 256; column++) {
            const x = (column >>> 4) & 15, z = column & 15;
            let y = this.minY;
            while (y <= this.maxY) {
                while (y <= this.maxY && !this.isCarved(x, y, z)) y++;
                if (y > this.maxY) break;
                const start = y;
                while (y < this.maxY && this.isCarved(x, y + 1, z)) y++;
                visitor(x, z, start, y);
                y++;
            }
        }
    }
}

export function createWorldgenCarvingMask(context, upgrading = false) {
    if (!Number.isSafeInteger(context?.minY) || !Number.isSafeInteger(context?.maxY) || context.maxY <= context.minY) throw new TypeError('Expected valid generation bounds');
    return new CarvingMask(context.minY + 1, context.maxY - 1 - (upgrading ? 0 : 7));
}

export function createCarverOutput(chunk, mask) {
    if (!(chunk instanceof VanillaChunk) || !(mask instanceof CarvingMask)) throw new TypeError('Expected a VanillaChunk and CarvingMask');
    if (mask.minY < chunk.minY || mask.maxY > chunk.minY + chunk.height || mask.maxY <= mask.minY) throw new RangeError('Carving mask does not fit the target chunk');
    return Object.freeze({ chunkX: chunk.chunkX, chunkZ: chunk.chunkZ, minY: mask.minY, height: mask.maxY - mask.minY, maxYInclusive: true });
}

export function applyCarvingMask(chunk, mask, {
    filter = () => true,
    isUncarvable,
    computeSubstance,
    isFluidEmpty,
    markFluidUpdate = () => {},
    isSurfaceCover,
    isDirt,
    topMaterial = () => null,
    setBlock = (x, y, z, state) => chunk.setBlock(x, y, z, state)
}) {
    if (!(chunk instanceof VanillaChunk) || !(mask instanceof CarvingMask)) throw new TypeError('Expected a VanillaChunk and CarvingMask');
    for (const [name, callback] of Object.entries({ filter, isUncarvable, computeSubstance, isFluidEmpty, markFluidUpdate, isSurfaceCover, isDirt, topMaterial, setBlock })) {
        if (typeof callback !== 'function') throw new TypeError(`Expected ${name} callback`);
    }

    const result = { visited: 0, filtered: 0, uncarvable: 0, aquiferSkipped: 0, replaced: 0, fluidUpdates: 0, topMaterials: 0 };
    mask.visit((x, z, minY, maxY) => {
        const worldX = chunk.chunkX * 16 + x, worldZ = chunk.chunkZ * 16 + z;
        for (let y = maxY; y >= minY; y--) {
            result.visited++;
            if (!filter(x, y, z)) { result.filtered++; continue; }
            const oldState = chunk.getBlock(x, y, z);
            if (isUncarvable(oldState, worldX, y, worldZ)) { result.uncarvable++; continue; }
            const cover = isSurfaceCover(oldState, worldX, y, worldZ);
            const replacement = computeSubstance(worldX, y, worldZ, 0);
            if (replacement == null) { result.aquiferSkipped++; continue; }
            const state = typeof replacement === 'object' ? replacement.state : replacement;
            if (!Number.isInteger(state) || state < 0 || state > 0xffffffff) throw new RangeError('Aquifer returned an invalid block state');
            setBlock(x, y, z, state);
            result.replaced++;
            if (replacement?.scheduleFluidUpdate && !isFluidEmpty(state, worldX, y, worldZ)) {
                markFluidUpdate(x, y, z);
                result.fluidUpdates++;
            }
            if (cover && y > chunk.minY && isDirt(chunk.getBlock(x, y - 1, z), worldX, y - 1, worldZ)) {
                const top = topMaterial({ x: worldX, y, z: worldZ, fluid: !isFluidEmpty(state, worldX, y, worldZ) });
                if (top != null) {
                    if (!Number.isInteger(top) || top < 0 || top > 0xffffffff) throw new RangeError('Surface rule returned an invalid block state');
                    setBlock(x, y - 1, z, top);
                    result.topMaterials++;
                }
            }
        }
    });
    return result;
}
