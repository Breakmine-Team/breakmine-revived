export function readStructureNbt(bytes, { maxBytes = 32 * 1024 * 1024 } = {}) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > maxBytes) throw new RangeError('Invalid NBT input size');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = 0, elements = 0;
    function take(size) {
        if (offset + size > bytes.length) throw new RangeError('Truncated structure NBT');
        const start = offset; offset += size; return start;
    }
    const u8 = () => view.getUint8(take(1));
    const i32 = () => view.getInt32(take(4));
    function utf() {
        const size = view.getUint16(take(2)), end = offset + size, chars = [];
        take(size);
        for (let i = end - size; i < end;) {
            const a = bytes[i++];
            if (a < 128) chars.push(a);
            else if ((a & 224) === 192 && i < end) chars.push(((a & 31) << 6) | (bytes[i++] & 63));
            else if ((a & 240) === 224 && i + 1 < end) chars.push(((a & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
            else throw new TypeError('Malformed Java modified UTF-8');
        }
        return chars.map(c => String.fromCharCode(c)).join('');
    }
    function length() {
        const count = i32();
        if (count < 0 || (elements += count) > 2000000) throw new RangeError('NBT collection limit exceeded');
        return count;
    }
    function payload(type, depth) {
        if (depth > 128) throw new RangeError('NBT nesting limit exceeded');
        switch (type) {
            case 1: return view.getInt8(take(1));
            case 2: return view.getInt16(take(2));
            case 3: return i32();
            case 4: return view.getBigInt64(take(8));
            case 5: return view.getFloat32(take(4));
            case 6: return view.getFloat64(take(8));
            case 7: { const count = length(); return bytes.slice(take(count), offset); }
            case 8: return utf();
            case 9: { const child = u8(), count = length(); if (child === 0 && count) throw new TypeError('Invalid NBT list type'); return Array.from({ length: count }, () => payload(child, depth + 1)); }
            case 10: {
                const compound = Object.create(null);
                for (let child; (child = u8()) !== 0;) {
                    if (++elements > 2000000) throw new RangeError('NBT entry limit exceeded');
                    const name = utf(); compound[name] = payload(child, depth + 1);
                }
                return compound;
            }
            case 11: return Array.from({ length: length() }, i32);
            case 12: return Array.from({ length: length() }, () => view.getBigInt64(take(8)));
            default: throw new TypeError(`Unknown NBT type: ${type}`);
        }
    }
    if (u8() !== 10) throw new TypeError('Structure NBT root must be a compound');
    utf();
    const result = payload(10, 0);
    if (offset !== bytes.length) throw new TypeError('Trailing structure NBT bytes');
    return result;
}

export async function decodeStructureNbt(base64, options = {}) {
    if (typeof base64 !== 'string') throw new TypeError('Expected imported base64 structure resource');
    const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
    if (bytes[0] !== 31 || bytes[1] !== 139) return readStructureNbt(bytes, options);
    const reader = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
    const chunks = []; let total = 0;
    try {
        while (true) {
            const { value, done } = await reader.read(); if (done) break;
            total += value.length;
            if (total > (options.maxBytes ?? 32 * 1024 * 1024)) throw new RangeError('Inflated NBT size limit exceeded');
            chunks.push(value);
        }
    } finally { await reader.cancel(); }
    const inflated = new Uint8Array(total); let offset = 0;
    for (const chunk of chunks) { inflated.set(chunk, offset); offset += chunk.length; }
    return readStructureNbt(inflated, options);
}

export function normalizeStructureTemplate(nbt) {
    const size = nbt.size;
    if (!Array.isArray(size) || size.length !== 3 || !size.every(v => Number.isInteger(v) && v >= 0 && v <= 1024)) throw new RangeError('Invalid structure size');
    const palettes = nbt.palettes ?? (nbt.palette ? [nbt.palette] : []);
    const states = palettes.map(palette => palette.map(s => {
        const name = s.id ?? s.Name;
        if (typeof name !== 'string') throw new TypeError('Malformed structure palette state');
        return { name, properties: { ...(s.properties ?? s.Properties) } };
    }));
    const blocks = (nbt.blocks ?? []).map(b => {
        if (!Array.isArray(b.pos) || b.pos.length !== 3 || !b.pos.every(Number.isInteger) || !Number.isInteger(b.state) || b.state < 0 || states.some(p => !p[b.state])) throw new TypeError('Malformed structure block');
        return { pos: { x: b.pos[0], y: b.pos[1], z: b.pos[2] }, state: b.state, nbt: b.nbt ?? null };
    });
    return { size: [...size], palettes: states, blocks, entities: nbt.entities ?? [], dataVersion: nbt.DataVersion };
}

export async function createStructureTemplateRegistry(data, ids) {
    const templates = new Map();
    const names = ids ?? Object.keys(data).filter(k => k.startsWith('data/minecraft/structure/') && k.endsWith('.nbt')).map(k => `minecraft:${k.slice(25, -4)}`);
    for (const id of names) {
        if (typeof id !== 'string' || !/^minecraft:[a-z0-9_/]+$/.test(id)) throw new TypeError('Invalid structure resource ID');
        const source = data[`data/minecraft/structure/${id.slice(10)}.nbt`];
        if (source === undefined) throw new Error(`Missing structure template: ${id}`);
        templates.set(id, normalizeStructureTemplate(await decodeStructureNbt(source)));
    }
    return { ids: Object.freeze([...templates.keys()]), get(id) {
        if (!templates.has(id)) throw new Error(`Structure template not loaded: ${id}`);
        return templates.get(id);
    } };
}
