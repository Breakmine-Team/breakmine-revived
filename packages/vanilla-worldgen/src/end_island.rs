use crate::legacy_random::LegacyRandom;
use crate::random::NoiseRandom;

const GRADIENTS: [[i32; 3]; 12] = [
    [1,1,0],[-1,1,0],[1,-1,0],[-1,-1,0],
    [1,0,1],[-1,0,1],[1,0,-1],[-1,0,-1],
    [0,1,1],[0,-1,1],[0,1,-1],[0,-1,-1],
];
const F2: f64 = 0.36602540378443864676;
const G2: f64 = 0.21132486540518711775;

struct Simplex2 { permutation: [u8; 256] }

impl Simplex2 {
    fn new(random: &mut LegacyRandom) -> Self {
        random.next_double();
        random.next_double();
        random.next_double();
        let mut permutation = [0u8; 256];
        for (i, value) in permutation.iter_mut().enumerate() { *value = i as u8; }
        for i in 0..256 {
            let j = random.next_int((256 - i) as u32) as usize;
            permutation.swap(i, i + j);
        }
        Self { permutation }
    }

    fn permute(&self, value: i32) -> usize { self.permutation[(value & 255) as usize] as usize }

    fn corner(gradient: usize, x: f64, y: f64) -> f64 {
        let mut attenuation = 0.5 - x * x - y * y;
        if attenuation < 0.0 { return 0.0; }
        attenuation *= attenuation;
        let g = GRADIENTS[gradient];
        attenuation * attenuation * (g[0] as f64 * x + g[1] as f64 * y)
    }

    fn sample(&self, x: f64, y: f64) -> f32 {
        let skew = (x + y) * F2;
        let i = (x + skew).floor() as i32;
        let j = (y + skew).floor() as i32;
        let unskew = (i + j) as f64 * G2;
        let x0 = x - (i as f64 - unskew);
        let y0 = y - (j as f64 - unskew);
        let (i1,j1) = if x0 > y0 { (1,0) } else { (0,1) };
        let x1 = x0 - i1 as f64 + G2;
        let y1 = y0 - j1 as f64 + G2;
        let x2 = x0 - 1.0 + 2.0 * G2;
        let y2 = y0 - 1.0 + 2.0 * G2;
        let g0 = self.permute(i + self.permute(j) as i32) % 12;
        let g1 = self.permute(i + i1 + self.permute(j + j1) as i32) % 12;
        let g2 = self.permute(i + 1 + self.permute(j + 1) as i32) % 12;
        (70.0 * (Self::corner(g0,x0,y0) + Self::corner(g1,x1,y1) + Self::corner(g2,x2,y2))) as f32
    }
}

pub struct EndIslandNoise { noise: Simplex2 }

impl EndIslandNoise {
    pub fn new(seed: u64) -> Self {
        let mut random = LegacyRandom::new(seed);
        for _ in 0..17292 { random.next_int_raw(); }
        Self { noise: Simplex2::new(&mut random) }
    }

    fn height_value(&self, x: i32, z: i32) -> f32 {
        let center_x = x / 2;
        let center_z = z / 2;
        let odd_x = (x % 2) as f32;
        let odd_z = (z % 2) as f32;
        let mut best = -100.0f32;
        for island_x in -12..=12 {
            for island_z in -12..=12 {
                let candidate_x = center_x as i64 + island_x;
                let candidate_z = center_z as i64 + island_z;
                if candidate_x * candidate_x + candidate_z * candidate_z <= 4096
                    || self.noise.sample(candidate_x as f64, candidate_z as f64) >= -0.9 {
                    continue;
                }
                let mut radius = (candidate_x.abs() as f32 * 3439.0f32) + (candidate_z.abs() as f32 * 147.0f32);
                radius = radius % 13.0f32 + 9.0f32;
                let dx = odd_x - (island_x * 2) as f32;
                let dz = odd_z - (island_z * 2) as f32;
                let distance = (dx * dx + dz * dz).sqrt();
                best = best.max((100.0f32 - distance * radius).clamp(-100.0,80.0));
            }
        }
        best
    }

    pub fn sample(&self, x: i32, _y: i32, z: i32) -> f32 {
        (self.height_value(x / 8, z / 8) - 8.0f32) / 128.0f32
    }
}
