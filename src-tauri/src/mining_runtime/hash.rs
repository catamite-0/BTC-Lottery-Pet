pub(crate) use btc_hash_core::HeaderWork;
pub(crate) use btc_hash_cpu::{difficulty_from_hash, double_sha256};

use crate::mining_settings::{CandidateSubmissionStatus, FoundBlockEvent};
use crate::mining_state::JobTemplate;

fn build_merkle_root(job: &JobTemplate, extranonce2: &str) -> Result<[u8; 32], String> {
    let mut coinbase = decode_hex(&job.coinbase1)?;
    coinbase.extend(decode_hex(&job.extranonce1)?);
    coinbase.extend(decode_hex(extranonce2)?);
    coinbase.extend(decode_hex(&job.coinbase2)?);

    let mut merkle_root = double_sha256(&coinbase);
    for branch in &job.merkle_branches {
        let branch = decode_hex(branch)?;
        let mut material = Vec::with_capacity(merkle_root.len() + branch.len());
        material.extend_from_slice(&merkle_root);
        material.extend(branch);
        merkle_root = double_sha256(&material);
    }

    Ok(merkle_root)
}

fn reversed_header_word(value: &str, field: &str) -> Result<[u8; 4], String> {
    let bytes = reversed_hex(value)?;
    bytes
        .try_into()
        .map_err(|bytes: Vec<u8>| format!("pool sent {field} as {} bytes, expected 4", bytes.len()))
}

