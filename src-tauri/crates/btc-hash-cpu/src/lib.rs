use std::time::{Duration, Instant};

use btc_hash_core::{CpuKernelMode, HashEngine, HeaderHashBenchmark, HeaderWork};
use sha2::{compress256, Digest, Sha256};

pub const DIFF_ONE_TARGET: f64 =
    26_959_535_291_011_309_493_156_476_344_723_991_336_010_898_738_574_164_086_137_773_096_960.0;

const MAX_HEADER_HASH_BENCHMARK_NONCES: u32 = 1_000_000;

const H_INIT: [u32; 8] = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
];

#[allow(deprecated)]
fn compress_sha256_block(state: &mut [u32; 8], block: &[u8; 64]) {
    let block = sha2::digest::generic_array::GenericArray::from_slice(block);
    compress256(state, std::slice::from_ref(block));
}

pub fn sha256_midstate(first_block: &[u8; 64]) -> [u32; 8] {
    let mut state = H_INIT;
    compress_sha256_block(&mut state, first_block);
    state
}

pub fn double_sha256_from_midstate(
    midstate: &[u32; 8],
    tail: &[u32; 3],
    nonce: u32,
) -> [u8; 32] {
    ReusableMidstateHasher::new(tail).double_sha256(midstate, nonce)
}

pub struct ReusableMidstateHasher {
    second_block: [u8; 64],
    final_block: [u8; 64],
}

impl ReusableMidstateHasher {
    pub fn new(tail: &[u32; 3]) -> Self {
        let mut second_block = [0u8; 64];
        second_block[0..4].copy_from_slice(&tail[0].to_le_bytes());
        second_block[4..8].copy_from_slice(&tail[1].to_le_bytes());
        second_block[8..12].copy_from_slice(&tail[2].to_le_bytes());
        second_block[16] = 0x80;
        second_block[56..64].copy_from_slice(&640_u64.to_be_bytes());

        let mut final_block = [0u8; 64];
        final_block[32] = 0x80;
        final_block[56..64].copy_from_slice(&256_u64.to_be_bytes());

        Self {
            second_block,
            final_block,
        }
    }

    pub fn double_sha256_words(&mut self, midstate: &[u32; 8], nonce: u32) -> [u32; 8] {
        let mut first_digest = *midstate;
        self.second_block[12..16].copy_from_slice(&nonce.to_le_bytes());
        compress_sha256_block(&mut first_digest, &self.second_block);

        for (chunk, word) in self.final_block[0..32]
            .chunks_exact_mut(4)
            .zip(first_digest.iter())
        {
            chunk.copy_from_slice(&word.to_be_bytes());
        }

        let mut final_digest = H_INIT;
        compress_sha256_block(&mut final_digest, &self.final_block);
        final_digest
    }

    pub fn double_sha256(&mut self, midstate: &[u32; 8], nonce: u32) -> [u8; 32] {
        hash_words_to_bytes(&self.double_sha256_words(midstate, nonce))
    }
}

impl HashEngine for ReusableMidstateHasher {
    fn hash_words(&mut self, work: &HeaderWork, nonce: u32) -> [u32; 8] {
        self.double_sha256_words(&work.midstate, nonce)
    }
}

pub fn cpu_kernel_hash_words(
    mode: CpuKernelMode,
    header: &mut [u8],
    work: &HeaderWork,
    midstate_hasher: &mut ReusableMidstateHasher,
    nonce: u32,
) -> [u32; 8] {
    match mode {
        CpuKernelMode::Midstate => midstate_hasher.double_sha256_words(&work.midstate, nonce),
        CpuKernelMode::FullHeader => {
            header[76..80].copy_from_slice(&nonce.to_le_bytes());
            let hash = double_sha256(header);
            target_bytes_to_words(&hash)
        }
    }
}

