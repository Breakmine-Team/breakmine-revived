const binary = { add: 1, mul: 2, sub: 3, div: 4, min: 13, max: 14 };
const idPattern = /^minecraft:[a-z0-9_/]+$/;
export const CLIMATE_FIELDS = Object.freeze(['temperature', 'vegetation', 'continents', 'erosion', 'depth', 'ridges']);

export function compileDensityGraph(wasm, owned, createNoise, data, roots, seed, legacyRandom,
    { experimentalScalarMemoReuse = false, experimentalBatchDensityQueries = false, cacheWrapperPrototype = false,
        cacheWrapperProfile = false } = {}) {
    const handle = owned(wasm.density_create(), wasm.density_free);
    const references = new Map();
    const active = new Set();
    const noises = new Map();
    const indices = new Map();
    const cacheInputIds = new Map();
    const cacheWrappers = [];
    let currentRoot = 'unscoped';
    let currentSource = 'inline';
    let depth = 0;
    const number = value => {
        if (!Number.isFinite(value)) throw new TypeError('Expected a finite density parameter');
        return value;
    };
    const integer = value => {
        if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) throw new RangeError('Expected a Java int');
        return value;
    };
    const node = (op, a=0, b=0, c=0, p=0, q=0, r=0, s=0) => wasm.density_node(handle.get(), op,a,b,c,p,q,r,s);
    function noise(id) {
        if (typeof id !== 'string' || !idPattern.test(id)) throw new TypeError('Expected a named noise');
        if (!noises.has(id)) {
            const parameters = data[`data/minecraft/worldgen/noise/${id.slice(10)}.json`];
            if (!parameters) throw new Error(`Missing noise definition: ${id}`);
            noises.set(id, createNoise(handle.get(), id, parameters));
        }
        return noises.get(id);
    }
    function spline(value) {
        if (typeof value === 'number') return compile(value);
        if (!value || !Array.isArray(value.points) || value.points.length === 0) throw new TypeError('Spline requires points');
        const coordinate = compile(value.coordinate);
        let previous = -Infinity;
        const points = value.points.map(point => {
            const location = Math.fround(number(point.location));
            if (location <= previous) throw new RangeError('Spline locations must increase after float32 conversion');
            previous = location;
            if (++depth > 128) throw new Error('Density graph exceeds maximum depth');
            let child;
            try { child = spline(point.value); } finally { depth--; }
            return [location, child, number(point.derivative)];
        });
        const index = node(11, coordinate);
        for (const point of points) wasm.density_point(handle.get(), index, ...point);
        return index;
    }
    function compile(value) {
        if (++depth > 128) throw new Error('Density graph exceeds maximum depth');
        try { return compileValue(value); } finally { depth--; }
    }
    function compileValue(value) {
        if (typeof value === 'number') return node(0,0,0,0,number(value));
        if (typeof value === 'string') {
            if (!idPattern.test(value)) throw new TypeError(`Invalid density reference: ${value}`);
            if (references.has(value)) return references.get(value);
            if (active.has(value)) throw new Error(`Cyclic density reference: ${value}`);
            const definition = data[`data/minecraft/worldgen/density_function/${value.slice(10)}.json`];
            if (definition === undefined) throw new Error(`Missing density definition: ${value}`);
            active.add(value);
            const previousSource = currentSource;
            currentSource = value;
            try {
                const index = compile(definition);
                references.set(value, index);
                return index;
            } finally { currentSource = previousSource; active.delete(value); }
        }
        if (!value || typeof value.type !== 'string') throw new TypeError('Expected a density function');
        const type = value.type.replace(/^minecraft:/, '');
        if (Object.hasOwn(binary, type)) return node(binary[type], compile(value.left), compile(value.right));
        switch (type) {
            case 'cache': {
                const input = compile(value.input);
                if (!cacheWrapperPrototype && !cacheWrapperProfile) return input;
                let cacheId = cacheInputIds.get(input);
                if (cacheId === undefined) { cacheId = cacheInputIds.size; cacheInputIds.set(input, cacheId); }
                const wrapperId = cacheWrappers.length;
                const index = node(30, input, 0, 0, cacheId, wrapperId);
                cacheWrappers.push(Object.freeze({ wrapperId, cacheId, childIndex: input, wrapperNodeIndex: index,
                    root: currentRoot, source: currentSource, child: typeof value.input === 'string' ? value.input : value.input.type }));
                return index;
            }
            case 'abs': return node(5, compile(value.input));
            case 'negate': return node(binary.mul, compile(-1), compile(value.input));
            case 'half_negative': return node(17, compile(value.input));
            case 'quarter_negative': return node(18, compile(value.input));
            case 'square': return node(19, compile(value.input));
            case 'cube': return node(20, compile(value.input));
            case 'squeeze': return node(21, compile(value.input));
            case 'blend_alpha': return compile(1);
            case 'blend_offset': return compile(0);
            case 'blend_density': return compile(value.input);
            case 'beardifier': return node(29);
            case 'lerp': return node(6, compile(value.alpha), compile(value.first), compile(value.second));
            case 'gradient': {
                if (value.tiling !== undefined && value.tiling !== 'clamp_to_edge') throw new Error(`Unsupported gradient tiling: ${value.tiling}`);
                const axis = ['x','y','z'].indexOf(value.axis);
                if (axis < 0) throw new TypeError('Invalid gradient axis');
                const from = integer(value.from_coordinate), to = integer(value.to_coordinate);
                if (from === to) throw new RangeError('Gradient coordinate range cannot be zero');
                return node(7, axis,0,0,from,to,number(value.from_value),number(value.to_value));
            }
            case 'noise': return node(8, compile(value.shift_x ?? 0), compile(value.shift_y ?? 0), compile(value.shift_z ?? 0), noise(value.noise), number(value.xz_scale), number(value.y_scale));
            case 'shift_a': return node(9,0,0,0,noise(value.noise));
            case 'shift_b': return node(10,0,0,0,noise(value.noise));
            case 'shift': return node(15,0,0,0,noise(value.noise));
            case 'spline': return spline(value.spline);
            case 'old_blended_noise': {
                const scales = [value.xz_scale, value.y_scale, value.xz_factor, value.y_factor].map(number);
                const smear = number(value.smear_scale_multiplier);
                if (scales.some(v => v < 0.001 || v > 1000) || smear < 1 || smear > 8) throw new RangeError('Invalid blended noise parameters');
                return node(16,0,0,0,wasm.density_add_blended(handle.get(),seed,+legacyRandom,...scales,smear));
            }
            case 'range_choice': {
                const min = number(value.min_inclusive), max = number(value.max_exclusive);
                if (min > max) throw new RangeError('Invalid range choice interval');
                return node(22, compile(value.input), compile(value.when_in_range), compile(value.when_out_of_range), min, max);
            }
            case 'interval_select': {
                if (!Array.isArray(value.thresholds) || !Array.isArray(value.functions) || value.functions.length !== value.thresholds.length + 1) {
                    throw new TypeError('Interval select requires one more function than thresholds');
                }
                const thresholds = value.thresholds.map(number);
                for (let i=1; i<thresholds.length; i++) if (Math.fround(thresholds[i]) <= Math.fround(thresholds[i-1])) throw new RangeError('Interval thresholds must increase');
                const index = node(23, compile(value.input));
                value.functions.forEach((fn, i) => wasm.density_point(handle.get(), index, i < thresholds.length ? thresholds[i] : 0, compile(fn), 0));
                return index;
            }
            case 'interpolated': {
                const xz = integer(value.cell_size_xz), y = integer(value.cell_size_y);
                if (xz <= 0 || y <= 0) throw new RangeError('Interpolation cell sizes must be positive');
                return node(24, compile(value.input),0,0,xz,y);
            }
            case 'find_top_surface': {
                const lower = integer(value.lower_bound), cell = integer(value.cell_height);
                if (cell <= 0) throw new RangeError('Surface cell height must be positive');
                return node(25,compile(value.density),compile(value.upper_bound),0,lower,cell);
            }
            case 'end_outer_islands':
                return node(26,0,0,0,wasm.density_add_end_islands(handle.get(),seed));
            case 'distance_to_point': {
                if (!Array.isArray(value.point) || value.point.length !== 3) throw new TypeError('Distance point must contain three coordinates');
                const point = value.point.map(integer);
                const metrics = { euclidean: 0, euclidean_squared: 1, manhattan: 2, chebyshev: 3 };
                if (!Object.hasOwn(metrics, value.metric)) throw new Error(`Unsupported distance metric: ${value.metric}`);
                return node(27,0,0,0,...point,metrics[value.metric]);
            }
            case 'slice': {
                const axis = ['x','y','z'].indexOf(value.axis);
                if (axis < 0) throw new TypeError('Invalid slice axis');
                return node(28,axis,compile(value.input),0,axis,integer(value.coordinate));
            }
            case 'clamp': {
                const min = number(value.min), max = number(value.max);
                if (min > max) throw new RangeError('Invalid clamp interval');
                return node(12,compile(value.input),0,0,min,max);
            }
            default: throw new Error(`Density function not ported: ${value.type}`);
        }
    }
    try {
        for (const [name, definition] of Object.entries(roots)) { currentRoot = name; currentSource = 'inline'; indices.set(name, compile(definition)); }
        if (cacheWrappers.length) wasm.density_cache_config(handle.get(), +cacheWrapperPrototype, +cacheWrapperProfile);
    } catch (error) { handle.dispose(); throw error; }
    function aquiferVolume(name,x,y,z,sizeX,sizeY,sizeZ,{fields=null,seaLevel=63,defaultFluid=2}={}, carving=false) {
        if (!indices.has(name)) throw new Error(`Unknown density output: ${name}`);
        if (legacyRandom && fields) throw new Error('Legacy aquifer positional random is not ported');
        [x,y,z,seaLevel].forEach(integer);
        if (![2,3].includes(defaultFluid)) throw new RangeError('Default fluid must be water or lava');
        const sizes=[sizeX,sizeY,sizeZ], length=sizes.reduce((a,b)=>a*b,1);
        if (!sizes.every(v=>Number.isInteger(v)&&v>0) || length>1048576) throw new RangeError('Invalid aquifer volume size');
        [x,y,z].forEach((v,i)=>integer(v+sizes[i]-1));
        const roots=fields ? ['barrier','fluid_level_floodedness','fluid_level_spread','lava','exclusion','surface_level'].map(key=>{
            if (!indices.has(fields[key])) throw new Error(`Missing aquifer output: ${fields[key]}`);
            return indices.get(fields[key]);
        }) : null;
        const units=Math.ceil(length/8), output=wasm.buffer_alloc(units), config=roots ? wasm.buffer_alloc(3) : 0;
        try {
            if (roots) new Uint32Array(wasm.memory.buffer,config,6).set(roots);
            wasm[carving ? 'aquifer_carving_volume' : 'aquifer_volume'](handle.get(),indices.get(name),seed,x,y,z,sizeX,sizeY,sizeZ,seaLevel,defaultFluid,config,output);
            return new Uint8Array(wasm.memory.buffer,output,length).slice();
        } finally { if (config) wasm.buffer_free(config,3); wasm.buffer_free(output,units); }
    }
    return {
        fields: Object.freeze([...indices.keys()]),
        cacheWrappers: Object.freeze(cacheWrappers),
        cacheBeginContext() { if (cacheWrappers.length) wasm.density_cache_begin_context(handle.get()); },
        cacheResetStats() { if (cacheWrappers.length) wasm.density_cache_reset_stats(handle.get()); },
        cacheStats() {
            if (!cacheWrappers.length) return { wrappers: [], bytes: 0 };
            const count = wasm.density_cache_count(handle.get());
            const pointer = wasm.buffer_alloc(count * 5);
            try {
                const rows = new BigUint64Array(wasm.memory.buffer, pointer, count * 5);
                wasm.density_cache_stats(handle.get(), pointer);
                return { wrappers: cacheWrappers.map(({ wrapperId, cacheId, childIndex, root, source, child }) => ({ wrapperId, cacheId, childIndex, root, source, child,
                    valueAccesses: Number(rows[wrapperId * 5]), valueHits: Number(rows[wrapperId * 5 + 1]),
                    volumeAccesses: Number(rows[wrapperId * 5 + 2]), volumeHits: Number(rows[wrapperId * 5 + 3]),
                    accesses: Number(rows[wrapperId * 5] + rows[wrapperId * 5 + 2]),
                    hits: Number(rows[wrapperId * 5 + 1] + rows[wrapperId * 5 + 3]),
                    avoidedNodeEvaluations: Number(rows[wrapperId * 5 + 4]) })),
                    bytes: wasm.density_cache_memory(handle.get()) };
            } finally { wasm.buffer_free(pointer, count * 5); }
        },
        setBeardifier({ pieces = [], junctions = [], affectedBox = null } = {}) {
            const adjustments = ['none', 'bury', 'beard_thin', 'beard_box', 'encapsulate'];
            const bounds = box => {
                if (!box || !['minX','minY','minZ','maxX','maxY','maxZ'].every(k => Object.hasOwn(box, k))) throw new TypeError('Expected beardifier bounding box');
                const values = ['minX','minY','minZ','maxX','maxY','maxZ'].map(k => integer(box[k]));
                if ([0,1,2].some(i => values[i] > values[i+3])) throw new RangeError('Inverted beardifier bounding box');
                return values;
            };
            if (!Array.isArray(pieces) || !Array.isArray(junctions) || pieces.length + junctions.length > 65536) throw new RangeError('Invalid beardifier piece list');
            const rigid = pieces.map(piece => {
                const adjustment = adjustments.indexOf(piece.terrainAdjustment);
                if (adjustment < 0) throw new TypeError('Invalid structure terrain adjustment');
                return [...bounds(piece.box), adjustment, integer(piece.groundLevelDelta ?? 0)];
            });
            const joints = junctions.map(p => [integer(p.x), integer(p.groundY), integer(p.z)]);
            const affected = affectedBox === null ? null : bounds(affectedBox);
            if ((pieces.length || junctions.length) && !affected) throw new TypeError('Nonempty beardifier requires the JAR-collected affectedBox');
            const ptr = handle.get();
            wasm.density_beard_clear(ptr);
            if (affected) wasm.density_beard_bounds(ptr, ...affected);
            for (const piece of rigid) wasm.density_beard_piece(ptr, ...piece);
            for (const joint of joints) wasm.density_beard_junction(ptr, ...joint);
        },
        sample(name, x, y, z) {
            if (!indices.has(name)) throw new Error(`Unknown density output: ${name}`);
            [x,y,z].forEach(integer);
            return wasm[experimentalScalarMemoReuse ? 'density_sample_reuse' : 'density_sample'](handle.get(), indices.get(name), x,y,z);
        },
        sampleMany(name, positions) {
            if (!experimentalBatchDensityQueries) throw new Error('Batched density queries are not enabled');
            if (!indices.has(name)) throw new Error(`Unknown density output: ${name}`);
            if (!(positions instanceof Int32Array) || positions.length % 3 !== 0) throw new TypeError('Expected packed Int32Array XYZ density positions');
            const count = positions.length / 3;
            if (count < 1 || count > 1048576) throw new RangeError('Invalid density query batch size');
            const queryPointer = wasm.buffer_alloc(count * 2);
            const outputPointer = wasm.buffer_alloc(Math.ceil(count / 2));
            try {
                const memory = wasm.memory.buffer;
                const queries = new Int32Array(memory, queryPointer, count * 4);
                const root = indices.get(name);
                for (let i = 0; i < count; i++) {
                    const source = i * 3, target = i * 4;
                    queries[target] = root;
                    queries[target + 1] = integer(positions[source]);
                    queries[target + 2] = integer(positions[source + 1]);
                    queries[target + 3] = integer(positions[source + 2]);
                }
                wasm[experimentalScalarMemoReuse ? 'density_sample_many_reuse' : 'density_sample_many'](handle.get(), queryPointer, count, outputPointer);
                return new Float32Array(wasm.memory.buffer, outputPointer, count).slice();
            } finally {
                wasm.buffer_free(outputPointer, Math.ceil(count / 2));
                wasm.buffer_free(queryPointer, count * 2);
            }
        },
        sampleVolume(name, x,y,z, sizeX,sizeY,sizeZ) {
            if (!indices.has(name)) throw new Error(`Unknown density output: ${name}`);
            [x,y,z].forEach(integer);
            const sizes = [sizeX,sizeY,sizeZ];
            if (!sizes.every(v => Number.isInteger(v) && v > 0) || sizes.reduce((a,b)=>a*b,1) > 1048576) throw new RangeError('Invalid density volume size');
            [x,y,z].forEach((v,i)=>integer(v+sizes[i]-1));
            const pointer = handle.get();
            const length = sizeX*sizeY*sizeZ;
            const units = Math.ceil(length/2);
            const output = wasm.buffer_alloc(units);
            try {
                wasm.density_volume(pointer, indices.get(name),x,y,z,sizeX,sizeY,sizeZ,output);
                return new Float32Array(wasm.memory.buffer,output,length).slice();
            } finally { wasm.buffer_free(output,units); }
        },
        sampleAquiferVolume(name,x,y,z,sizeX,sizeY,sizeZ,{fields=null,seaLevel=63,defaultFluid=2}={}) {
            return aquiferVolume(name,x,y,z,sizeX,sizeY,sizeZ,{fields,seaLevel,defaultFluid});
        },
        sampleCarvingAquiferVolume(name,x,y,z,sizeX,sizeY,sizeZ,options={}) {
            return aquiferVolume(name,x,y,z,sizeX,sizeY,sizeZ,options,true);
        },
        dispose: handle.dispose
    };
}