#[cfg(test)]
pub(crate) fn build_header(job: &JobTemplate, extranonce2: &str) -> Result<Vec<u8>, String> {
    let merkle_root = build_merkle_root(job, extranonce2)?;
    let version = reversed_header_word(&job.version, "version")?;
    let prev_hash = word_swapped_hex(&job.prev_hash)?;
    if prev_hash.len() != 32 {
        return Err(format!(
            "pool sent previous hash as {} bytes, expected 32",
            prev_hash.len()
        ));
    }
    let ntime = reversed_header_word(&job.ntime, "ntime")?;
    let nbits = reversed_header_word(&job.nbits, "nbits")?;

    let mut header = Vec::with_capacity(80);
    header.extend_from_slice(&version);
    header.extend_from_slice(&prev_hash);
    header.extend_from_slice(&merkle_root);
    header.extend_from_slice(&ntime);
    header.extend_from_slice(&nbits);
    header.extend([0_u8; 4]);

    if header.len() != 80 {
        return Err(format!(
            "pool produced an invalid {}-byte block header",
            header.len()
        ));
    }

    Ok(header)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HeaderWorkTemplate {
    midstate: [u32; 8],
    merkle_tail: [u8; 4],
    nbits: [u8; 4],
}

impl HeaderWorkTemplate {
    pub(crate) fn work_for_ntime(&self, ntime: &str) -> Result<HeaderWork, String> {
        let ntime = reversed_header_word(ntime, "ntime")?;
        Ok(HeaderWork {
            midstate: self.midstate,
            tail: [
                u32::from_le_bytes(self.merkle_tail),
                u32::from_le_bytes(ntime),
                u32::from_le_bytes(self.nbits),
            ],
        })
    }
}

pub(crate) fn build_header_work_template(
    job: &JobTemplate,
    extranonce2: &str,
) -> Result<HeaderWorkTemplate, String> {
    let merkle_root = build_merkle_root(job, extranonce2)?;
    let version = reversed_header_word(&job.version, "version")?;
    let prev_hash = word_swapped_hex(&job.prev_hash)?;
    if prev_hash.len() != 32 {
        return Err(format!(
            "pool sent previous hash as {} bytes, expected 32",
            prev_hash.len()
        ));
    }

    let mut first_block = [0_u8; 64];
    first_block[0..4].copy_from_slice(&version);
    first_block[4..36].copy_from_slice(&prev_hash);
    first_block[36..64].copy_from_slice(&merkle_root[0..28]);

    let merkle_tail: [u8; 4] = merkle_root[28..32]
        .try_into()
        .map_err(|_| "validated merkle root is missing tail bytes".to_string())?;
    let nbits = reversed_header_word(&job.nbits, "nbits")?;

    Ok(HeaderWorkTemplate {
        midstate: crate::mining_kernel::sha256_midstate(&first_block),
        merkle_tail,
        nbits,
    })
}

pub(crate) fn build_header_work(
    job: &JobTemplate,
    extranonce2: &str,
) -> Result<HeaderWork, String> {
    build_header_work_template(job, extranonce2)?.work_for_ntime(&job.ntime)
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    hex::decode(value).map_err(|error| format!("pool sent invalid hex: {error}"))
}

fn reversed_hex(value: &str) -> Result<Vec<u8>, String> {
    let mut bytes = decode_hex(value)?;
    bytes.reverse();
    Ok(bytes)
}

pub(crate) fn word_swapped_hex(value: &str) -> Result<Vec<u8>, String> {
    let mut bytes = decode_hex(value)?;

    if bytes.len() % 4 != 0 {
        return Err("pool sent a previous hash that is not word-aligned".into());
    }

    for word in bytes.chunks_exact_mut(4) {
        word.reverse();
    }

    Ok(bytes)
}

pub(crate) fn extranonce2_hex(counter: u64, size: usize) -> String {
    let mut bytes = vec![0_u8; size];
    let source = counter.to_be_bytes();
    let copied_bytes = size.min(source.len());
    bytes[size - copied_bytes..].copy_from_slice(&source[source.len() - copied_bytes..]);
    hex::encode(bytes)
}

fn block_hash_hex(hash: &[u8; 32]) -> String {
    let bytes = hash.iter().rev().copied().collect::<Vec<_>>();
    hex::encode(bytes)
}

pub(crate) fn found_block_event(
    job: &JobTemplate,
    nonce: u32,
    extranonce2: &str,
    hash: &[u8; 32],
    difficulty: f64,
    pool: &str,
) -> FoundBlockEvent {
    FoundBlockEvent {
        job_id: job.job_id.clone(),
        nonce: format!("{nonce:08x}"),
        ntime: job.ntime.clone(),
        extranonce2: extranonce2.to_owned(),
        hash: block_hash_hex(hash),
        difficulty,
        timestamp: chrono::Utc::now().to_rfc3339(),
        submission_status: CandidateSubmissionStatus::Unknown,
        submission_message: None,
        pool: pool.to_owned(),
        record_saved: false,
        record_file: None,
    }
}

#[cfg(test)]
mod tests {
    use crate::mining_state::JobTemplate;
    use btc_hash_cpu::{
        difficulty_from_hash, hash_meets_network_target, header_work_from_header, target_from_nbits,
    };

    use super::{
        build_header, build_header_work, build_header_work_template, double_sha256,
        extranonce2_hex, found_block_event, word_swapped_hex,
    };

    #[test]
    fn formats_extranonce2_to_pool_width() {
        assert_eq!(extranonce2_hex(1, 4), "00000001");
        assert_eq!(extranonce2_hex(0x1234, 2), "1234");
    }

    #[test]
    fn swaps_previous_hash_words_like_nerdminer() {
        assert_eq!(
            word_swapped_hex("11223344aabbccdd").unwrap(),
            vec![0x44, 0x33, 0x22, 0x11, 0xdd, 0xcc, 0xbb, 0xaa]
        );
    }

    #[test]
    fn zero_hash_has_maximum_reported_difficulty() {
        assert!(difficulty_from_hash(&[0; 32]).is_finite());
    }

    #[test]
    fn expands_compact_nbits_to_network_target() {
        let target = target_from_nbits("1d00ffff").unwrap();

        assert_eq!(
            hex::encode(target),
            "00000000ffff0000000000000000000000000000000000000000000000000000"
        );
    }

    #[test]
    fn compares_hashes_against_network_target() {
        let target = target_from_nbits("1d00ffff").unwrap();

        assert!(hash_meets_network_target(&[0; 32], &target));
        assert!(!hash_meets_network_target(&[0xff; 32], &target));
    }

    #[test]
    fn header_work_midstate_matches_full_header_hashing() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-midstate".into(),
            prev_hash: "00".repeat(32),
            coinbase1: "01000000".into(),
            coinbase2: "ffffffff".into(),
            merkle_branches: vec!["11".repeat(32), "22".repeat(32)],
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };
        let extranonce2 = extranonce2_hex(1, job.extranonce2_size);
        let header = build_header(&job, &extranonce2).unwrap();
        let work = build_header_work(&job, &extranonce2).unwrap();

        assert_eq!(header.len(), 80);
        assert_eq!(
            work.tail[0],
            u32::from_le_bytes(header[64..68].try_into().unwrap())
        );
        assert_eq!(
            work.tail[1],
            u32::from_le_bytes(header[68..72].try_into().unwrap())
        );
        assert_eq!(
            work.tail[2],
            u32::from_le_bytes(header[72..76].try_into().unwrap())
        );

        for nonce in [0, 1, 0x1234abcd, u32::MAX] {
            let mut candidate = header.clone();
            candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
            assert_eq!(
                crate::mining_kernel::double_sha256_from_midstate(
                    &work.midstate,
                    &work.tail,
                    nonce
                ),
                double_sha256(&candidate),
            );
        }
    }

    #[test]
    fn header_work_template_reuses_midstate_when_only_ntime_changes() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-midstate-template".into(),
            prev_hash: "00".repeat(32),
            coinbase1: "01000000".into(),
            coinbase2: "ffffffff".into(),
            merkle_branches: vec!["11".repeat(32), "22".repeat(32)],
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };
        let extranonce2 = extranonce2_hex(1, job.extranonce2_size);
        let template = build_header_work_template(&job, &extranonce2).unwrap();
        let first_work = template.work_for_ntime(&job.ntime).unwrap();

        let mut next_job = job.clone();
        next_job.ntime = "5f5e1010".into();
        let next_work = template.work_for_ntime(&next_job.ntime).unwrap();
        let rebuilt_next_work = build_header_work(&next_job, &extranonce2).unwrap();

        assert_eq!(first_work.midstate, next_work.midstate);
        assert_ne!(first_work.tail[1], next_work.tail[1]);
        assert_eq!(next_work, rebuilt_next_work);

        let next_header = build_header(&next_job, &extranonce2).unwrap();
        for nonce in [0, 1, 0x1234abcd, u32::MAX] {
            let mut candidate = next_header.clone();
            candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
            assert_eq!(
                crate::mining_kernel::double_sha256_from_midstate(
                    &next_work.midstate,
                    &next_work.tail,
                    nonce,
                ),
                double_sha256(&candidate),
            );
        }
    }

    #[test]
    fn header_work_rejects_invalid_header_width() {
        let error = header_work_from_header(&[0; 79]).unwrap_err();
        assert!(error.contains("80-byte block header"));
    }

    #[test]
    fn found_block_event_uses_pool_metadata_without_address() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-7".into(),
            prev_hash: String::new(),
            coinbase1: String::new(),
            coinbase2: String::new(),
            merkle_branches: Vec::new(),
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };

        let event = found_block_event(
            &job,
            0x1234abcd,
            "00000001",
            &[0; 32],
            42.0,
            "public-pool.io:3333",
        );
        let serialized = serde_json::to_string(&event).unwrap();

        assert_eq!(event.job_id, "job-7");
        assert_eq!(event.nonce, "1234abcd");
        assert!(serialized.contains("public-pool.io:3333"));
        assert!(!serialized.contains("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"));
    }
}
