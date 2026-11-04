mod noise;
mod random;
mod climate;
mod seed_hash;
mod normal_noise;
mod density;
mod legacy_random;
mod blended_noise;
mod aquifer;
mod end_island;
mod beardifier;

use noise::PerlinNoise;
use random::{Xoroshiro, PositionalRandom};
use normal_noise::NormalNoise;

#[no_mangle]
pub extern "C" fn worldgen_abi_version() -> u32 { 1 }

// RNG=1, Perlin=2, climate=4, positional RNG=8, normal noise=16, density subset=32.
#[no_mangle]
pub extern "C" fn worldgen_capabilities() -> u32 { 63 }

#[no_mangle]
pub unsafe extern "C" fn positional_fork(ptr: *mut Xoroshiro) -> *mut PositionalRandom {
    Box::into_raw(Box::new((*ptr).fork_positional()))
}

#[no_mangle]
pub unsafe extern "C" fn positional_free(ptr: *mut PositionalRandom) {
    if !ptr.is_null() { drop(Box::from_raw(ptr)); }
}

#[no_mangle]
pub unsafe extern "C" fn positional_at(ptr: *const PositionalRandom, x: i32, y: i32, z: i32) -> *mut Xoroshiro {
    Box::into_raw(Box::new((*ptr).at(x, y, z)))
}

#[no_mangle]
pub unsafe extern "C" fn positional_seed(ptr: *const PositionalRandom, seed: u64) -> *mut Xoroshiro {
    Box::into_raw(Box::new((*ptr).from_seed(seed)))
}

#[no_mangle]
pub unsafe extern "C" fn positional_hash(ptr: *const PositionalRandom, name: *const u8, len: usize) -> *mut Xoroshiro {
    Box::into_raw(Box::new((*ptr).from_hash(std::slice::from_raw_parts(name, len))))
}

#[no_mangle]
pub extern "C" fn buffer_alloc(len: usize) -> *mut f64 {
    Box::into_raw(vec![0.0f64; len].into_boxed_slice()) as *mut f64
}

#[no_mangle]
pub unsafe extern "C" fn buffer_free(ptr: *mut f64, len: usize) {
    drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len)));
}

#[no_mangle]
pub unsafe extern "C" fn normal_create(random: *mut Xoroshiro, octave: i32, amplitude: f64, normalization: u32, modifiers: *const f64, count: usize) -> *mut NormalNoise {
    if !(1..=32).contains(&count) || !(-32..=32).contains(&octave) || normalization > 2 { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(NormalNoise::new(&mut *random, octave, amplitude, normalization, std::slice::from_raw_parts(modifiers, count))))
}

#[no_mangle]
pub unsafe extern "C" fn normal_free(ptr: *mut NormalNoise) {
    if !ptr.is_null() { drop(Box::from_raw(ptr)); }
}

#[no_mangle]
pub unsafe extern "C" fn normal_legacy_create(seed: u64, octave: i32, amplitude: f64, normalization: u32, modifiers: *const f64, count: usize) -> *mut NormalNoise {
    if !(1..=32).contains(&count) || !(-32..=0).contains(&octave) || octave + count as i32 > 1 || normalization > 2 { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(NormalNoise::legacy(seed, octave, amplitude, normalization, std::slice::from_raw_parts(modifiers, count))))
}

#[no_mangle]
pub unsafe extern "C" fn normal_sample(ptr: *const NormalNoise, x: f64, y: f64, z: f64) -> f32 {
    (*ptr).sample(x, y, z)
}

#[no_mangle]
pub unsafe extern "C" fn normal_legacy_positional_create(seed: u64, octave: i32, amplitude: f64, normalization: u32, modifiers: *const f64, count: usize) -> *mut NormalNoise {
    if !(1..=32).contains(&count) || !(-32..=32).contains(&octave) || normalization > 2 { return std::ptr::null_mut(); }
    Box::into_raw(Box::new(NormalNoise::legacy_positional(seed, octave, amplitude, normalization, std::slice::from_raw_parts(modifiers, count))))
}

#[no_mangle]
pub extern "C" fn rng_create(seed: u64) -> *mut Xoroshiro {
    Box::into_raw(Box::new(Xoroshiro::seeded(seed)))
}

#[no_mangle]
pub extern "C" fn rng_create_pair(lo: u64, hi: u64) -> *mut Xoroshiro {
    Box::into_raw(Box::new(Xoroshiro::new(lo, hi)))
}

#[no_mangle]
pub unsafe extern "C" fn rng_free(ptr: *mut Xoroshiro) {
    if !ptr.is_null() { drop(Box::from_raw(ptr)); }
}

#[no_mangle]
pub unsafe extern "C" fn rng_next_long(ptr: *mut Xoroshiro) -> u64 { (*ptr).next_long() }

#[no_mangle]
pub unsafe extern "C" fn rng_next_int(ptr: *mut Xoroshiro, bound: u32) -> i32 {
    if bound == 0 || bound > i32::MAX as u32 { return -1; }
    (*ptr).next_int(bound) as i32
}

#[no_mangle]
pub unsafe extern "C" fn rng_next_double(ptr: *mut Xoroshiro) -> f64 { (*ptr).next_double() }

#[no_mangle]
pub extern "C" fn perlin_create(seed: u64) -> *mut PerlinNoise {
    Box::into_raw(Box::new(PerlinNoise::new(&mut Xoroshiro::seeded(seed))))
}

#[no_mangle]
pub unsafe extern "C" fn perlin_free(ptr: *mut PerlinNoise) {
    if !ptr.is_null() { drop(Box::from_raw(ptr)); }
}

#[no_mangle]
pub unsafe extern "C" fn perlin_sample(ptr: *mut PerlinNoise, x: f64, y: f64, z: f64) -> f32 {
    (*ptr).sample(x, y, z)
}

#[no_mangle]
pub unsafe extern "C" fn smeared_perlin_sample(ptr: *mut PerlinNoise, x: f64, y: f64, z: f64, scale: f64) -> f32 {
    (*ptr).sample_smeared(x, y, z, scale)
}