pub fn hash_words_to_bytes(words: &[u32; 8]) -> [u8; 32] {
    let mut hash = [0u8; 32];
    for (index, word) in words.iter().enumerate() {
        hash[index * 4..index * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    hash
}

pub fn header_work_from_header(header: &[u8]) -> Result<HeaderWork, String> {
    if header.len() != 80 {
        return Err(format!(
            "midstate work requires an 80-byte block header, got {} bytes",
            header.len()
        ));
    }

    let first_block: [u8; 64] = header[0..64]
        .try_into()
        .map_err(|_| "validated block header is missing the first SHA-256 block".to_string())?;
    let midstate = sha256_midstate(&first_block);
    let tail = [
        u32::from_le_bytes(
            header[64..68]
                .try_into()
                .map_err(|_| "validated block header is missing tail word 0".to_string())?,
        ),
        u32::from_le_bytes(
            header[68..72]
                .try_into()
                .map_err(|_| "validated block header is missing tail word 1".to_string())?,
        ),
        u32::from_le_bytes(
            header[72..76]
                .try_into()
                .map_err(|_| "validated block header is missing tail word 2".to_string())?,
        ),
    ];

    Ok(HeaderWork { midstate, tail })
}

pub fn benchmark_header_hash_paths(
    header: &[u8],
    nonce_count: u32,
) -> Result<HeaderHashBenchmark, String> {
    if nonce_count == 0 {
        return Err("header hash benchmark requires at least one nonce".into());
    }
    if nonce_count > MAX_HEADER_HASH_BENCHMARK_NONCES {
        return Err(format!(
            "header hash benchmark is capped at {} nonces",
            MAX_HEADER_HASH_BENCHMARK_NONCES
        ));
    }

    let work = header_work_from_header(header)?;
    let equivalence_checksum = verify_header_hash_window(header, &work, nonce_count)?;

    let mut candidate = header.to_vec();
    let full_header_start = Instant::now();
    let mut full_header_checksum = 0_u64;
    for nonce in 0..nonce_count {
        candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
        full_header_checksum =
            mix_hash_checksum(full_header_checksum, nonce, &double_sha256(&candidate));
    }
    let full_header_elapsed = full_header_start.elapsed();

    let mut midstate_hasher = ReusableMidstateHasher::new(&work.tail);
    let midstate_start = Instant::now();
    let mut midstate_checksum = 0_u64;
    for nonce in 0..nonce_count {
        let hash_words = midstate_hasher.double_sha256_words(&work.midstate, nonce);
        let hash = hash_words_to_bytes(&hash_words);
        midstate_checksum = mix_hash_checksum(midstate_checksum, nonce, &hash);
    }
    let midstate_elapsed = midstate_start.elapsed();

    if full_header_checksum != equivalence_checksum || midstate_checksum != equivalence_checksum {
        return Err("header hash benchmark checksums diverged".into());
    }

    let full_header_hashrate = benchmark_hashrate(nonce_count, full_header_elapsed);
    let midstate_hashrate = benchmark_hashrate(nonce_count, midstate_elapsed);
    let speedup_ratio = if full_header_hashrate > 0.0 {
        midstate_hashrate / full_header_hashrate
    } else {
        0.0
    };

    Ok(HeaderHashBenchmark {
        nonce_count: nonce_count as u64,
        full_header_duration_micros: full_header_elapsed.as_micros(),
        midstate_duration_micros: midstate_elapsed.as_micros(),
        full_header_hashrate,
        midstate_hashrate,
        speedup_ratio,
        checksum: equivalence_checksum,
    })
}

fn verify_header_hash_window(
    header: &[u8],
    work: &HeaderWork,
    nonce_count: u32,
) -> Result<u64, String> {
    let mut candidate = header.to_vec();
    let mut midstate_hasher = ReusableMidstateHasher::new(&work.tail);
    let mut checksum = 0_u64;

    for nonce in 0..nonce_count {
        candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
        let full_hash = double_sha256(&candidate);
        let midstate_hash =
            hash_words_to_bytes(&midstate_hasher.double_sha256_words(&work.midstate, nonce));

        if full_hash != midstate_hash {
            return Err(format!("midstate hash mismatch at nonce {nonce}"));
        }

        checksum = mix_hash_checksum(checksum, nonce, &midstate_hash);
    }

    Ok(checksum)
}

fn mix_hash_checksum(current: u64, nonce: u32, hash: &[u8; 32]) -> u64 {
    let mut mixed = current.rotate_left(7) ^ nonce as u64;
    for chunk in hash.chunks_exact(8) {
        mixed ^= u64::from_be_bytes(chunk.try_into().unwrap());
        mixed = mixed.rotate_left(11).wrapping_mul(0x9E37_79B1_85EB_CA87);
    }
    mixed
}

fn benchmark_hashrate(nonce_count: u32, elapsed: Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if seconds > 0.0 {
        nonce_count as f64 / seconds
    } else {
        0.0
    }
}

pub fn double_sha256(value: &[u8]) -> [u8; 32] {
    let first_hash = Sha256::digest(value);
    Sha256::digest(first_hash).into()
}

pub fn difficulty_from_hash(hash: &[u8; 32]) -> f64 {
    let numeric_hash = hash
        .iter()
        .rev()
        .fold(0.0, |value, byte| value * 256.0 + f64::from(*byte));

    if numeric_hash == 0.0 {
        return DIFF_ONE_TARGET;
    }

    DIFF_ONE_TARGET / numeric_hash
}

pub fn target_from_nbits(nbits: &str) -> Result<[u8; 32], String> {
    let compact = decode_hex(nbits)?;
    if compact.len() != 4 {
        return Err("pool sent invalid compact target width".into());
    }

    if compact[1] & 0x80 != 0 {
        return Err("pool sent a negative compact target".into());
    }

    let exponent = compact[0] as usize;
    let mantissa = [compact[1], compact[2], compact[3]];
    let mut target = [0_u8; 32];

    if exponent == 0 {
        return Ok(target);
    }

    if exponent <= 3 {
        let shift = 8 * (3 - exponent);
        let value = u32::from_be_bytes([0, mantissa[0], mantissa[1], mantissa[2]]) >> shift;
        target[28..32].copy_from_slice(&value.to_be_bytes());
        return Ok(target);
    }

    if exponent > 32 {
        return Err("pool sent a compact target above uint256".into());
    }

    let start = 32 - exponent;
    target[start..start + 3].copy_from_slice(&mantissa);
    Ok(target)
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    hex::decode(value).map_err(|error| format!("pool sent invalid hex: {error}"))
}

pub fn hash_meets_network_target(hash: &[u8; 32], target: &[u8; 32]) -> bool {
    for (hash_byte, target_byte) in hash.iter().rev().zip(target.iter()) {
        if hash_byte < target_byte {
            return true;
        }

        if hash_byte > target_byte {
            return false;
        }
    }

    true
}

pub fn difficulty_to_target_words(difficulty: f64) -> [u32; 8] {
    if difficulty <= 0.0 || !difficulty.is_finite() {
        return [0xFFFFFFFF; 8];
    }

    let bits = difficulty.to_bits();
    let exponent_bits = ((bits >> 52) & 0x7ff) as i32;
    if exponent_bits == 0 {
        return [0xFFFFFFFF; 8];
    }

    let significand = (1_u64 << 52) | (bits & ((1_u64 << 52) - 1));
    let exponent = exponent_bits - 1023;
    let shift = 52 - exponent;
    let mut numerator = diff_one_target_le_words();

    if shift >= 0 {
        shift_left_le_words(&mut numerator, shift as usize);
    } else {
        shift_right_le_words(&mut numerator, (-shift) as usize);
    }

    let quotient = div_le_words_by_u64(&numerator, significand);
    le_words_to_target_words(&quotient)
}

fn diff_one_target_le_words() -> Vec<u32> {
    vec![0, 0, 0, 0, 0, 0, 0xFFFF0000]
}

fn trim_le_words(words: &mut Vec<u32>) {
    while words.len() > 1 && words.last() == Some(&0) {
        words.pop();
    }
}

fn shift_left_le_words(words: &mut Vec<u32>, bits: usize) {
    if bits == 0 || words.iter().all(|word| *word == 0) {
        return;
    }

    let word_shift = bits / 32;
    let bit_shift = bits % 32;
    if word_shift > 0 {
        words.splice(0..0, std::iter::repeat_n(0, word_shift));
    }

    if bit_shift > 0 {
        let mut carry = 0_u64;
        for word in words.iter_mut() {
            let value = ((*word as u64) << bit_shift) | carry;
            *word = value as u32;
            carry = value >> 32;
        }
        if carry != 0 {
            words.push(carry as u32);
        }
    }

    trim_le_words(words);
}

fn shift_right_le_words(words: &mut Vec<u32>, bits: usize) {
    if bits == 0 || words.iter().all(|word| *word == 0) {
        return;
    }

    let word_shift = bits / 32;
    if word_shift >= words.len() {
        words.clear();
        words.push(0);
        return;
    }

    if word_shift > 0 {
        words.drain(0..word_shift);
    }

    let bit_shift = bits % 32;
    if bit_shift > 0 {
        let mut carry = 0_u32;
        for index in (0..words.len()).rev() {
            let next_carry = words[index] << (32 - bit_shift);
            words[index] = (words[index] >> bit_shift) | carry;
            carry = next_carry;
        }
    }

    trim_le_words(words);
}

fn div_le_words_by_u64(words: &[u32], divisor: u64) -> Vec<u32> {
    debug_assert!(divisor >= (1_u64 << 52));
    let mut quotient = vec![0_u32; words.len()];
    let mut remainder = 0_u128;
    let divisor = divisor as u128;

    for index in (0..words.len()).rev() {
        let value = (remainder << 32) | words[index] as u128;
        quotient[index] = (value / divisor) as u32;
        remainder = value % divisor;
    }

    trim_le_words(&mut quotient);
    quotient
}

fn le_words_to_target_words(words: &[u32]) -> [u32; 8] {
    if words.len() > 8 && words[8..].iter().any(|word| *word != 0) {
        return [0xFFFFFFFF; 8];
    }

    let mut target = [0_u32; 8];
    for (index, word) in words.iter().take(8).enumerate() {
        target[7 - index] = *word;
    }
    target
}

pub fn target_bytes_to_words(target: &[u8; 32]) -> [u32; 8] {
    let mut words = [0u32; 8];
    for (index, chunk) in target.chunks_exact(4).enumerate() {
        words[index] = u32::from_be_bytes(chunk.try_into().unwrap());
    }
    words
}

pub fn hash_words_meet_target_words(hash_words: &[u32; 8], target_words: &[u32; 8]) -> bool {
    for i in 0..8 {
        let hash_word = hash_words[7 - i].swap_bytes();
        let target_word = target_words[i];

        if hash_word < target_word {
            return true;
        }

        if hash_word > target_word {
            return false;
        }
    }

    true
}

pub fn hash_words_meet_three_targets(
    hash_words: &[u32; 8],
    first_target: &[u32; 8],
    second_target: &[u32; 8],
    third_target: &[u32; 8],
) -> [bool; 3] {
    let targets = [first_target, second_target, third_target];
    let mut hits = [true; 3];
    let mut decided = [false; 3];

    for i in 0..8 {
        let hash_word = hash_words[7 - i].swap_bytes();
        for target_index in 0..3 {
            if decided[target_index] {
                continue;
            }

            let target_word = targets[target_index][i];
            if hash_word < target_word {
                hits[target_index] = true;
                decided[target_index] = true;
            } else if hash_word > target_word {
                hits[target_index] = false;
                decided[target_index] = true;
            }
        }

        if decided.iter().all(|value| *value) {
            break;
        }
    }

    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    const GENESIS_HEADER: &str = concat!(
        "01000000",
        "0000000000000000000000000000000000000000000000000000000000000000",
        "3ba3edfd7a7b12b27ac72c3e67768f617fc81bc3888a51323a9fb8aa4b1e5e4a",
        "29ab5f49",
        "ffff001d",
        "1dac2b7c",
    );

    fn decode_header(value: &str) -> [u8; 80] {
        hex::decode(value)
            .expect("test header must be valid hex")
            .try_into()
            .expect("test header must be 80 bytes")
    }

    fn block_hash_hex(hash: &[u8; 32]) -> String {
        hash.iter().rev().map(|byte| format!("{byte:02x}")).collect()
    }

    #[test]
    fn genesis_header_hash_matches_public_block_hash() {
        let header = decode_header(GENESIS_HEADER);
        let hash = double_sha256(&header);

        assert_eq!(
            block_hash_hex(&hash),
            "000000000019d6689c085ae165831e934ff763ae46a2a6c172b3f1b60a8ce26f"
        );
    }

    #[test]
    fn midstate_hash_matches_full_header_for_nonce_window() {
        let mut header = decode_header(GENESIS_HEADER);
        header[76..80].copy_from_slice(&0_u32.to_le_bytes());
        let work = header_work_from_header(&header).expect("genesis header should build work");
        let mut hasher = ReusableMidstateHasher::new(&work.tail);

        for nonce in 0..4096_u32 {
            header[76..80].copy_from_slice(&nonce.to_le_bytes());
            let midstate_hash = hasher.double_sha256(&work.midstate, nonce);
            let full_hash = double_sha256(&header);

            assert_eq!(midstate_hash, full_hash, "nonce {nonce}");
        }
    }

    #[test]
    fn midstate_hash_matches_full_header_for_mutated_headers() {
        let base_header = decode_header(GENESIS_HEADER);

        for case in 0..32_u8 {
            let mut header = base_header;
            header[(case as usize * 7) % 76] ^= case.wrapping_mul(17).wrapping_add(3);
            header[(case as usize * 11 + 5) % 76] =
                header[(case as usize * 11 + 5) % 76].wrapping_add(case ^ 0x5a);
            header[76..80].copy_from_slice(&0_u32.to_le_bytes());

            let work = header_work_from_header(&header).expect("mutated header should build work");
            let mut hasher = ReusableMidstateHasher::new(&work.tail);

            for nonce in [0, 1, 255, 1024, 65_535, 1_000_003, u32::MAX] {
                header[76..80].copy_from_slice(&nonce.to_le_bytes());
                let midstate_hash = hasher.double_sha256(&work.midstate, nonce);
                let full_hash = double_sha256(&header);

                assert_eq!(midstate_hash, full_hash, "case {case}, nonce {nonce}");
            }
        }
    }
}
