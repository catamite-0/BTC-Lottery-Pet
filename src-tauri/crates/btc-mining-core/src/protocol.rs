use std::{
    io::{self, BufRead, ErrorKind, Read, Write},
    net::TcpStream,
    sync::{atomic::Ordering, Arc},
};

use serde_json::Value;

use crate::{JobTemplate, PendingShareSubmissions, SharedMiningState};

pub const MAX_STRATUM_LINE_BYTES: usize = 64 * 1024;

const MAX_EXTRANONCE2_BYTES: usize = 16;
const MIN_SHARE_DIFFICULTY: f64 = 1e-9;

#[derive(Default)]
pub struct ProtocolState {
    pub extranonce1: Option<String>,
    pub extranonce2_size: Option<usize>,
    pub difficulty: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProtocolEvent {
    ConnectionStatusChanged { status: String, message: String },
    JobReceived { job_id: String, message: String },
    ShareAccepted { message: String },
    ShareRejected { message: String },
}

pub fn handle_server_message_with_logger(
    line: &str,
    protocol: &mut ProtocolState,
    shared: &Arc<SharedMiningState>,
    pending_submissions: &mut PendingShareSubmissions,
    mut log: impl FnMut(&str),
) -> Result<(), String> {
    handle_server_message_with_callbacks(
        line,
        protocol,
        shared,
        pending_submissions,
        |message| log(message),
        |_| {},
    )
}

pub fn handle_server_message_with_callbacks(
    line: &str,
    protocol: &mut ProtocolState,
    shared: &Arc<SharedMiningState>,
    pending_submissions: &mut PendingShareSubmissions,
    mut log: impl FnMut(&str),
    mut event: impl FnMut(ProtocolEvent),
) -> Result<(), String> {
    if line.is_empty() {
        return Ok(());
    }

    let message: Value =
        serde_json::from_str(line).map_err(|error| format!("invalid Stratum JSON: {error}"))?;

    if let Some(method) = message.get("method").and_then(Value::as_str) {
        match method {
            "mining.set_difficulty" => {
                let difficulty = message
                    .get("params")
                    .and_then(Value::as_array)
                    .and_then(|params| params.first())
                    .and_then(value_as_f64)
                    .ok_or_else(|| "pool sent an invalid share difficulty".to_string())?;
                protocol.difficulty = validate_share_difficulty(difficulty)?;
                log(&format!("Pool set share difficulty: {difficulty}"));
            }
            "mining.set_extranonce" => {
                let params = message
                    .get("params")
                    .and_then(Value::as_array)
                    .ok_or_else(|| "pool sent mining.set_extranonce without params".to_string())?;
                if params.len() < 2 {
                    return Err("pool sent an incomplete mining.set_extranonce".into());
                }
                protocol.extranonce1 = Some(required_hex_string(params, 0, "extranonce1", None)?);
                protocol.extranonce2_size = Some(
                    params[1]
                        .as_u64()
                        .ok_or_else(|| "pool sent invalid extranonce2 size".to_string())
                        .and_then(validate_extranonce2_size)?,
                );
                shared.clear_job();
            }
            "mining.notify" => {
                if let Some(job) = parse_job(message.get("params"), protocol)? {
                    let job_id = job.job_id.clone();
                    let diff = job.share_difficulty;
                    let clean_jobs = job.clean_jobs;
                    shared.set_job(job);
                    shared.set_connection_status("Mining");
                    let message = format!(
                        "Job received: id={}, diff={}, clean_jobs={}",
                        job_id, diff, clean_jobs
                    );
                    log(&message);
                    event(ProtocolEvent::JobReceived { job_id, message });
                }
            }
            _ => {}
        }

        return Ok(());
    }

    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return Ok(());
    };

