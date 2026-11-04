use std::cell::{Cell, RefCell};
use crate::normal_noise::NormalNoise;
use crate::blended_noise::BlendedNoise;
use crate::end_island::EndIslandNoise;
use crate::beardifier::{Beardifier, Rigid};

struct Point { location: f32, value: usize, derivative: f32 }
struct Node { op: u32, children: [usize; 3], parameters: [f64; 4], points: Vec<Point> }
#[derive(Clone, Default)]
struct CacheCell { last: Option<([i32; 3], f32, u64)>, volume: Option<(VolumeKey, Vec<f32>, u64)> }
#[derive(Clone, Copy, PartialEq, Eq)]
struct VolumeKey { origin: [i32; 3], size: [usize; 3], step: [i32; 3] }
#[derive(Clone, Default)]
struct CacheStat { value_accesses: u64, value_hits: u64, volume_accesses: u64, volume_hits: u64, avoided: u64 }
pub struct DensityGraph { nodes: Vec<Node>, noises: Vec<NormalNoise>, blended: Vec<BlendedNoise>, end_islands: Vec<EndIslandNoise>, beardifier: Beardifier, scalar_memo: RefCell<Vec<Option<f32>>>, cache_cells: RefCell<Vec<CacheCell>>, cache_stats: RefCell<Vec<CacheStat>>, cache_prototype: bool, cache_profile: bool, cache_suppressed: Cell<bool>, eval_count: RefCell<u64> }

fn lerp(t: f32, a: f32, b: f32) -> f32 { a + t * (b - a) }

impl DensityGraph {
    fn interpolation_inputs(&self, index: usize, found: &mut Vec<usize>) {
        let node = &self.nodes[index];
        if node.op == 24 {
            if !found.contains(&index) { found.push(index); }
            return;
        }
        if node.op == 28 {
            self.interpolation_inputs(node.children[1], found);
            return;
        }
        let count = match node.op { 1..=4 | 13 | 14 => 2, 6 | 8 | 22 => 3,
            5 | 11 | 12 | 17..=21 | 23 => 1, _ => 0 };
        for child in node.children.iter().take(count) { self.interpolation_inputs(*child, found); }
        for point in &node.points { self.interpolation_inputs(point.value, found); }
    }

