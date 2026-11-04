pub struct Xoroshiro { lo: u64, hi: u64 }

pub trait NoiseRandom {
    fn next_double(&mut self) -> f64;
    fn next_int(&mut self, bound: u32) -> u32;
}

impl NoiseRandom for Xoroshiro {
    fn next_double(&mut self) -> f64 { Xoroshiro::next_double(self) }
    fn next_int(&mut self, bound: u32) -> u32 { Xoroshiro::next_int(self, bound) }
}

pub struct PositionalRandom { lo: u64, hi: u64 }

impl PositionalRandom {
    pub fn from_hash(&self, name: &[u8]) -> Xoroshiro {
        let (lo, hi) = crate::seed_hash::seed_hash(name);
        Xoroshiro::new(self.lo ^ lo, self.hi ^ hi)
    }

    pub fn from_seed(&self, seed: u64) -> Xoroshiro {
        Xoroshiro::new(self.lo ^ seed, self.hi ^ seed)
    }

    pub fn at(&self, x: i32, y: i32, z: i32) -> Xoroshiro {
        let n = x.wrapping_mul(3129871) as i64 ^ (z as i64).wrapping_mul(116129781) ^ y as i64;
        let hash = n.wrapping_mul(n).wrapping_mul(42317861).wrapping_add(n.wrapping_mul(11)) >> 16;
        Xoroshiro::new(self.lo ^ hash as u64, self.hi)
    }
}

const GOLDEN: u64 = 0x9e3779b97f4a7c15;
const SILVER: u64 = 0x6a09e667f3bcc909;

fn mix(mut n: u64) -> u64 {
    n = (n ^ (n >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    n = (n ^ (n >> 27)).wrapping_mul(0x94d049bb133111eb);
    n ^ (n >> 31)
}

impl Xoroshiro {
    pub fn fork_positional(&mut self) -> PositionalRandom {
        PositionalRandom { lo: self.next_long(), hi: self.next_long() }
    }
    pub fn new(lo: u64, hi: u64) -> Self {
        if lo | hi == 0 { Self { lo: GOLDEN, hi: SILVER } } else { Self { lo, hi } }
    }

    pub fn seeded(seed: u64) -> Self {
        let lo = seed ^ SILVER;
        Self::new(mix(lo), mix(lo.wrapping_add(GOLDEN)))
    }

    pub fn next_long(&mut self) -> u64 {
        let lo = self.lo;
        let hi = self.hi;
        let result = lo.wrapping_add(hi).rotate_left(17).wrapping_add(lo);
        let mixed = hi ^ lo;
        self.lo = lo.rotate_left(49) ^ mixed ^ (mixed << 21);
        self.hi = mixed.rotate_left(28);
        result
    }

    pub fn next_double(&mut self) -> f64 {
        (self.next_long() >> 11) as f64 * 1.1102230246251565e-16
    }

    pub fn next_int(&mut self, bound: u32) -> u32 {
        let mut product = (self.next_long() as u32 as u64) * bound as u64;
        if (product as u32) < bound {
            let threshold = bound.wrapping_neg() % bound;
            while (product as u32) < threshold {
                product = (self.next_long() as u32 as u64) * bound as u64;
            }
        }
        (product >> 32) as u32
    }
}
