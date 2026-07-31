use std::{
    io::{self, ErrorKind, Read, Write},
    net::TcpStream,
    sync::{atomic::Ordering, Arc},
    time::{Duration, Instant},
};

use serde_json::Value;

use crate::{JobTemplate, PendingShareSubmissions, SharedMiningState};

pub const MAX_STRATUM_LINE_BYTES: usize = 64 * 1024;
pub const STRATUM_LINE_DEADLINE: Duration = Duration::from_secs(5);
const STRATUM_READ_CHUNK_BYTES: usize = 8 * 1024;

const MAX_EXTRANONCE2_BYTES: usize = 16;
const MIN_SHARE_DIFFICULTY: f64 = 1e-4;
const MAX_JOB_ID_BYTES: usize = 256;
const BITCOIN_MAINNET_POW_LIMIT: [u8; 32] = [
    0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
];

#[derive(Default)]
pub struct ProtocolState {
    pub extranonce1: Option<String>,
    pub extranonce2_size: Option<usize>,
    pub difficulty: f64,
    pub subscribed: bool,
    pub authorized: bool,
}

impl ProtocolState {
    pub fn handshake_complete(&self) -> bool {
        self.subscribed && self.authorized
    }

    pub fn is_ready(&self) -> bool {
        self.handshake_complete() && self.extranonce1.is_some() && self.extranonce2_size.is_some()
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum ProtocolEvent {
    ConnectionStatusChanged { status: String, message: String },
    JobReceived { job_id: String, message: String },
    ShareAccepted { request_id: u64, message: String },
    ShareRejected { request_id: u64, message: String },
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
                let job = parse_job(message.get("params"), protocol)?;
                if !protocol.is_ready() {
                    return Err(format!(
                        "pool sent mining.notify before the Stratum handshake completed (subscribed={}, authorized={})",
                        protocol.subscribed, protocol.authorized
                    ));
                }

                if let Some(job) = job {
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

        let was_ready = protocol.is_ready();
        let subscription_was_accepted = protocol.subscribed;
        protocol.subscribed = true;
        if !was_ready && protocol.is_ready() {
            mark_handshake_ready(shared, &mut log, &mut event);
        } else if !protocol.authorized && !subscription_was_accepted {
            shared.set_connection_status("Authorizing");
            event(ProtocolEvent::ConnectionStatusChanged {
                status: "Authorizing".into(),
                message: "Pool subscription accepted.".into(),
            });
        }
    } else if id == 2 {
        if message.get("result").and_then(Value::as_bool) != Some(true) {
            let reason = pool_response_error(&message)
                .unwrap_or_else(|| "authorization returned false".into());
            return Err(format!("pool rejected mining.authorize: {reason}"));
        }

        let was_ready = protocol.is_ready();
        let authorization_was_accepted = protocol.authorized;
        protocol.authorized = true;
        if !was_ready && protocol.is_ready() {
            mark_handshake_ready(shared, &mut log, &mut event);
        } else if !protocol.subscribed && !authorization_was_accepted {
            shared.set_connection_status("Subscribing");
            let message = "Worker authorization accepted; waiting for pool subscription.";
            log(message);
            event(ProtocolEvent::ConnectionStatusChanged {
                status: "Subscribing".into(),
                message: message.into(),
            });
        }
    } else if let Some(submission) = pending_submissions.remove(id) {
        if message.get("result").and_then(Value::as_bool) == Some(true) {
            shared.accepted_shares.fetch_add(1, Ordering::Relaxed);
            let message = format!(
                "Share accepted: job_id={}, nonce={:08x}",
                submission.share.job_id, submission.share.nonce
            );
            log(&message);
            event(ProtocolEvent::ShareAccepted {
                request_id: id,
                message,
            });
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
            event(ProtocolEvent::ShareRejected {
                request_id: id,
                message,
            });
        }
    }

    Ok(())
}

fn mark_handshake_ready(
    shared: &SharedMiningState,
    log: &mut impl FnMut(&str),
    event: &mut impl FnMut(ProtocolEvent),
) {
    shared.set_connection_status("Authorized");
    let message = "Worker authorized successfully".to_string();
    log(&message);
    event(ProtocolEvent::ConnectionStatusChanged {
        status: "Authorized".into(),
        message,
    });
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
    let network_target = mainnet_network_target_from_nbits(&nbits)?;
    let clean_jobs = params[8]
        .as_bool()
        .ok_or_else(|| "pool sent an invalid clean_jobs flag".to_string())?;

    Ok(Some(JobTemplate {
        generation: 0,
        clean_jobs,
        job_id: required_bounded_string(params, 0, "job id", MAX_JOB_ID_BYTES)?,
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

#[derive(Debug, PartialEq, Eq)]
pub enum StratumLineRead {
    Pending,
    Line(String),
    Closed,
}

#[derive(Default)]
pub struct StratumLineReader {
    buffer: Vec<u8>,
    message_started_at: Option<Instant>,
}

impl StratumLineReader {
    pub fn read_from(&mut self, reader: &mut impl Read) -> io::Result<StratumLineRead> {
        self.read_from_at(reader, Instant::now())
    }

    fn read_from_at(
        &mut self,
        reader: &mut impl Read,
        now: Instant,
    ) -> io::Result<StratumLineRead> {
        if let Some(line) = self.take_complete_line(now)? {
            return Ok(StratumLineRead::Line(line));
        }

        if self.buffer.len() > MAX_STRATUM_LINE_BYTES {
            return self.invalid_data("pool sent an oversized Stratum message");
        }

        if self
            .message_started_at
            .is_some_and(|started| now.saturating_duration_since(started) >= STRATUM_LINE_DEADLINE)
        {
            return self.invalid_data("pool took too long to finish a Stratum message");
        }

        let remaining_budget = MAX_STRATUM_LINE_BYTES + 1 - self.buffer.len();
        let mut chunk = [0_u8; STRATUM_READ_CHUNK_BYTES];
        let read_len = remaining_budget.min(chunk.len());
        let bytes_read = reader.read(&mut chunk[..read_len])?;

        if bytes_read == 0 {
            if self.buffer.is_empty() {
                return Ok(StratumLineRead::Closed);
            }

            let line_bytes = std::mem::take(&mut self.buffer);
            self.message_started_at = None;
            return String::from_utf8(line_bytes)
                .map(StratumLineRead::Line)
                .map_err(|_| {
                    io::Error::new(
                        ErrorKind::InvalidData,
                        "pool sent a non-UTF-8 Stratum message",
                    )
                });
        }

        if self.buffer.is_empty() {
            self.message_started_at = Some(now);
        }
        self.buffer.extend_from_slice(&chunk[..bytes_read]);

        if let Some(line) = self.take_complete_line(now)? {
            return Ok(StratumLineRead::Line(line));
        }

        if self.buffer.len() > MAX_STRATUM_LINE_BYTES {
            return self.invalid_data("pool sent an oversized Stratum message");
        }

        Ok(StratumLineRead::Pending)
    }

    fn take_complete_line(&mut self, now: Instant) -> io::Result<Option<String>> {
        let Some(newline_index) = self.buffer.iter().position(|byte| *byte == b'\n') else {
            return Ok(None);
        };
        let line_len = newline_index + 1;
        if line_len > MAX_STRATUM_LINE_BYTES {
            return self.invalid_data("pool sent an oversized Stratum message");
        }

        let remainder = self.buffer.split_off(line_len);
        let line_bytes = std::mem::replace(&mut self.buffer, remainder);
        self.message_started_at = if self.buffer.is_empty() {
            None
        } else {
            Some(now)
        };

        match String::from_utf8(line_bytes) {
            Ok(line) => Ok(Some(line)),
            Err(_) => self.invalid_data("pool sent a non-UTF-8 Stratum message"),
        }
    }

    fn invalid_data<T>(&mut self, message: &'static str) -> io::Result<T> {
        self.buffer.clear();
        self.message_started_at = None;
        Err(io::Error::new(ErrorKind::InvalidData, message))
    }
}

fn required_string(params: &[Value], index: usize, label: &str) -> Result<String, String> {
    params[index]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("pool sent invalid {label}"))
}
fn required_bounded_string(
    params: &[Value],
    index: usize,
    label: &str,
    max_bytes: usize,
) -> Result<String, String> {
    let value = required_string(params, index, label)?;
    if value.len() > max_bytes {
        return Err(format!("pool sent {label} longer than {max_bytes} bytes"));
    }

    Ok(value)
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

fn mainnet_network_target_from_nbits(nbits: &str) -> Result<[u8; 32], String> {
    let target = btc_hash_cpu::target_from_nbits(nbits)?;
    if target.iter().all(|byte| *byte == 0) {
        return Err("pool sent a zero network target".into());
    }

    if target > BITCOIN_MAINNET_POW_LIMIT {
        return Err("pool sent a target above the Bitcoin mainnet proof-of-work limit".into());
    }

    Ok(target)
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
        io::{self, Cursor, ErrorKind, Read},
        sync::{atomic::AtomicBool, Arc},
        time::Instant,
    };

    use super::{
        handle_server_message_with_callbacks, ProtocolState, StratumLineRead, StratumLineReader,
        MAX_STRATUM_LINE_BYTES, STRATUM_LINE_DEADLINE,
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
            subscribed: true,
            authorized: true,
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

    struct IntermittentReader {
        bytes: Vec<u8>,
        offset: usize,
        chunk_size: usize,
        timeout_next: bool,
    }

    impl IntermittentReader {
        fn new(bytes: Vec<u8>, chunk_size: usize) -> Self {
            Self {
                bytes,
                offset: 0,
                chunk_size,
                timeout_next: false,
            }
        }
    }

    impl Read for IntermittentReader {
        fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
            if self.timeout_next {
                self.timeout_next = false;
                return Err(io::Error::new(ErrorKind::TimedOut, "scripted timeout"));
            }
            if self.offset >= self.bytes.len() {
                return Ok(0);
            }

            let len = self
                .chunk_size
                .min(output.len())
                .min(self.bytes.len() - self.offset);
            output[..len].copy_from_slice(&self.bytes[self.offset..self.offset + len]);
            self.offset += len;
            self.timeout_next = true;
            Ok(len)
        }
    }

    fn read_until_terminal(
        reader: &mut impl Read,
        line_reader: &mut StratumLineReader,
    ) -> io::Result<StratumLineRead> {
        loop {
            match line_reader.read_from(reader)? {
                StratumLineRead::Pending => {}
                result => return Ok(result),
            }
        }
    }

    #[test]
    fn stratum_line_reader_never_panics_on_random_bytes() {
        let mut rng = Rng(0xdead_beef_cafe_babe);

        for _ in 0..5_000 {
            let len = rng.below(2048);
            let bytes: Vec<u8> = (0..len).map(|_| rng.byte()).collect();
            let mut reader = Cursor::new(bytes);
            let mut line_reader = StratumLineReader::default();
            let _ = read_until_terminal(&mut reader, &mut line_reader);
        }

        let oversized = vec![b'a'; MAX_STRATUM_LINE_BYTES + 16];
        let mut reader = Cursor::new(oversized);
        let mut line_reader = StratumLineReader::default();
        assert!(read_until_terminal(&mut reader, &mut line_reader).is_err());
    }

    #[test]
    fn oversized_line_stops_after_a_fixed_read_budget() {
        let input = vec![b'a'; MAX_STRATUM_LINE_BYTES + 1024];
        let mut reader = Cursor::new(input);
        let mut line_reader = StratumLineReader::default();

        let error = read_until_terminal(&mut reader, &mut line_reader).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert_eq!(reader.position(), (MAX_STRATUM_LINE_BYTES + 1) as u64);
    }

    #[test]
    fn max_plus_one_newline_rejects_only_the_oversized_message() {
        let mut input = vec![b'a'; MAX_STRATUM_LINE_BYTES];
        input.extend_from_slice(b"\n{\"id\":7}\n");
        let mut reader = Cursor::new(input);
        let mut line_reader = StratumLineReader::default();

        let error = read_until_terminal(&mut reader, &mut line_reader).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert_eq!(
            read_until_terminal(&mut reader, &mut line_reader).unwrap(),
            StratumLineRead::Line("{\"id\":7}\n".into())
        );
    }

    #[test]
    fn maximum_sized_line_remains_valid() {
        let mut input = vec![b'a'; MAX_STRATUM_LINE_BYTES - 1];
        input.push(b'\n');
        let mut reader = Cursor::new(input);
        let mut line_reader = StratumLineReader::default();

        let StratumLineRead::Line(line) =
            read_until_terminal(&mut reader, &mut line_reader).unwrap()
        else {
            panic!("expected complete Stratum line");
        };
        assert_eq!(line.len(), MAX_STRATUM_LINE_BYTES);
    }

    #[test]
    fn preserves_multiple_messages_read_in_one_chunk() {
        let mut reader = Cursor::new(b"{\"id\":1}\n{\"id\":2}\n".to_vec());
        let mut line_reader = StratumLineReader::default();

        assert_eq!(
            read_until_terminal(&mut reader, &mut line_reader).unwrap(),
            StratumLineRead::Line("{\"id\":1}\n".into())
        );
        assert_eq!(
            read_until_terminal(&mut reader, &mut line_reader).unwrap(),
            StratumLineRead::Line("{\"id\":2}\n".into())
        );
    }

    #[test]
    fn partial_message_survives_socket_timeouts() {
        let mut reader = IntermittentReader::new(b"{\"id\":7}\n".to_vec(), 2);
        let mut line_reader = StratumLineReader::default();
        let now = Instant::now();

        assert_eq!(
            line_reader.read_from_at(&mut reader, now).unwrap(),
            StratumLineRead::Pending
        );
        assert_eq!(line_reader.buffer, b"{\"");
        let timeout = line_reader.read_from_at(&mut reader, now).unwrap_err();
        assert_eq!(timeout.kind(), ErrorKind::TimedOut);
        assert_eq!(line_reader.buffer, b"{\"");

        for _ in 0..16 {
            match line_reader.read_from_at(&mut reader, now) {
                Ok(StratumLineRead::Line(line)) => {
                    assert_eq!(line, "{\"id\":7}\n");
                    return;
                }
                Ok(StratumLineRead::Pending) => {}
                Err(error) if error.kind() == ErrorKind::TimedOut => {}
                other => panic!("unexpected fragmented read result: {other:?}"),
            }
        }
        panic!("fragmented Stratum line did not complete");
    }

    #[test]
    fn cumulative_limit_applies_across_socket_timeouts() {
        let mut reader = IntermittentReader::new(vec![b'a'; MAX_STRATUM_LINE_BYTES + 1], 1024);
        let mut line_reader = StratumLineReader::default();
        let now = Instant::now();

        loop {
            match line_reader.read_from_at(&mut reader, now) {
                Ok(StratumLineRead::Pending) => {}
                Err(error) if error.kind() == ErrorKind::TimedOut => {}
                Err(error) => {
                    assert_eq!(error.kind(), ErrorKind::InvalidData);
                    assert_eq!(reader.offset, MAX_STRATUM_LINE_BYTES + 1);
                    break;
                }
                other => panic!("unexpected oversized read result: {other:?}"),
            }
        }
    }

    #[test]
    fn partial_message_has_an_absolute_deadline() {
        let started = Instant::now();
        let mut reader = Cursor::new(b"{".to_vec());
        let mut line_reader = StratumLineReader::default();

        assert_eq!(
            line_reader.read_from_at(&mut reader, started).unwrap(),
            StratumLineRead::Pending
        );
        let error = line_reader
            .read_from_at(&mut reader, started + STRATUM_LINE_DEADLINE)
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::InvalidData);
        assert!(error.to_string().contains("too long"));
    }
}

#[cfg(test)]
mod mainnet_target_policy_tests {
    use serde_json::{json, Value};

    use super::{mainnet_network_target_from_nbits, parse_job, ProtocolState};

    fn job_params(nbits: &str) -> Value {
        json!([
            "job-mainnet-policy",
            "00".repeat(32),
            "00",
            "00",
            [],
            "20000000",
            nbits,
            "5f5e1000",
            true
        ])
    }

    fn parse_mainnet_job(nbits: &str) -> Result<(), String> {
        let protocol = ProtocolState {
            extranonce1: Some("abcd".into()),
            extranonce2_size: Some(4),
            difficulty: 0.001,
            ..ProtocolState::default()
        };
        parse_job(Some(&job_params(nbits)), &protocol).map(|job| {
            assert!(
                job.is_some(),
                "subscribed protocol state must produce a job"
            );
        })
    }

    #[test]
    fn rejects_zero_negative_overflow_and_above_mainnet_pow_limit_targets() {
        for (nbits, expected_error) in [
            ("1d000000", "zero network target"),
            ("1d80ffff", "negative compact target"),
            ("21010000", "above uint256"),
            ("207fffff", "above the Bitcoin mainnet proof-of-work limit"),
            ("2100ffff", "above the Bitcoin mainnet proof-of-work limit"),
        ] {
            let error = parse_mainnet_job(nbits).expect_err(&format!(
                "nBits {nbits} must be rejected for mainnet mining"
            ));
            assert!(
                error.contains(expected_error),
                "unexpected error for nBits {nbits}: {error}"
            );
        }
    }

    #[test]
    fn accepts_mainnet_pow_limit_and_real_mainnet_target() {
        for nbits in [
            "1d00ffff", // Bitcoin mainnet powLimit (genesis target).
            "17053894", // Mainnet block 800,000.
        ] {
            parse_mainnet_job(nbits)
                .unwrap_or_else(|error| panic!("nBits {nbits} should be accepted: {error}"));
            assert_ne!(
                mainnet_network_target_from_nbits(nbits).unwrap(),
                [0_u8; 32]
            );
        }
    }
}

#[cfg(test)]
mod handshake_and_job_policy_tests {
    use std::sync::{atomic::AtomicBool, Arc};

    use serde_json::json;

    use super::{
        handle_server_message_with_callbacks, ProtocolEvent, ProtocolState, MAX_JOB_ID_BYTES,
    };
    use crate::{PendingShareSubmissions, SharedMiningState};

    const SUBSCRIBE_ACCEPTED: &str = r#"{"id":1,"result":[null,"abcd",4],"error":null}"#;
    const AUTHORIZE_ACCEPTED: &str = r#"{"id":2,"result":true,"error":null}"#;

    struct Harness {
        protocol: ProtocolState,
        shared: Arc<SharedMiningState>,
        pending: PendingShareSubmissions,
        logs: Vec<String>,
        events: Vec<ProtocolEvent>,
    }

    impl Harness {
        fn new() -> Self {
            Self {
                protocol: ProtocolState {
                    difficulty: 0.001,
                    ..ProtocolState::default()
                },
                shared: Arc::new(SharedMiningState::new(Arc::new(AtomicBool::new(false)))),
                pending: PendingShareSubmissions::default(),
                logs: Vec::new(),
                events: Vec::new(),
            }
        }

        fn handle(&mut self, line: &str) -> Result<(), String> {
            let Self {
                protocol,
                shared,
                pending,
                logs,
                events,
            } = self;
            handle_server_message_with_callbacks(
                line,
                protocol,
                shared,
                pending,
                |message| logs.push(message.to_owned()),
                |event| events.push(event),
            )
        }

        fn connection_status(&self) -> String {
            self.shared
                .connection_status
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .clone()
        }

        fn authorized_event_count(&self) -> usize {
            self.events
                .iter()
                .filter(|event| {
                    matches!(
                        event,
                        ProtocolEvent::ConnectionStatusChanged { status, .. }
                            if status == "Authorized"
                    )
                })
                .count()
        }
    }

    fn notify(job_id: &str) -> String {
        json!({
            "method": "mining.notify",
            "params": [
                job_id,
                "00".repeat(32),
                "00",
                "00",
                [],
                "20000000",
                "1d00ffff",
                "5f5e1000",
                true
            ]
        })
        .to_string()
    }

    #[test]
    fn normal_handshake_becomes_ready_before_accepting_notify() {
        let mut harness = Harness::new();

        harness.handle(SUBSCRIBE_ACCEPTED).unwrap();
        assert!(harness.protocol.subscribed);
        assert!(!harness.protocol.authorized);
        assert!(!harness.protocol.handshake_complete());
        assert!(!harness.protocol.is_ready());
        assert_eq!(harness.connection_status(), "Authorizing");

        harness.handle(AUTHORIZE_ACCEPTED).unwrap();
        assert!(harness.protocol.handshake_complete());
        assert!(harness.protocol.is_ready());
        assert_eq!(harness.connection_status(), "Authorized");
        assert_eq!(harness.authorized_event_count(), 1);

        harness.handle(&notify("normal-job")).unwrap();
        assert_eq!(
            harness
                .shared
                .job
                .read()
                .unwrap_or_else(|error| error.into_inner())
                .as_ref()
                .map(|job| job.job_id.as_str()),
            Some("normal-job")
        );
    }

    #[test]
    fn out_of_order_authorize_and_subscribe_responses_complete_once() {
        let mut harness = Harness::new();

        harness.handle(AUTHORIZE_ACCEPTED).unwrap();
        assert!(harness.protocol.authorized);
        assert!(!harness.protocol.subscribed);
        assert!(!harness.protocol.handshake_complete());
        assert!(!harness.protocol.is_ready());
        assert_eq!(harness.connection_status(), "Subscribing");
        assert_eq!(harness.authorized_event_count(), 0);

        harness.handle(SUBSCRIBE_ACCEPTED).unwrap();
        assert!(harness.protocol.handshake_complete());
        assert!(harness.protocol.is_ready());
        assert_eq!(harness.connection_status(), "Authorized");
        assert_eq!(harness.authorized_event_count(), 1);

        harness.handle(SUBSCRIBE_ACCEPTED).unwrap();
        harness.handle(AUTHORIZE_ACCEPTED).unwrap();
        assert_eq!(harness.authorized_event_count(), 1);
    }

    #[test]
    fn notify_before_authorization_is_rejected_without_setting_job() {
        let mut harness = Harness::new();
        harness.handle(SUBSCRIBE_ACCEPTED).unwrap();

        let error = harness.handle(&notify("too-early")).unwrap_err();

        assert!(error.contains("before the Stratum handshake completed"));
        assert!(error.contains("subscribed=true"));
        assert!(error.contains("authorized=false"));
        assert!(harness.shared.job.read().unwrap().is_none());
        assert_eq!(harness.connection_status(), "Authorizing");
    }

    #[test]
    fn job_id_is_limited_by_utf8_byte_length() {
        let mut harness = Harness::new();
        harness.handle(SUBSCRIBE_ACCEPTED).unwrap();
        harness.handle(AUTHORIZE_ACCEPTED).unwrap();

        let maximum = "é".repeat(MAX_JOB_ID_BYTES / "é".len());
        assert_eq!(maximum.len(), MAX_JOB_ID_BYTES);
        harness.handle(&notify(&maximum)).unwrap();

        let oversized = format!("{maximum}é");
        assert!(oversized.len() > MAX_JOB_ID_BYTES);
        let error = harness.handle(&notify(&oversized)).unwrap_err();
        assert!(error.contains("job id longer than 256 bytes"));
        assert_eq!(
            harness
                .shared
                .job
                .read()
                .unwrap_or_else(|error| error.into_inner())
                .as_ref()
                .map(|job| job.job_id.as_str()),
            Some(maximum.as_str())
        );
    }
}