    pub(crate) fn volume(&self, root: usize, origin: [i32;3], size: [usize;3], step: [i32;3]) -> Vec<f32> {
        let length = size.iter().product();
        let node = &self.nodes[root];
        if node.op == 30 {
            if self.cache_suppressed.get() { return self.volume(node.children[0], origin, size, step); }
            let cache_id = node.parameters[0] as usize;
            let wrapper_id = node.parameters[1] as usize;
            let key = VolumeKey { origin, size, step };
            if self.cache_profile { self.cache_stats.borrow_mut()[wrapper_id].volume_accesses += 1; }
            let saved = if self.cache_prototype || self.cache_profile { self.cache_cells.borrow()[cache_id].clone() } else { CacheCell::default() };
            let cached = saved.volume.as_ref().filter(|(saved_key, _, _)| *saved_key == key);
            if let Some((_, values, avoided)) = cached {
                if self.cache_profile { let mut stats = self.cache_stats.borrow_mut(); stats[wrapper_id].volume_hits += 1; stats[wrapper_id].avoided += *avoided; }
                if self.cache_prototype { return values.clone(); }
                let previous = self.cache_suppressed.replace(true);
                let recomputed = self.volume(node.children[0], origin, size, step);
                self.cache_suppressed.set(previous);
                return recomputed;
            }
            let before = *self.eval_count.borrow();
            let values = self.volume(node.children[0], origin, size, step);
            if cached.is_none() && (self.cache_prototype || self.cache_profile) {
                let cost = (*self.eval_count.borrow()).wrapping_sub(before);
                self.cache_cells.borrow_mut()[cache_id].volume = Some((key, values.clone(), cost));
            }
            return values;
        }
        if node.op == 24 {
            let cx = node.parameters[0] as i32;
            let cy = node.parameters[1] as i32;
            let cell = [cx,cy,cx];
            if (0..3).all(|i| (step[i] == cell[i] || size[i] == 1) && origin[i].rem_euclid(cell[i]) == 0) {
                return self.volume(node.children[0], origin, size, step);
            }
            let base = std::array::from_fn(|i| origin[i] - origin[i].rem_euclid(cell[i]));
            let grid_size = std::array::from_fn(|i| ((origin[i] + (size[i]-1) as i32 * step[i] - base[i]) / cell[i] + 2) as usize);
            let grid = self.volume(node.children[0], base, grid_size, cell);
            let at = |x:usize,y:usize,z:usize| grid[(z * grid_size[0] + x) * grid_size[1] + y];
            let mut result = Vec::with_capacity(length);
            for z in 0..size[2] { for x in 0..size[0] {
                let dx = origin[0] + x as i32 * step[0] - base[0];
                let dz = origin[2] + z as i32 * step[2] - base[2];
                let ix = (dx / cx) as usize; let iz = (dz / cx) as usize;
                let tz = (dz % cx) as f32 * (1.0 / cx as f32);
                let tx = (dx % cx) as f32 * (1.0 / cx as f32);
                for y in 0..size[1] {
                    let dy = origin[1] + y as i32 * step[1] - base[1];
                    let iy = (dy / cy) as usize;
                    let low = lerp(tx,lerp(tz,at(ix,iy,iz),at(ix,iy,iz+1)),lerp(tz,at(ix+1,iy,iz),at(ix+1,iy,iz+1)));
                    let high = lerp(tx,lerp(tz,at(ix,iy+1,iz),at(ix,iy+1,iz+1)),lerp(tz,at(ix+1,iy+1,iz),at(ix+1,iy+1,iz+1)));
                    let increment = (high-low) * (1.0 / cy as f32);
                    let start_y = if iy == ((origin[1]-base[1])/cy) as usize { origin[1]-base[1]-iy as i32*cy } else { 0 };
                    let mut value = low + increment * start_y as f32;
                    for _ in start_y..dy%cy { value += increment; }
                    result.push(value);
                }
            }}
            return result;
        }
        let mut inputs = Vec::new();
        self.interpolation_inputs(root, &mut inputs);
        let volumes: Vec<_> = inputs.iter().map(|&i| self.volume(i,origin,size,step)).collect();
        let mut result = Vec::with_capacity(length);
        let mut memo = vec![None; self.nodes.len()];
        for z in 0..size[2] { for x in 0..size[0] { for y in 0..size[1] {
            memo.fill(None);
            for (j,&i) in inputs.iter().enumerate() { memo[i] = Some(volumes[j][result.len()]); }
            result.push(self.evaluate(root, [origin[0]+x as i32*step[0],origin[1]+y as i32*step[1],origin[2]+z as i32*step[2]], &mut memo));
        }}}
        result
    }

    pub(crate) fn evaluate_fresh(&self, index: usize, position: [i32; 3]) -> f32 {
        self.evaluate(index, position, &mut vec![None; self.nodes.len()])
    }

    fn evaluate_reusing_memo(&self, index: usize, position: [i32; 3]) -> f32 {
        let mut memo = self.scalar_memo.borrow_mut();
        if memo.len() != self.nodes.len() { memo.resize(self.nodes.len(), None); }
        memo.fill(None);
        self.evaluate(index, position, &mut memo)
    }

