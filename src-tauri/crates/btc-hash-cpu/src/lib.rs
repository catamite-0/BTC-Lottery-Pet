use btc_hash_core::{HashEngine, HeaderWork};
use sha2::{compress256, Digest, Sha256};

pub const DIFF_ONE_TARGET: f64 =
    26_959_535_291_011_309_493_156_476_344_723_991_336_010_898_738_574_164_086_137_773_096_960.0;

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

pub fn double_sha256_from_midstate(midstate: &[u32; 8], tail: &[u32; 3], nonce: u32) -> [u8; 32] {
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
        let overflow_bytes = exponent - 32;
        let checked_prefix = overflow_bytes.min(mantissa.len());
        if mantissa[..checked_prefix].iter().any(|byte| *byte != 0) {
            return Err("pool sent a compact target above uint256".into());
        }

        if overflow_bytes >= mantissa.len() {
            return Ok(target);
        }

        let kept = &mantissa[overflow_bytes..];
        target[0..kept.len()].copy_from_slice(kept);
        return Ok(target);
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
        hash.iter()
            .rev()
            .map(|byte| format!("{byte:02x}"))
            .collect()
    }

    fn decode_32(value: &str) -> [u8; 32] {
        hex::decode(value)
            .expect("test value must be valid hex")
            .try_into()
            .expect("test value must be 32 bytes")
    }

    fn hash_bytes_from_display_hex(value: &str) -> [u8; 32] {
        let mut bytes = decode_32(value);
        bytes.reverse();
        bytes
    }

    fn target_words_hex(words: &[u32; 8]) -> String {
        words.iter().map(|word| format!("{word:08x}")).collect()
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

    #[test]
    fn compact_nbits_expands_consensus_targets() {
        assert_eq!(
            hex::encode(target_from_nbits("1d00ffff").unwrap()),
            "00000000ffff0000000000000000000000000000000000000000000000000000"
        );

        let mut exponent_three = [0_u8; 32];
        exponent_three[30] = 0xff;
        exponent_three[31] = 0xff;
        assert_eq!(target_from_nbits("0300ffff").unwrap(), exponent_three);

        let mut exponent_two = [0_u8; 32];
        exponent_two[31] = 0xff;
        assert_eq!(target_from_nbits("0200ffff").unwrap(), exponent_two);

        let mut exponent_thirty_three = [0_u8; 32];
        exponent_thirty_three[0] = 0x01;
        exponent_thirty_three[1] = 0x23;
        assert_eq!(
            target_from_nbits("21000123").unwrap(),
            exponent_thirty_three
        );

        let mut exponent_thirty_four = [0_u8; 32];
        exponent_thirty_four[0] = 0x01;
        assert_eq!(target_from_nbits("22000001").unwrap(), exponent_thirty_four);

        assert_eq!(target_from_nbits("23000000").unwrap(), [0_u8; 32]);
    }

    #[test]
    fn compact_nbits_rejects_negative_and_overflow_targets() {
        assert!(target_from_nbits("1d80ffff").is_err());
        assert!(target_from_nbits("21010000").is_err());
        assert!(target_from_nbits("22000100").is_err());
        assert!(target_from_nbits("not-hex").is_err());
        assert!(target_from_nbits("1d00ff").is_err());
    }

    #[test]
    fn difficulty_target_words_match_compact_diff_one() {
        let compact_target = target_from_nbits("1d00ffff").unwrap();
        let diff_one_target = difficulty_to_target_words(1.0);

        assert_eq!(diff_one_target, target_bytes_to_words(&compact_target));
        assert_eq!(
            target_words_hex(&diff_one_target),
            "00000000ffff0000000000000000000000000000000000000000000000000000"
        );

        assert_eq!(difficulty_to_target_words(0.0), [u32::MAX; 8]);
        assert_eq!(difficulty_to_target_words(f64::INFINITY), [u32::MAX; 8]);
        assert_eq!(difficulty_to_target_words(f64::NAN), [u32::MAX; 8]);
        assert_eq!(difficulty_to_target_words(1e-30), [u32::MAX; 8]);
    }

    #[test]
    fn difficulty_from_hash_reports_expected_diff_one_boundary() {
        let diff_one_hash = hash_bytes_from_display_hex(
            "00000000ffff0000000000000000000000000000000000000000000000000000",
        );
        let difficulty = difficulty_from_hash(&diff_one_hash);

        assert!((difficulty - 1.0).abs() < f64::EPSILON);
        assert_eq!(difficulty_from_hash(&[0; 32]), DIFF_ONE_TARGET);
    }

    #[test]
    fn word_target_comparison_matches_byte_target_comparison() {
        let target = target_from_nbits("1d00ffff").unwrap();
        let target_words = target_bytes_to_words(&target);
        let display_hashes = [
            "0000000000000000000000000000000000000000000000000000000000000000",
            "00000000fffeffff000000000000000000000000000000000000000000000000",
            "00000000ffff0000000000000000000000000000000000000000000000000000",
            "0000000100000000000000000000000000000000000000000000000000000000",
            "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        ];

        for display_hash in display_hashes {
            let hash = hash_bytes_from_display_hex(display_hash);
            let hash_words = target_bytes_to_words(&hash);

            assert_eq!(
                hash_words_meet_target_words(&hash_words, &target_words),
                hash_meets_network_target(&hash, &target),
                "{display_hash}"
            );
        }
    }

    #[test]
    fn three_target_word_comparison_matches_individual_checks() {
        let easy_target = difficulty_to_target_words(0.5);
        let diff_one_target = difficulty_to_target_words(1.0);
        let hard_target = difficulty_to_target_words(2.0);
        let hash = hash_bytes_from_display_hex(
            "00000000ffff0000000000000000000000000000000000000000000000000000",
        );
        let hash_words = target_bytes_to_words(&hash);

        assert_eq!(
            hash_words_meet_three_targets(
                &hash_words,
                &easy_target,
                &diff_one_target,
                &hard_target,
            ),
            [
                hash_words_meet_target_words(&hash_words, &easy_target),
                hash_words_meet_target_words(&hash_words, &diff_one_target),
                hash_words_meet_target_words(&hash_words, &hard_target),
            ]
        );
    }
}
