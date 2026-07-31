pub(crate) use btc_hash_core::HeaderWork;
pub(crate) use btc_hash_cpu::{difficulty_from_hash, double_sha256};
#[cfg(test)]
pub(crate) use btc_hash_cpu::{
    hash_meets_network_target, header_work_from_header, target_from_nbits, DIFF_ONE_TARGET,
};

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