    fn evaluate(&self, index: usize, position: [i32; 3], memo: &mut [Option<f32>]) -> f32 {
        let node = &self.nodes[index];
        if node.op == 30 {
            if self.cache_suppressed.get() {
                let value = self.evaluate(node.children[0], position, memo);
                memo[index] = Some(value);
                return value;
            }
            let cache_id = node.parameters[0] as usize;
            let wrapper_id = node.parameters[1] as usize;
            if self.cache_profile { self.cache_stats.borrow_mut()[wrapper_id].value_accesses += 1; }
            if self.cache_prototype || self.cache_profile {
                let saved = self.cache_cells.borrow()[cache_id].clone();
                let mut hit_cost = None;
                let mut hit_value = None;
                if let Some((key, values, avoided)) = saved.volume.as_ref() {
                    if let Some(offset) = volume_offset(*key, position) {
                        hit_value = Some(values[offset]);
                        hit_cost = Some(*avoided);
                    }
                }
                if hit_value.is_none() {
                    if let Some((_, value, avoided)) = saved.last.filter(|(at, _, _)| *at == position) {
                        hit_value = Some(value);
                        hit_cost = Some(avoided);
                    }
                }
                if let Some(avoided) = hit_cost {
                    if self.cache_profile { let mut stats = self.cache_stats.borrow_mut(); stats[wrapper_id].value_hits += 1; stats[wrapper_id].avoided += avoided; }
                    if self.cache_prototype { let value = hit_value.unwrap(); memo[index] = Some(value); return value; }
                    let previous = self.cache_suppressed.replace(true);
                    let value = self.evaluate(node.children[0], position, memo);
                    self.cache_suppressed.set(previous);
                    memo[index] = Some(value);
                    return value;
                }
                let before = *self.eval_count.borrow();
                let value = self.evaluate(node.children[0], position, memo);
                let cost = (*self.eval_count.borrow()).wrapping_sub(before);
                if self.cache_prototype || self.cache_profile { self.cache_cells.borrow_mut()[cache_id].last = Some((position, value, cost)); }
                memo[index] = Some(value);
                return value;
            }
        }
        if let Some(value) = memo[index] { return value; }
        if self.cache_profile && !self.cache_suppressed.get() { *self.eval_count.borrow_mut() += 1; }
        let [a,b,c] = node.children;
        let [p,q,r,s] = node.parameters;
        let [x,y,z] = position.map(|v| v as f64);
        let result = match node.op {
            0 => p as f32,
            1 => self.evaluate(a, position, memo) + self.evaluate(b, position, memo),
            2 => {
                let left = self.evaluate(a, position, memo);
                if self.nodes[a].op != 0 && self.nodes[b].op != 0 && left == 0.0 { 0.0 }
                else { left * self.evaluate(b, position, memo) }
            },
            3 => self.evaluate(a, position, memo) - self.evaluate(b, position, memo),
            4 => {
                let left = self.evaluate(a, position, memo);
                if self.nodes[a].op == 0 { left / self.evaluate(b, position, memo) }
                else if self.nodes[b].op == 0 { left * (1.0 / self.evaluate(b, position, memo)) }
                else if left == 0.0 { 0.0 }
                else { left / self.evaluate(b, position, memo) }
            },
            5 => self.evaluate(a, position, memo).abs(),
            6 => {
                let t = self.evaluate(a, position, memo);
                if t == 0.0 { self.evaluate(b, position, memo) }
                else if t == 1.0 { self.evaluate(c, position, memo) }
                else { lerp(t, self.evaluate(b, position, memo), self.evaluate(c, position, memo)) }
            },
            7 => {
                let coordinate = position[a];
                let from = p as i32;
                let to = q as i32;
                let offset = coordinate.clamp(from.min(to), from.max(to)).wrapping_sub(from);
                r as f32 + offset as f32 * ((s as f32 - r as f32) / to.wrapping_sub(from) as f32)
            },
            8 => self.noises[p as usize].sample(
                x * q + self.evaluate(a, position, memo) as f64,
                y * r + self.evaluate(b, position, memo) as f64,
                z * q + self.evaluate(c, position, memo) as f64,
            ),
            9 => self.noises[p as usize].sample(x * 0.25, 0.0, z * 0.25) * 4.0,
            10 => self.noises[p as usize].sample(z * 0.25, x * 0.25, 0.0) * 4.0,
            11 => {
                let coordinate = self.evaluate(a, position, memo);
                let points = &node.points;
                let upper = points.partition_point(|point| point.location <= coordinate);
                if upper == 0 || upper == points.len() {
                    let point = &points[if upper == 0 { 0 } else { upper - 1 }];
                    let value = self.evaluate(point.value, position, memo);
                    if point.derivative == 0.0 { value }
                    else { point.derivative * (coordinate - point.location) + value }
                } else {
                    let left = &points[upper-1];
                    let right = &points[upper];
                    let width = right.location - left.location;
                    let t = (coordinate - left.location) / width;
                    let low = self.evaluate(left.value, position, memo);
                    let high = self.evaluate(right.value, position, memo);
                    let first = left.derivative * width - (high - low);
                    let second = -right.derivative * width + (high - low);
                    lerp(t, low, high) + t * (1.0 - t) * lerp(t, first, second)
                }
            },
            12 => self.evaluate(a, position, memo).max(p as f32).min(q as f32),
            13 => self.evaluate(a, position, memo).min(self.evaluate(b, position, memo)),
            14 => self.evaluate(a, position, memo).max(self.evaluate(b, position, memo)),
            15 => self.noises[p as usize].sample(x * 0.25, y * 0.25, z * 0.25) * 4.0,
            16 => self.blended[p as usize].sample(x,y,z),
            17 | 18 => {
                let value = self.evaluate(a, position, memo);
                if value > 0.0 { value } else { value * if node.op == 17 { 0.5 } else { 0.25 } }
            },
            19 => { let value = self.evaluate(a, position, memo); value * value },
            20 => { let value = self.evaluate(a, position, memo); value * value * value },
            21 => { let value = self.evaluate(a, position, memo).clamp(-1.0, 1.0); value / 2.0 - value * value * value / 24.0 },
            22 => {
                let value = self.evaluate(a, position, memo);
                if value >= p as f32 && value < q as f32 { self.evaluate(b, position, memo) }
                else { self.evaluate(c, position, memo) }
            },
            23 => {
                let value = self.evaluate(a, position, memo);
                let selected = node.points.iter().take(node.points.len() - 1)
                    .position(|point| value < point.location)
                    .unwrap_or(node.points.len() - 1);
                self.evaluate(node.points[selected].value, position, memo)
            },
            24 => {
                let cell_xz = p as i32;
                let cell_y = q as i32;
                let offset_x = position[0].rem_euclid(cell_xz);
                let offset_y = position[1].rem_euclid(cell_y);
                let offset_z = position[2].rem_euclid(cell_xz);
                if offset_x == 0 && offset_y == 0 && offset_z == 0 {
                    self.evaluate(a, position, memo)
                } else {
                    let base = [position[0] - offset_x, position[1] - offset_y, position[2] - offset_z];
                    let sample = |dx,dy,dz| self.evaluate_fresh(a, [base[0]+dx,base[1]+dy,base[2]+dz]);
                    let tx = offset_x as f32 / cell_xz as f32;
                    let ty = offset_y as f32 / cell_y as f32;
                    let tz = offset_z as f32 / cell_xz as f32;
                    let z0 = lerp(ty,
                        lerp(tx, sample(0,0,0), sample(cell_xz,0,0)),
                        lerp(tx, sample(0,cell_y,0), sample(cell_xz,cell_y,0)));
                    let z1 = lerp(ty,
                        lerp(tx, sample(0,0,cell_xz), sample(cell_xz,0,cell_xz)),
                        lerp(tx, sample(0,cell_y,cell_xz), sample(cell_xz,cell_y,cell_xz)));
                    lerp(tz, z0, z1)
                }
            },
            25 => {
                let upper = self.evaluate(b,position,memo);
                let cell = q as i32;
                let mut height = (upper / cell as f32).floor() as i32 * cell;
                let lower = p as i32;
                while height > lower {
                    if self.evaluate_fresh(a,[position[0],height,position[2]]) > 0.0 { break; }
                    height -= cell;
                }
                height.max(lower) as f32
            },
            26 => self.end_islands[p as usize].sample(position[0], position[1], position[2]),
            27 => {
                let dx = (p as f32 - position[0] as f32).abs();
                let dy = (q as f32 - position[1] as f32).abs();
                let dz = (r as f32 - position[2] as f32).abs();
                match s as u32 {
                    0 => (dx * dx + dy * dy + dz * dz).sqrt(),
                    1 => dx * dx + dy * dy + dz * dz,
                    2 => dx + dy + dz,
                    3 => dx.max(dy).max(dz),
                    _ => unreachable!("Distance metric validated by compiler"),
                }
            },
            28 => {
                let mut point = position;
                point[a] = q as i32;
                self.evaluate_fresh(b, point)
            },
            29 => self.beardifier.sample(position[0], position[1], position[2]),
            30 => self.evaluate(a, position, memo),
            _ => unreachable!("Density opcode validated by compiler"),
        };
        memo[index] = Some(result);
        result
    }
}

