use crate::{noise::PerlinNoise, random::Xoroshiro};
use crate::legacy_random::LegacyRandom;

#[derive(Clone)]
struct Layer { noise: PerlinNoise, frequency: f64, amplitude: f32 }
#[derive(Clone)]
pub struct NormalNoise { layers: Vec<Layer> }

impl NormalNoise {
    fn parameters(base_octave: i32, base_amplitude: f64, normalization: u32, modifiers: &[f64]) -> (Vec<(i32, f64, f64)>, f64) {
        let count = modifiers.len() as i32;
        let mut amplitude = base_amplitude;
        if normalization != 0 {
            amplitude *= 0.5f64.powi(-(count - 1)) / (0.5f64.powi(-count) - 1.0);
        }
        let mut frequency = 2.0f64.powi(base_octave);
        let mut octaves = Vec::new();
        for (i, &modifier) in modifiers.iter().enumerate() {
            if modifier != 0.0 { octaves.push((base_octave + i as i32, frequency, amplitude * modifier)); }
            frequency *= 2.0;
            amplitude *= 0.5;
        }
        // DoubleStream.sum uses compensated summation; sampling itself is float32.
        let (mut sum, mut correction, mut variance) = (0.0, 0.0, 0.0);
        for &(_, _, amplitude) in &octaves {
            let value = amplitude.abs() - correction;
            let next = sum + value;
            correction = (next - sum) - value;
            sum = next;
            let deviation = 0.2702247831245211 * amplitude.abs();
            variance += deviation * deviation;
        }
        let mut factor = if variance == 0.0 { 0.0 } else {
            ((sum - correction) * (1.0 / 3.0)) / (variance.sqrt() * 2.0f64.sqrt())
        };
        if normalization == 2 && factor != 0.0 {
            let first = modifiers.iter().position(|v| *v != 0.0).unwrap();
            let last = modifiers.iter().rposition(|v| *v != 0.0).unwrap();
            factor = base_amplitude * 0.5 * (1.0 / 3.0) / (0.1 * (1.0 + 1.0 / (last - first + 1) as f64));
        }
        (octaves, factor)
    }

    pub fn new(random: &mut Xoroshiro, base_octave: i32, base_amplitude: f64, normalization: u32, modifiers: &[f64]) -> Self {
        let (octaves, factor) = Self::parameters(base_octave, base_amplitude, normalization, modifiers);
        let first = random.fork_positional();
        let second = random.fork_positional();
        let mut layers = Vec::new();
        for (octave, frequency, amplitude) in octaves {
            let name = format!("octave_{octave}");
            let amplitude = (factor * amplitude) as f32;
            layers.push(Layer { noise: PerlinNoise::new(&mut first.from_hash(name.as_bytes())), frequency, amplitude });
            layers.push(Layer { noise: PerlinNoise::new(&mut second.from_hash(name.as_bytes())), frequency: frequency * 1.0181268882175227, amplitude });
        }
        Self { layers }
    }

    pub fn legacy(seed: u64, base_octave: i32, base_amplitude: f64, normalization: u32, modifiers: &[f64]) -> Self {
        let (_, factor) = Self::parameters(base_octave, base_amplitude, normalization, modifiers);
        let multiplier = (factor * base_amplitude) as f32;
        let mut random = LegacyRandom::new(seed);
        let mut layers = Vec::new();
        for stack_scale in [1.0, 1.0181268882175227] {
            let count = modifiers.len();
            let zero_octave = -base_octave;
            let mut octaves = vec![None; count];
            let first = PerlinNoise::new(&mut random);
            if zero_octave >= 0 && (zero_octave as usize) < count && modifiers[zero_octave as usize] != 0.0 {
                octaves[zero_octave as usize] = Some(first);
            }
            for i in (0..zero_octave).rev() {
                if (i as usize) < count && modifiers[i as usize] != 0.0 {
                    octaves[i as usize] = Some(PerlinNoise::new(&mut random));
                } else { random.skip_octave(); }
            }
            let mut frequency = 2.0f64.powi(base_octave);
            let mut amplitude = 2.0f64.powi(count as i32 - 1) / (2.0f64.powi(count as i32) - 1.0);
            for (i, noise) in octaves.into_iter().enumerate() {
                if let Some(noise) = noise {
                    layers.push(Layer { noise, frequency: frequency * stack_scale, amplitude: (amplitude * modifiers[i]) as f32 * multiplier });
                }
                frequency *= 2.0;
                amplitude /= 2.0;
            }
        }
        Self { layers }
    }

    pub fn legacy_positional(seed: u64, base_octave: i32, base_amplitude: f64, normalization: u32, modifiers: &[f64]) -> Self {
        let (octaves, factor) = Self::parameters(base_octave, base_amplitude, normalization, modifiers);
        let mut random = LegacyRandom::new(seed);
        let first = random.next_long();
        let second = random.next_long();
        let mut layers = Vec::new();
        for (octave, frequency, amplitude) in octaves {
            let name = format!("octave_{octave}");
            let hash = name.bytes().fold(0i32, |h, c| h.wrapping_mul(31).wrapping_add(c as i32)) as i64 as u64;
            let amplitude = (factor * amplitude) as f32;
            layers.push(Layer { noise: PerlinNoise::new(&mut LegacyRandom::new(first ^ hash)), frequency, amplitude });
            layers.push(Layer { noise: PerlinNoise::new(&mut LegacyRandom::new(second ^ hash)), frequency: frequency * 1.0181268882175227, amplitude });
        }
        Self { layers }
    }

    pub fn sample(&self, x: f64, y: f64, z: f64) -> f32 {
        let mut result = 0.0f32;
        for layer in &self.layers {
            result += layer.amplitude * layer.noise.sample(x * layer.frequency, y * layer.frequency, z * layer.frequency);
        }
        result
    }
}
