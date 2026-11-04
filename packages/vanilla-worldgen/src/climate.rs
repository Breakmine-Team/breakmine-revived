#[derive(Default)]
struct Node {
    bounds: [[i64; 2]; 7],
    children: Vec<usize>,
    biome: i32,
}

impl Node {
    fn distance(&self, point: &[i64; 7]) -> i64 {
        self.bounds.iter().zip(point.iter()).fold(0i64, |sum, ([min,max], value)| {
            let distance = if value > max { value.wrapping_sub(*max) } else { min.wrapping_sub(*value).max(0) };
            sum.wrapping_add(distance.wrapping_mul(distance))
        })
    }
}

pub struct ClimateTree { nodes: Vec<Node>, last: Option<usize> }

impl ClimateTree {
    fn search(&self, index: usize, point: &[i64; 7], previous: Option<usize>) -> usize {
        let node = &self.nodes[index];
        if node.biome >= 0 { return index; }
        let mut best = previous;
        let mut distance = best.map_or(i64::MAX, |i| self.nodes[i].distance(point));
        for &child in &node.children {
            let child_distance = self.nodes[child].distance(point);
            if distance > child_distance {
                let leaf = self.search(child, point, best);
                let actual = if leaf == child { child_distance } else { self.nodes[leaf].distance(point) };
                if distance > actual { distance = actual; best = Some(leaf); }
            }
        }
        best.expect("Invalid empty climate tree")
    }
}

#[no_mangle]
pub extern "C" fn climate_create(count: u32) -> *mut ClimateTree {
    Box::into_raw(Box::new(ClimateTree { nodes: (0..count).map(|_| Node { biome: -1, ..Default::default() }).collect(), last: None }))
}

#[no_mangle]
pub unsafe extern "C" fn climate_free(ptr: *mut ClimateTree) {
    if !ptr.is_null() { drop(Box::from_raw(ptr)); }
}

#[no_mangle]
pub unsafe extern "C" fn climate_bounds(ptr: *mut ClimateTree, index: u32) -> *mut i64 {
    (&mut (*ptr).nodes)[index as usize].bounds.as_mut_ptr().cast()
}

#[no_mangle]
pub unsafe extern "C" fn climate_set_biome(ptr: *mut ClimateTree, index: u32, biome: i32) {
    (&mut (*ptr).nodes)[index as usize].biome = biome;
}

#[no_mangle]
pub unsafe extern "C" fn climate_add_child(ptr: *mut ClimateTree, index: u32, child: u32) {
    assert!((child as usize) < (*ptr).nodes.len());
    (&mut (*ptr).nodes)[index as usize].children.push(child as usize);
}

#[no_mangle]
pub unsafe extern "C" fn climate_sample(ptr: *mut ClimateTree, t: i64, h: i64, c: i64, e: i64, d: i64, w: i64) -> i32 {
    let tree = &mut *ptr;
    let leaf = tree.search(0, &[t,h,c,e,d,w,0], tree.last);
    tree.last = Some(leaf);
    tree.nodes[leaf].biome
}

#[no_mangle]
pub extern "C" fn climate_quantize(value: f32) -> i64 { (value * 10000.) as i64 }