fn volume_offset(key: VolumeKey, position: [i32; 3]) -> Option<usize> {
    let delta = [position[0].checked_sub(key.origin[0])?, position[1].checked_sub(key.origin[1])?, position[2].checked_sub(key.origin[2])?];
    let mut index = [0usize; 3];
    for axis in 0..3 {
        if key.step[axis] <= 0 || delta[axis] < 0 || delta[axis] % key.step[axis] != 0 { return None; }
        index[axis] = (delta[axis] / key.step[axis]) as usize;
        if index[axis] >= key.size[axis] { return None; }
    }
    Some((index[2] * key.size[0] + index[0]) * key.size[1] + index[1])
}

#[no_mangle]
pub extern "C" fn density_create() -> *mut DensityGraph {
    Box::into_raw(Box::new(DensityGraph { nodes: Vec::new(), noises: Vec::new(), blended: Vec::new(), end_islands: Vec::new(), beardifier: Beardifier::default(), scalar_memo: RefCell::new(Vec::new()), cache_cells: RefCell::new(Vec::new()), cache_stats: RefCell::new(Vec::new()), cache_prototype: false, cache_profile: false, cache_suppressed: Cell::new(false), eval_count: RefCell::new(0) }))
}

#[no_mangle]
pub unsafe extern "C" fn density_beard_clear(ptr: *mut DensityGraph) { (*ptr).beardifier = Beardifier::default(); }
#[no_mangle]
pub unsafe extern "C" fn density_beard_bounds(ptr: *mut DensityGraph, x:i32,y:i32,z:i32, xx:i32,yy:i32,zz:i32) {
    (*ptr).beardifier.affected = Some([x,y,z,xx,yy,zz]);
}
#[no_mangle]
pub unsafe extern "C" fn density_beard_piece(ptr: *mut DensityGraph, x:i32,y:i32,z:i32, xx:i32,yy:i32,zz:i32, adjustment:u32, ground:i32) {
    (*ptr).beardifier.pieces.push(Rigid { bounds:[x,y,z,xx,yy,zz], adjustment, ground });
}
#[no_mangle]
pub unsafe extern "C" fn density_beard_junction(ptr: *mut DensityGraph, x:i32,y:i32,z:i32) {
    (*ptr).beardifier.junctions.push([x,y,z]);
}

