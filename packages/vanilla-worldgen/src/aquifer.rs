use std::collections::HashMap;
use crate::density::DensityGraph;
use crate::random::{PositionalRandom,Xoroshiro};

const OFFSETS: [[i32;2];13] = [[0,0],[-2,-1],[-1,-1],[0,-1],[1,-1],[-3,0],[-2,0],[-1,0],[1,0],[-2,1],[-1,1],[0,1],[1,1]];
const BELOW: i32 = -32512;
const FLOW: f64 = 1.0 - 44.0 / 25.0;

#[derive(Clone,Copy,PartialEq,Eq)]
struct Fluid { level:i32, kind:u8 }
impl Fluid { fn at(self,y:i32)->u8 { if y < self.level { self.kind } else { 1 } } }
struct Cell { position:[i32;3], status:Option<Fluid> }
struct Aquifer<'a> {
    graph:&'a DensityGraph, roots:[usize;6], random:PositionalRandom,
    cells:HashMap<[i32;3],Cell>, surfaces:HashMap<[i32;2],i32>,
    sea:i32, default_fluid:u8, skip:i32,
}
fn similarity(a:i32,b:i32)->f64 { 1.0 - (b-a) as f64 / 25.0 }
impl<'a> Aquifer<'a> {
    fn global(&self,y:i32)->Fluid {
        if y < (-54).min(self.sea) { Fluid{level:-54,kind:3} }
        else { Fluid{level:self.sea,kind:self.default_fluid} }
    }
    fn noise(&self,index:usize,p:[i32;3])->f32 { self.graph.evaluate_fresh(self.roots[index],p) }
    fn surface(&mut self,x:i32,z:i32)->i32 {
        let p = [x.div_euclid(4)*4,z.div_euclid(4)*4];
        if let Some(&value) = self.surfaces.get(&p) { return value; }
        let value = self.noise(5,[p[0],0,p[1]]).floor() as i32;
        self.surfaces.insert(p,value); value
    }
    fn fluid(&mut self,p:[i32;3])->Fluid {
        let [x,y,z] = p;
        let global = self.global(y);
        let mut min_surface = i32::MAX;
        let mut surface_fluid = false;
        for [dx,dz] in OFFSETS {
            let sx = x+dx*16; let sz = z+dz*16;
            let surface = self.surface(sx,sz);
            let adjusted = surface+8;
            let center = dx == 0 && dz == 0;
            if center && y-12 > adjusted { return global; }
            let near = y+12 > adjusted;
            if near || center {
                let candidate = self.global(adjusted);
                if candidate.at(adjusted) != 1 {
                    if center { surface_fluid = true; }
                    if near { return candidate; }
                }
            }
            min_surface = min_surface.min(surface);
        }
        let (spread,flood) = if self.noise(4,p) > 0.0 { (-1.0,-1.0) } else {
            let alpha = if surface_fluid { 1.0 - ((min_surface+8-y) as f64 / 64.0).clamp(0.0,1.0) } else { 0.0 };
            let flooded = (self.noise(1,p) as f64).clamp(-1.0,1.0);
            let threshold_flood = -0.3 + (1.0-alpha) * (0.8 - -0.3);
            let threshold_spread = -0.8 + (1.0-alpha) * (0.4 - -0.8);
            (flooded-threshold_spread,flooded-threshold_flood)
        };
        let level = if flood > 0.0 { global.level } else if spread > 0.0 {
            let gy = y.div_euclid(40);
            let noise = self.noise(2,[x.div_euclid(16),gy,z.div_euclid(16)]) * 10.0;
            min_surface.min(gy*40+20+((noise as f64 / 3.0).floor() as i32)*3)
        } else { BELOW };
        let mut kind = global.kind;
        if level <= -10 && level != BELOW && kind != 3 && (self.noise(3,[x.div_euclid(64),y.div_euclid(40),z.div_euclid(64)]) as f64).abs() > 0.3 { kind=3; }
        Fluid{level,kind}
    }
    fn location(&mut self,key:[i32;3])->[i32;3] {
        if let Some(cell) = self.cells.get(&key) { return cell.position; }
        let mut rng = self.random.at(key[0],key[1],key[2]);
        let position = [key[0]*16+rng.next_int(10) as i32,key[1]*12+rng.next_int(9) as i32,key[2]*16+rng.next_int(10) as i32];
        self.cells.insert(key,Cell{position,status:None}); position
    }
    fn status(&mut self,key:[i32;3])->Fluid {
        if let Some(status) = self.cells[&key].status { return status; }
        let status = self.fluid(self.cells[&key].position);
        self.cells.get_mut(&key).unwrap().status = Some(status); status
    }
    fn pressure(&self,p:[i32;3],barrier:&mut Option<f64>,a:Fluid,b:Fluid)->f64 {
        let av = a.at(p[1]); let bv = b.at(p[1]);
        if (av == 2 && bv == 3) || (av == 3 && bv == 2) { return 2.0; }
        let difference = (a.level-b.level).abs();
        if difference == 0 { return 0.0; }
        let midpoint = 0.5 * (a.level+b.level) as f64;
        let offset = p[1] as f64 + 0.5 - midpoint;
        let edge = difference as f64 / 2.0 - offset.abs();
        let shape = if offset > 0.0 { if edge > 0.0 { edge/1.5 } else { edge/2.5 } }
            else { let v=3.0+edge; if v > 0.0 { v/3.0 } else { v/10.0 } };
        let value = if !(-2.0..=2.0).contains(&shape) { 0.0 }
            else { *barrier.get_or_insert_with(||self.noise(0,p) as f64) };
        2.0 * (value+shape)
    }
    fn substance(&mut self,p:[i32;3],density:f64)->u8 {
        if density > 0.0 { return 0; }
        let [x,y,z] = p;
        let global = self.global(y);
        if y > self.skip { return global.at(y); }
        if global.at(y) == 3 { return 3; }
        let base = [(x-5).div_euclid(16),(y+1).div_euclid(12),(z-5).div_euclid(16)];
        let mut nearest = [(i32::MAX,[0;3]);4];
        for dx in 0..=1 { for dy in -1..=1 { for dz in 0..=1 {
            let key = [base[0]+dx,base[1]+dy,base[2]+dz];
            let loc = self.location(key);
            let d = (loc[0]-x).pow(2)+(loc[1]-y).pow(2)+(loc[2]-z).pow(2);
            if let Some(index) = nearest.iter().position(|&(distance,_)| d <= distance) {
                for i in (index+1..4).rev() { nearest[i]=nearest[i-1]; }
                nearest[index]=(d,key);
            }
        }}}
        let a = self.status(nearest[0].1);
        let sim = similarity(nearest[0].0,nearest[1].0);
        let result = a.at(y);
        if sim <= 0.0 {
            let update = sim >= FLOW && a != self.status(nearest[1].1);
            return result | if update { 16 } else { 0 };
        }
        if result == 2 && self.global(y-1).at(y-1) == 3 { return result|16; }
        let mut barrier = None;
        let b = self.status(nearest[1].1);
        if density + sim*self.pressure(p,&mut barrier,a,b) > 0.0 { return 0; }
        let c = self.status(nearest[2].1);
        let sim_ac = similarity(nearest[0].0,nearest[2].0);
        if sim_ac > 0.0 && density + sim*sim_ac*self.pressure(p,&mut barrier,a,c) > 0.0 { return 0; }
        let sim_bc = similarity(nearest[1].0,nearest[2].0);
        if sim_bc > 0.0 && density + sim*sim_bc*self.pressure(p,&mut barrier,b,c) > 0.0 { return 0; }
        let update = a != b || (sim_bc >= FLOW && b != c) || (sim_ac >= FLOW && a != c)
            || (sim_ac >= FLOW && similarity(nearest[0].0,nearest[3].0) >= FLOW && a != self.status(nearest[3].1));
        result | if update { 16 } else { 0 }
    }
}