    if id == 1 {
        let result = message
            .get("result")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                pool_response_error(&message)
                    .map(|reason| format!("pool rejected mining.subscribe: {reason}"))
                    .unwrap_or_else(|| "pool returned an invalid mining.subscribe response".into())
            })?;
        protocol.extranonce1 = result
            .get(1)
            .and_then(Value::as_str)
            .map(str::to_owned)
            .map(|extranonce1| {
                validate_hex_string(&extranonce1, "extranonce1", None).map(|_| extranonce1)
            })
            .transpose()?;
        protocol.extranonce2_size = result
            .get(2)
            .and_then(Value::as_u64)
            .map(validate_extranonce2_size)
            .transpose()?;

        if protocol.extranonce1.is_none() || protocol.extranonce2_size.is_none() {
            return Err("pool returned an incomplete mining.subscribe response".into());
        }

        shared.set_connection_status("Authorizing");
        event(ProtocolEvent::ConnectionStatusChanged {
            status: "Authorizing".into(),
            message: "Pool subscription accepted.".into(),
        });
    } else if id == 2 {
        if message.get("result").and_then(Value::as_bool) != Some(true) {
            let reason = pool_response_error(&message)
                .unwrap_or_else(|| "authorization returned false".into());
            return Err(format!("pool rejected mining.authorize: {reason}"));
        }

        shared.set_connection_status("Authorized");
        let message = "Worker authorized successfully".to_string();
        log(&message);
        event(ProtocolEvent::ConnectionStatusChanged {
            status: "Authorized".into(),
            message,
        });
    } else if let Some(submission) = pending_submissions.remove(id) {
        if message.get("result").and_then(Value::as_bool) == Some(true) {
            shared.accepted_shares.fetch_add(1, Ordering::Relaxed);
            let message = format!(
                "Share accepted: job_id={}, nonce={:08x}",
                submission.share.job_id, submission.share.nonce
            );
            log(&message);
            event(ProtocolEvent::ShareAccepted { message });
        } else {
            shared.rejected_shares.fetch_add(1, Ordering::Relaxed);
            let err_str = message
                .get("error")
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string());
            let message = format!(
                "Share rejected: job_id={}, nonce={:08x}. Reason: {}",
                submission.share.job_id, submission.share.nonce, err_str
            );
            log(&message);
            event(ProtocolEvent::ShareRejected { message });
        }
    }

    Ok(())
}

pub fn pool_response_error(message: &Value) -> Option<String> {
    if let Some(error) = message.get("error") {
        if !error.is_null() {
            return Some(error.to_string());
        }
    }

    message
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(str::to_owned)
}

fn parse_job(
    params: Option<&Value>,
    protocol: &ProtocolState,
) -> Result<Option<JobTemplate>, String> {
    let Some(params) = params.and_then(Value::as_array) else {
        return Err("pool sent mining.notify without params".into());
    };

    if params.len() < 9 {
        return Err("pool sent an incomplete mining.notify job".into());
    }

    let Some(extranonce1) = protocol.extranonce1.clone() else {
        return Ok(None);
    };
    let Some(extranonce2_size) = protocol.extranonce2_size else {
        return Ok(None);
    };

    let merkle_branches = params[4]
        .as_array()
        .ok_or_else(|| "pool sent invalid merkle branches".to_string())?
        .iter()
        .map(|branch| {
            let branch = branch
                .as_str()
                .ok_or_else(|| "pool sent a non-string merkle branch".to_string())?;
            validate_hex_string(branch, "merkle branch", Some(32))?;
            Ok::<String, String>(branch.to_owned())
        })
        .collect::<Result<Vec<_>, _>>()?;

    if merkle_branches.len() > 64 {
        return Err("pool sent too many merkle branches".into());
    }

    let nbits = required_hex_string(params, 6, "nbits", Some(4))?;
    let network_target = btc_hash_cpu::target_from_nbits(&nbits)?;
    let clean_jobs = params[8]
        .as_bool()
        .ok_or_else(|| "pool sent an invalid clean_jobs flag".to_string())?;

    Ok(Some(JobTemplate {
        generation: 0,
        clean_jobs,
        job_id: required_string(params, 0, "job id")?,
        prev_hash: required_hex_string(params, 1, "previous hash", Some(32))?,
        coinbase1: required_hex_string(params, 2, "coinbase prefix", None)?,
        coinbase2: required_hex_string(params, 3, "coinbase suffix", None)?,
        merkle_branches,
        version: required_hex_string(params, 5, "version", Some(4))?,
        nbits,
        network_target,
        ntime: required_hex_string(params, 7, "ntime", Some(4))?,
        extranonce1,
        extranonce2_size,
        share_difficulty: validate_share_difficulty(protocol.difficulty)?,
    }))
}

