pub struct Rigid { pub bounds: [i32; 6], pub adjustment: u32, pub ground: i32 }
#[derive(Default)]
pub struct Beardifier { pub pieces: Vec<Rigid>, pub junctions: Vec<[i32; 3]>, pub affected: Option<[i32; 6]> }

fn bury(x: f32, y: f32, z: f32) -> f32 {
    let squared = x*x + y*y + z*z;
    if squared >= 36.0 { 0.0 } else { 1.0 - squared.sqrt() / 6.0 }
}
fn beard(x: i32, y: i32, z: i32, ground_y: i32) -> f32 {
    if !(-12..12).contains(&x) || !(-12..12).contains(&y) || !(-12..12).contains(&z) { return 0.0; }
    let gy = ground_y as f32 + 0.5;
    let squared = x as f32 * x as f32 + gy*gy + z as f32 * z as f32;
    let input = (squared / 2.0) as f64;
    let inverse = f64::from_bits(6910469410427058090u64.wrapping_sub(input.to_bits() >> 1));
    let inverse = inverse * (1.5 - input*0.5*inverse*inverse);
    let direction = -gy * inverse as f32 / 2.0;
    static KERNEL: std::sync::OnceLock<[f32; 13824]> = std::sync::OnceLock::new();
    let kernel = KERNEL.get_or_init(|| std::array::from_fn(|index| {
        let x = (index / 24 % 24) as f64 - 12.0;
        let y = (index % 24) as f64 - 12.0 + 0.5;
        let z = (index / 576) as f64 - 12.0;
        std::f64::consts::E.powf(-(x*x + y*y + z*z) / 16.0) as f32
    }));
    direction * kernel[((z+12)*576 + (x+12)*24 + (y+12)) as usize]
}
impl Beardifier {
    pub fn sample(&self, x: i32, y: i32, z: i32) -> f32 {
        let Some(b) = self.affected else { return 0.0; };
        if x < b[0] || y < b[1] || z < b[2] || x > b[3] || y > b[4] || z > b[5] { return 0.0; }
        let mut value = 0.0f32;
        for p in &self.pieces {
            let b = p.bounds;
            let dx = 0.max(b[0].wrapping_sub(x)).max(x.wrapping_sub(b[3]));
            let dz = 0.max(b[2].wrapping_sub(z)).max(z.wrapping_sub(b[5]));
            let ground = b[1].wrapping_add(p.ground);
            let offset = y.wrapping_sub(ground);
            let dy = match p.adjustment {
                1 | 2 => offset,
                3 => 0.max(ground.wrapping_sub(y)).max(y.wrapping_sub(b[4])),
                4 => 0.max(b[1].wrapping_sub(y)).max(y.wrapping_sub(b[4])),
                _ => 0,
            };
            value += match p.adjustment {
                1 => bury(dx as f32, dy as f32 / 2.0, dz as f32),
                2 | 3 => beard(dx,dy,dz,offset) * 0.8,
                4 => bury(dx as f32 / 2.0, dy as f32 / 2.0, dz as f32 / 2.0) * 0.8,
                _ => 0.0,
            };
        }
        for j in &self.junctions {
            let dx = x.wrapping_sub(j[0]); let dy = y.wrapping_sub(j[1]); let dz = z.wrapping_sub(j[2]);
            value += beard(dx,dy,dz,dy) * 0.4;
        }
        value
    }
}