#[no_mangle]
pub unsafe extern "C" fn aquifer_volume(graph:*const DensityGraph, root:usize, seed:u64, x:i32,y:i32,z:i32,sx:usize,sy:usize,sz:usize,sea:i32,fluid:u32,roots:*const u32,output:*mut u8) {
    aquifer_volume_inner(graph,root,seed,x,y,z,sx,sy,sz,sea,fluid,roots,output,None);
}

#[no_mangle]
pub unsafe extern "C" fn aquifer_carving_volume(graph:*const DensityGraph, root:usize, seed:u64, x:i32,y:i32,z:i32,sx:usize,sy:usize,sz:usize,sea:i32,fluid:u32,roots:*const u32,output:*mut u8) {
    aquifer_volume_inner(graph,root,seed,x,y,z,sx,sy,sz,sea,fluid,roots,output,Some(0.0));
}

unsafe fn aquifer_volume_inner(graph:*const DensityGraph, root:usize, seed:u64, x:i32,y:i32,z:i32,sx:usize,sy:usize,sz:usize,sea:i32,fluid:u32,roots:*const u32,output:*mut u8, density_override:Option<f32>) {
    let graph = &*graph;
    let mut density = graph.volume(root,[x,y,z],[sx,sy,sz],[1,1,1]);
    if let Some(value) = density_override { density.fill(value); }
    let values = std::slice::from_raw_parts_mut(output,density.len());
    if roots.is_null() {
        for zz in 0..sz { for xx in 0..sx { for yy in 0..sy {
            let i=(zz*sx+xx)*sy+yy; let by=y+yy as i32;
            values[i]=if density[i]>0.0 {0} else if by < (-54).min(sea) {3} else if by<sea {fluid as u8} else {1};
        }}}
        return;
    }
    let roots: [usize;6] = std::slice::from_raw_parts(roots,6).iter().map(|&v|v as usize).collect::<Vec<_>>().try_into().unwrap();
    let random = Xoroshiro::seeded(seed).fork_positional().from_hash(b"minecraft:aquifer").fork_positional();
    let mut aquifer = Aquifer{graph,roots,random,cells:HashMap::new(),surfaces:HashMap::new(),sea,default_fluid:fluid as u8,skip:i32::MAX};
    let min_x=(x-5).div_euclid(16)*16; let min_z=(z-5).div_euclid(16)*16;
    let max_x=(x+sx as i32-1-5).div_euclid(16)*16+16+9;
    let max_z=(z+sz as i32-1-5).div_euclid(16)*16+16+9;
    let mut maximum = i32::MIN;
    for bz in min_z.div_euclid(4)..=max_z.div_euclid(4) {
        for bx in min_x.div_euclid(4)..=max_x.div_euclid(4) { maximum=maximum.max(aquifer.surface(bx*4,bz*4)); }
    }
    aquifer.skip = ((maximum+8+12).div_euclid(12)+1)*12+10;
    for zz in 0..sz { for xx in 0..sx { for yy in 0..sy {
        let i=(zz*sx+xx)*sy+yy;
        values[i]=aquifer.substance([x+xx as i32,y+yy as i32,z+zz as i32],density[i] as f64);
    }}}
}