pub fn read_stratum_line(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut line = String::new();
    let bytes_read = reader
        .take((MAX_STRATUM_LINE_BYTES + 1) as u64)
        .read_line(&mut line)?;

    if bytes_read == 0 {
        return Ok(None);
    }

    if line.len() > MAX_STRATUM_LINE_BYTES {
        let mut discard = Vec::new();
        let _ = reader.read_until(b'\n', &mut discard);
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "pool sent an oversized Stratum message",
        ));
    }

    Ok(Some(line))
}

fn required_string(params: &[Value], index: usize, label: &str) -> Result<String, String> {
    params[index]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("pool sent invalid {label}"))
}

fn required_hex_string(
    params: &[Value],
    index: usize,
    label: &str,
    expected_bytes: Option<usize>,
) -> Result<String, String> {
    let value = required_string(params, index, label)?;
    validate_hex_string(&value, label, expected_bytes)?;
    Ok(value)
}

fn validate_hex_string(
    value: &str,
    label: &str,
    expected_bytes: Option<usize>,
) -> Result<(), String> {
    if !value.len().is_multiple_of(2) || !value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err(format!("pool sent invalid {label} hex"));
    }

    if let Some(expected_bytes) = expected_bytes {
        let actual_bytes = value.len() / 2;
        if actual_bytes != expected_bytes {
            return Err(format!(
                "pool sent {label} as {actual_bytes} bytes, expected {expected_bytes}"
            ));
        }
    }

    Ok(())
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|number| number.parse().ok()))
}

pub fn validate_share_difficulty(difficulty: f64) -> Result<f64, String> {
    if !difficulty.is_finite() || difficulty < MIN_SHARE_DIFFICULTY {
        return Err("pool sent an unsupported share difficulty".into());
    }

    Ok(difficulty)
}

fn validate_extranonce2_size(size: u64) -> Result<usize, String> {
    let size = usize::try_from(size)
        .map_err(|_| "pool sent an unsupported extranonce2 size".to_string())?;
    if size == 0 || size > MAX_EXTRANONCE2_BYTES {
        return Err(format!(
            "pool sent an unsupported extranonce2 size of {size} bytes"
        ));
    }

    Ok(size)
}

pub fn write_message(stream: &mut TcpStream, message: &Value) -> Result<(), String> {
    let mut payload = serde_json::to_vec(message)
        .map_err(|error| format!("failed to encode Stratum JSON: {error}"))?;
    payload.push(b'\n');
    stream
        .write_all(&payload)
        .map_err(|error| format!("socket write failed: {error}"))
}

#[cfg(test)]
mod robustness_tests {
    //! Fuzz-style negative tests for the Stratum message parser.
    //!
    //! The pool is untrusted input. These sweeps feed the parser large volumes
    //! of random and mutated bytes and assert it only ever returns `Ok`/`Err` —
    //! never panics, slices out of bounds, overflows, or hangs. A panic here
    //! would take down a mining worker thread. They are deterministic (seeded)
    //! and dependency-free so they run in the normal `cargo test` suite.

    use std::{
        io::{BufReader, Cursor},
        sync::{atomic::AtomicBool, Arc},
    };

    use super::{
        handle_server_message_with_callbacks, read_stratum_line, ProtocolState,
        MAX_STRATUM_LINE_BYTES,
    };
    use crate::{PendingShareSubmissions, SharedMiningState};

