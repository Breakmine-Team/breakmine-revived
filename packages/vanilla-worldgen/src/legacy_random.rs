use crate::random::NoiseRandom;

pub struct LegacyRandom { state: u64 }

impl LegacyRandom {
    pub fn new(seed: u64) -> Self { Self { state: (seed ^ 25214903917) & ((1 << 48) - 1) } }

    pub fn next(&mut self, bits: u32) -> u32 {
        self.state = self.state.wrapping_mul(25214903917).wrapping_add(11) & ((1 << 48) - 1);
        (self.state >> (48 - bits)) as u32
    }

    pub fn next_int_raw(&mut self) -> i32 { self.next(32) as i32 }

    pub fn next_long(&mut self) -> u64 {
        ((self.next(32) as i32 as i64) << 32).wrapping_add(self.next(32) as i32 as i64) as u64
    }

    pub fn skip_octave(&mut self) {
        for _ in 0..262 { self.next(32); }
    }
}

impl NoiseRandom for LegacyRandom {
    fn next_double(&mut self) -> f64 {
        (((self.next(26) as u64) << 27) + self.next(27) as u64) as f64 * 1.1102230246251565e-16
    }

    fn next_int(&mut self, bound: u32) -> u32 {
        if bound.is_power_of_two() { return ((bound as u64 * self.next(31) as u64) >> 31) as u32; }
        loop {
            let bits = self.next(31);
            let value = bits % bound;
            if bits.wrapping_sub(value).wrapping_add(bound - 1) as i32 >= 0 { return value; }
        }
    }
}
