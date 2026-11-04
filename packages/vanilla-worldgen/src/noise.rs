use crate::random::NoiseRandom;

const GRADIENTS: [[f32; 3]; 16] = [
    [1., 1., 0.], [-1., 1., 0.], [1., -1., 0.], [-1., -1., 0.],
    [1., 0., 1.], [-1., 0., 1.], [1., 0., -1.], [-1., 0., -1.],
    [0., 1., 1.], [0., -1., 1.], [0., 1., -1.], [0., -1., -1.],
    [1., 1., 0.], [0., -1., 1.], [-1., 1., 0.], [0., -1., -1.],
];

#[derive(Clone)]
pub struct PerlinNoise { perms: [u8; 256], offset: [f64; 3] }

fn wrap(value: f64) -> f64 {
    let half = f64::from_bits(16777216f64.to_bits() - 1);
    if value >= -half && value < half { value }
    else { value - (value / 33554432.0 + 0.5).floor() * 33554432.0 }
}

fn smoothstep(t: f32) -> f32 { t * t * t * (t * (t * 6. - 15.) + 10.) }
fn lerp(t: f32, a: f32, b: f32) -> f32 { a + t * (b - a) }

impl PerlinNoise {
    pub fn new(random: &mut impl NoiseRandom) -> Self {
        let offset = [random.next_double() * 256., random.next_double() * 256., random.next_double() * 256.];
        let mut perms = [0u8; 256];
        for (i, p) in perms.iter_mut().enumerate() { *p = i as u8; }
        for i in 0..256 { perms.swap(i, i + random.next_int((256 - i) as u32) as usize); }
        Self { perms, offset }
    }

    fn permute(&self, n: i32) -> i32 { self.perms[(n & 255) as usize] as i32 }

    pub fn sample(&self, x: f64, y: f64, z: f64) -> f32 { self.sample_impl(x, y, z, None) }

    pub fn sample_smeared(&self, x: f64, y: f64, z: f64, scale: f64) -> f32 {
        self.sample_impl(x, y, z, Some(scale))
    }

    fn sample_impl(&self, x: f64, y: f64, z: f64, smear: Option<f64>) -> f32 {
        let values = [wrap(x) + self.offset[0], wrap(y) + self.offset[1], wrap(z) + self.offset[2]];
        let cells = values.map(|v| v.floor() as i32);
        let fx = (values[0] - cells[0] as f64) as f32;
        let dy = values[1] - cells[1] as f64;
        let fz = (values[2] - cells[2] as f64) as f32;
        let fy = match smear {
            Some(scale) => {
                let limited = if y >= 0. && y < dy { y } else { dy };
                // Mth.floor returns an int (including Java's saturating cast for NaN/infinity).
                let q = (limited / scale + 1.0000000116860974e-7).floor() as i32;
                (dy - q as f64 * scale) as f32
            },
            None => dy as f32,
        };
        let dot = |dx: i32, dy: i32, dz: i32| {
            let hash = self.permute(self.permute(self.permute(cells[0] + dx) + cells[1] + dy) + cells[2] + dz);
            let grad = GRADIENTS[(hash & 15) as usize];
            grad[0] * (fx - dx as f32) + grad[1] * (fy - dy as f32) + grad[2] * (fz - dz as f32)
        };
        let u = smoothstep(fx);
        let v = smoothstep(dy as f32);
        let w = smoothstep(fz);
        lerp(w,
            lerp(v, lerp(u, dot(0,0,0), dot(1,0,0)), lerp(u, dot(0,1,0), dot(1,1,0))),
            lerp(v, lerp(u, dot(0,0,1), dot(1,0,1)), lerp(u, dot(0,1,1), dot(1,1,1))))
    }
}