#[no_mangle]
pub unsafe extern "C" fn density_add_end_islands(ptr: *mut DensityGraph, seed: u64) -> usize {
    let graph = &mut *ptr;
    let index = graph.end_islands.len();
    graph.end_islands.push(EndIslandNoise::new(seed));
    index
}

#[no_mangle]
pub unsafe extern "C" fn density_add_blended(ptr: *mut DensityGraph, seed: u64, legacy: u32, xz_scale: f64, y_scale: f64, xz_factor: f64, y_factor: f64, smear: f64) -> usize {
    let graph = &mut *ptr;
    let index = graph.blended.len();
    graph.blended.push(BlendedNoise::seeded(seed, legacy != 0, xz_scale, y_scale, xz_factor, y_factor, smear));
    index
}

#[no_mangle]
pub unsafe extern "C" fn density_free(ptr: *mut DensityGraph) {
    if !ptr.is_null() { drop(Box::from_raw(ptr)); }
}

#[no_mangle]
pub unsafe extern "C" fn density_add_noise(ptr: *mut DensityGraph, noise: *const NormalNoise) -> usize {
    let graph = &mut *ptr;
    let index = graph.noises.len();
    graph.noises.push((*noise).clone());
    index
}

#[no_mangle]
pub unsafe extern "C" fn density_node(ptr: *mut DensityGraph, op: u32, a: usize, b: usize, c: usize, p: f64, q: f64, r: f64, s: f64) -> usize {
    let graph = &mut *ptr;
    let index = graph.nodes.len();
    graph.nodes.push(Node { op, children: [a,b,c], parameters: [p,q,r,s], points: Vec::new() });
    if op == 30 {
        let cache_id = p as usize;
        graph.cache_cells.get_mut().resize_with(cache_id + 1, CacheCell::default);
        graph.cache_stats.get_mut().push(CacheStat::default());
    }
    index
}