    /// Small xorshift64* PRNG so the sweep is reproducible without a crate.
    struct Rng(u64);

    impl Rng {
        fn next_u64(&mut self) -> u64 {
            let mut x = self.0;
            x ^= x >> 12;
            x ^= x << 25;
            x ^= x >> 27;
            self.0 = x;
            x.wrapping_mul(0x2545_F491_4F6C_DD1D)
        }

        fn byte(&mut self) -> u8 {
            (self.next_u64() >> 33) as u8
        }

        fn below(&mut self, bound: usize) -> usize {
            if bound == 0 {
                0
            } else {
                (self.next_u64() % bound as u64) as usize
            }
        }
    }

    fn drive_message(line: &str) {
        let mut protocol = ProtocolState {
            extranonce1: Some("abcd".into()),
            extranonce2_size: Some(4),
            difficulty: 0.001,
        };
        let shared = Arc::new(SharedMiningState::new(Arc::new(AtomicBool::new(false))));
        let mut pending = PendingShareSubmissions::default();
        // Only outcome that matters: this returns without panicking.
        let _ = handle_server_message_with_callbacks(
            line.trim(),
            &mut protocol,
            &shared,
            &mut pending,
            |_| {},
            |_| {},
        );
    }

    const VALID_STRATUM_LINES: &[&str] = &[
        r#"{"id":1,"result":[null,"abcd",4],"error":null}"#,
        r#"{"id":2,"result":true,"error":null}"#,
        r#"{"id":11,"result":true,"error":null}"#,
        r#"{"id":12,"result":false,"error":["low difficulty share",23,null]}"#,
        r#"{"method":"mining.set_difficulty","params":[0.001]}"#,
        r#"{"method":"mining.set_extranonce","params":["abcd",4]}"#,
        r#"{"method":"mining.notify","params":["job1","0000000000000000000000000000000000000000000000000000000000000000","01000000","ffffffff",[],"20000000","1d00ffff","5f5e1000",true]}"#,
    ];

    #[test]
    fn parser_never_panics_on_random_or_mutated_input() {
        let mut rng = Rng(0x1234_5678_9abc_def0);

        // Fully random byte lines.
        for _ in 0..20_000 {
            let len = rng.below(300);
            let bytes: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
            drive_message(&String::from_utf8_lossy(&bytes));
        }

        // Byte-level mutations of otherwise-valid messages stay close to the real
        // protocol, so they reach the deep parse_job / nbits / hex paths.
        for seed in VALID_STRATUM_LINES {
            for _ in 0..4_000 {
                let mut bytes = seed.as_bytes().to_vec();
                let mutations = 1 + rng.below(6);
                for _ in 0..mutations {
                    if bytes.is_empty() {
                        break;
                    }
                    match rng.below(3) {
                        0 => {
                            let pos = rng.below(bytes.len());
                            bytes[pos] = rng.byte();
                        }
                        1 => {
                            let pos = rng.below(bytes.len());
                            bytes.remove(pos);
                        }
                        _ => {
                            let pos = rng.below(bytes.len() + 1);
                            bytes.insert(pos, rng.byte());
                        }
                    }
                }
                drive_message(&String::from_utf8_lossy(&bytes));
            }
        }
    }

    #[test]
    fn read_stratum_line_never_panics_on_random_bytes() {
        let mut rng = Rng(0xdead_beef_cafe_babe);

        for _ in 0..5_000 {
            let len = rng.below(2048);
            let bytes: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
            let mut reader = BufReader::new(Cursor::new(bytes));
            let _ = read_stratum_line(&mut reader);
        }

        // An oversized line with no newline must be rejected, not buffered without
        // bound.
        let oversized = vec![b'a'; MAX_STRATUM_LINE_BYTES + 16];
        let mut reader = BufReader::new(Cursor::new(oversized));
        assert!(read_stratum_line(&mut reader).is_err());
    }
}