export function createClimateRouter(kernel, seed, data, settings = 'overworld', { experimentalScalarMemoReuse = false,
    experimentalBatchDensityQueries = false, cacheWrapperPrototype = false, cacheWrapperProfile = false,
    excludedBiomes = [] } = {}) {
    if (!['overworld','large_biomes','amplified','nether'].includes(settings)) throw new Error(`Climate router not ported: ${settings}`);
    const definition = data[`data/minecraft/worldgen/noise_settings/${settings}.json`];
    if (!definition?.noise_router) throw new Error(`Missing noise settings: ${settings}`);
    const roots = Object.fromEntries(CLIMATE_FIELDS.map(name => [name, definition.noise_router[name]]));
    const density = kernel.density(seed, data, roots, { legacyRandom: !!definition.legacy_random_source,
        experimentalScalarMemoReuse, experimentalBatchDensityQueries, cacheWrapperPrototype, cacheWrapperProfile });
    let climate;
    try { climate = kernel.climate(settings === 'nether' ? 'nether' : 'overworld', { excludeBiomes: excludedBiomes }); }
    catch (error) { density.dispose(); throw error; }
    return {
        fields: CLIMATE_FIELDS,
        cacheBeginContext() { density.cacheBeginContext(); },
        cacheResetStats() { density.cacheResetStats(); },
        cacheStats() { return density.cacheStats(); },
        sampleBlock(x,y,z) { return CLIMATE_FIELDS.map(name => density.sample(name,x,y,z)); },
        biomeAtQuart(x,y,z) {
            if (![x,y,z].every(v => Number.isInteger(v) && v >= -536870912 && v <= 536870911)) throw new RangeError('Quart coordinates exceed block int range');
            return climate.sample(...CLIMATE_FIELDS.map(name => density.sample(name,x*4,y*4,z*4)));
        },
        biomeAtQuartBatch(blockPositions) {
            if (!experimentalBatchDensityQueries) throw new Error('Batched biome queries are not enabled');
            if (!(blockPositions instanceof Int32Array) || blockPositions.length % 3 !== 0) throw new TypeError('Expected packed Int32Array XYZ biome positions');
            const values = CLIMATE_FIELDS.map(name => density.sampleMany(name, blockPositions));
            const result = new Array(blockPositions.length / 3);
            for (let i = 0; i < result.length; i++) {
                const offset = i * 3;
                result[i] = climate.sample(...values.map(field => field[i]));
            }
            return result;
        },
        dispose() { density.dispose(); climate.dispose(); }
    };
}