#[no_mangle]
pub unsafe extern "C" fn density_cache_config(ptr: *mut DensityGraph, enabled: u32, profile: u32) {
    let graph = &mut *ptr; graph.cache_prototype = enabled != 0; graph.cache_profile = profile != 0;
}
#[no_mangle]
pub unsafe extern "C" fn density_cache_begin_context(ptr: *mut DensityGraph) {
    for cell in (*ptr).cache_cells.get_mut() { *cell = CacheCell::default(); }
}
#[no_mangle]
pub unsafe extern "C" fn density_cache_reset_stats(ptr: *mut DensityGraph) {
    for stat in (*ptr).cache_stats.get_mut() { *stat = CacheStat::default(); }
    *(*ptr).eval_count.get_mut() = 0;
}
#[no_mangle]
pub unsafe extern "C" fn density_cache_stats(ptr: *const DensityGraph, output: *mut u64) -> usize {
    let graph = &*ptr; let stats = graph.cache_stats.borrow();
    for (index, stat) in stats.iter().enumerate() {
        let row = std::slice::from_raw_parts_mut(output.add(index * 5), 5);
        row.copy_from_slice(&[stat.value_accesses, stat.value_hits, stat.volume_accesses, stat.volume_hits, stat.avoided]);
    }
    stats.len()
}
#[no_mangle]
pub unsafe extern "C" fn density_cache_count(ptr: *const DensityGraph) -> usize { (&*ptr).cache_stats.borrow().len() }
#[no_mangle]
pub unsafe extern "C" fn density_cache_memory(ptr: *const DensityGraph) -> usize {
    let graph = &*ptr;
    let cells = graph.cache_cells.borrow();
    let stats = graph.cache_stats.borrow();
    cells.capacity() * std::mem::size_of::<CacheCell>() + stats.capacity() * std::mem::size_of::<CacheStat>()
        + cells.iter().map(|cell| cell.volume.as_ref().map_or(0, |(_, values, _)| values.capacity() * std::mem::size_of::<f32>())).sum::<usize>()
}

#[no_mangle]
pub unsafe extern "C" fn density_point(ptr: *mut DensityGraph, node: usize, location: f32, value: usize, derivative: f32) {
    let graph = &mut *ptr;
    graph.nodes[node].points.push(Point { location, value, derivative });
}

#[no_mangle]
pub unsafe extern "C" fn density_sample(ptr: *const DensityGraph, root: usize, x: i32, y: i32, z: i32) -> f32 {
    let graph = &*ptr;
    graph.evaluate(root, [x,y,z], &mut vec![None; graph.nodes.len()])
}

#[no_mangle]
pub unsafe extern "C" fn density_sample_reuse(ptr: *const DensityGraph, root: usize, x: i32, y: i32, z: i32) -> f32 {
    (&*ptr).evaluate_reusing_memo(root, [x,y,z])
}

#[no_mangle]
pub unsafe extern "C" fn density_sample_many(ptr: *const DensityGraph, queries: *const i32, count: usize, output: *mut f32) {
    let graph = &*ptr;
    let queries = std::slice::from_raw_parts(queries, count * 4);
    let output = std::slice::from_raw_parts_mut(output, count);
    for (query, value) in queries.chunks_exact(4).zip(output.iter_mut()) {
        let root = query[0] as usize;
        *value = if root < graph.nodes.len() {
            graph.evaluate(root, [query[1], query[2], query[3]], &mut vec![None; graph.nodes.len()])
        } else { f32::NAN };
    }
}

#[no_mangle]
pub unsafe extern "C" fn density_sample_many_reuse(ptr: *const DensityGraph, queries: *const i32, count: usize, output: *mut f32) {
    let graph = &*ptr;
    let queries = std::slice::from_raw_parts(queries, count * 4);
    let output = std::slice::from_raw_parts_mut(output, count);
    for (query, value) in queries.chunks_exact(4).zip(output.iter_mut()) {
        let root = query[0] as usize;
        *value = if root < graph.nodes.len() {
            graph.evaluate_reusing_memo(root, [query[1], query[2], query[3]])
        } else { f32::NAN };
    }
}

#[no_mangle]
pub unsafe extern "C" fn density_volume(ptr: *const DensityGraph, root: usize, x:i32,y:i32,z:i32,sx:usize,sy:usize,sz:usize, output:*mut f32) {
    let values = (&*ptr).volume(root,[x,y,z],[sx,sy,sz],[1,1,1]);
    std::ptr::copy_nonoverlapping(values.as_ptr(), output, values.len());
}
