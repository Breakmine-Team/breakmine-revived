use crate::{noise::PerlinNoise, random::{NoiseRandom, Xoroshiro}, legacy_random::LegacyRandom};

struct Layer { noise: PerlinNoise, frequency: f64, amplitude: f32, smear: f64 }
struct Stack { layers: Vec<Layer> }

impl Stack {
    fn new(random: &mut impl NoiseRandom, count: i32, smear: f64, factor: f64) -> Self {
        let mut frequency = 1.0;
        let mut amplitude = factor / (2.0f64.powi(count) - 1.0);
        let mut layers = Vec::new();
        for _ in 0..count {
            layers.push(Layer { noise: PerlinNoise::new(random), frequency, amplitude: amplitude as f32, smear: smear * frequency });
            frequency /= 2.0;
            amplitude *= 2.0;
        }
        Self { layers }
    }

    fn sample(&self, x: f64, y: f64, z: f64) -> f32 {
        let mut value = 0.0;
        for layer in &self.layers {
            value += layer.amplitude * layer.noise.sample_smeared(x * layer.frequency, y * layer.frequency, z * layer.frequency, layer.smear);
        }
        value
    }
}

pub struct BlendedNoise {
    minimum: Stack,
    maximum: Stack,
    main: Stack,
    xz: f64,
    y: f64,
    main_xz: f64,
    main_y: f64,
}

impl BlendedNoise {
    pub fn seeded(seed: u64, legacy: bool, xz_scale: f64, y_scale: f64, xz_factor: f64, y_factor: f64, smear: f64) -> Self {
        if legacy {
            Self::new(&mut LegacyRandom::new(seed), xz_scale, y_scale, xz_factor, y_factor, smear)
        } else {
            let mut random = Xoroshiro::seeded(seed).fork_positional().from_hash(b"minecraft:terrain");
            Self::new(&mut random, xz_scale, y_scale, xz_factor, y_factor, smear)
        }
    }

    fn new(random: &mut impl NoiseRandom, xz_scale: f64, y_scale: f64, xz_factor: f64, y_factor: f64, smear: f64) -> Self {
        let xz = 684.412 * xz_scale;
        let y = 684.412 * y_scale;
        let smear = y * smear;
        Self {
            minimum: Stack::new(random, 16, smear, 0.9999847412109375),
            maximum: Stack::new(random, 16, smear, 0.9999847412109375),
            main: Stack::new(random, 8, smear / y_factor, 12.75),
            xz, y, main_xz: xz / xz_factor, main_y: y / y_factor,
        }
    }

    pub fn sample(&self, x: f64, y: f64, z: f64) -> f32 {
        let alpha = (self.main.sample(x * self.main_xz, y * self.main_y, z * self.main_xz) + 0.5).clamp(0.0, 1.0);
        if alpha == 1.0 { return self.maximum.sample(x * self.xz, y * self.y, z * self.xz); }
        let minimum = self.minimum.sample(x * self.xz, y * self.y, z * self.xz);
        if alpha == 0.0 { return minimum; }
        let maximum = self.maximum.sample(x * self.xz, y * self.y, z * self.xz);
        minimum + alpha * (maximum - minimum)
    }
}
