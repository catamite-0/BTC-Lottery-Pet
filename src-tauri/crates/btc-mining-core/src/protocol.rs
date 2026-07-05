use std::{
    collections::HashSet,
    io::{self, BufRead, ErrorKind, Read, Write},
    net::TcpStream,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    time::{Duration, Instant},
};

use serde_json::Value;

use crate::{JobTemplate, SharedMiningState};

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

pub fn diagnostic_subscribe_result(message: &Value) -> Result<(String, usize), String> {
    let result = message
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            pool_response_error(message)
                .map(|reason| format!("pool rejected mining.subscribe: {reason}"))
                .unwrap_or_else(|| "pool returned an invalid mining.subscribe response".into())
        })?;

    let extranonce1 = result
        .get(1)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "pool returned an incomplete mining.subscribe response".to_string())?;
    let extranonce2_size = result
        .get(2)
        .and_then(Value::as_u64)
        .ok_or_else(|| "pool returned an incomplete mining.subscribe response".to_string())
        .and_then(|size| validate_extranonce2_size(size as usize))?;

    Ok((extranonce1, extranonce2_size))
}

pub fn diagnostic_authorize_result(message: &Value) -> Result<(), String> {
    if message.get("result").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }

    let reason =
        pool_response_error(message).unwrap_or_else(|| "authorization returned false".into());
    Err(format!("pool rejected mining.authorize: {reason}"))
}

pub fn read_until_diagnostic_message(
    reader: &mut impl BufRead,
    timeout: Duration,
    matches_message: impl Fn(&Value) -> bool,
) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;

    loop {
        if Instant::now() >= deadline {
            return Err(format!("timed out after {} seconds", timeout.as_secs()));
        }

        match read_stratum_line(reader) {
            Ok(None) => return Err("pool closed the connection".into()),
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let message: Value = serde_json::from_str(trimmed)
                    .map_err(|error| format!("invalid Stratum JSON: {error}"))?;
                if matches_message(&message) {
                    return Ok(message);
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }
    }
}

pub fn wait_for_diagnostic_job(
    reader: &mut impl BufRead,
    protocol: &mut ProtocolState,
    timeout: Duration,
) -> Result<(String, f64), String> {
    let shared = Arc::new(SharedMiningState::new(Arc::new(AtomicBool::new(false))));
    let mut pending_submissions = HashSet::new();
    let deadline = Instant::now() + timeout;

    loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "no mining.notify job received within {} seconds",
                timeout.as_secs()
            ));
        }

        match read_stratum_line(reader) {
            Ok(None) => return Err("pool closed the connection before sending a job".into()),
            Ok(Some(line)) => {
                handle_server_message_with_logger(
                    line.trim(),
                    protocol,
                    &shared,
                    &mut pending_submissions,
                    |_| {},
                )?;

                if let Some(job) = shared
                    .job
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .as_ref()
                {
                    return Ok((job.job_id.clone(), job.share_difficulty));
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }
    }
}

pub fn handle_server_message_with_logger(
    line: &str,
    protocol: &mut ProtocolState,
    shared: &Arc<SharedMiningState>,
    pending_submissions: &mut HashSet<u64>,
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
    pending_submissions: &mut HashSet<u64>,
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
                let difficulty = value_as_f64(&message["params"][0])
                    .ok_or_else(|| "pool sent an invalid share difficulty".to_string())?;
                protocol.difficulty = validate_share_difficulty(difficulty)?;
                log(&format!("Pool set share difficulty: {difficulty}"));
            }
            "mining.set_extranonce" => {
                protocol.extranonce1 = message["params"][0].as_str().map(str::to_owned);
                protocol.extranonce2_size = message["params"][1]
                    .as_u64()
                    .map(|size| validate_extranonce2_size(size as usize))
                    .transpose()?;
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
        protocol.extranonce1 = result.get(1).and_then(Value::as_str).map(str::to_owned);
        protocol.extranonce2_size = result
            .get(2)
            .and_then(Value::as_u64)
            .map(|size| validate_extranonce2_size(size as usize))
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
    } else if pending_submissions.remove(&id) {
        if message.get("result").and_then(Value::as_bool) == Some(true) {
            shared.accepted_shares.fetch_add(1, Ordering::Relaxed);
            let message = "Share accepted!".to_string();
            log(&message);
            event(ProtocolEvent::ShareAccepted { message });
        } else {
            shared.rejected_shares.fetch_add(1, Ordering::Relaxed);
            let err_str = message
                .get("error")
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string());
            let message = format!("Share rejected. Reason: {}", err_str);
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
            branch
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "pool sent a non-string merkle branch".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    if merkle_branches.len() > 64 {
        return Err("pool sent too many merkle branches".into());
    }

    let nbits = required_string(params, 6, "nbits")?;
    let network_target = btc_hash_cpu::target_from_nbits(&nbits)?;
    let clean_jobs = params[8]
        .as_bool()
        .ok_or_else(|| "pool sent an invalid clean_jobs flag".to_string())?;

    Ok(Some(JobTemplate {
        generation: 0,
        clean_jobs,
        job_id: required_string(params, 0, "job id")?,
        prev_hash: required_string(params, 1, "previous hash")?,
        coinbase1: required_string(params, 2, "coinbase prefix")?,
        coinbase2: required_string(params, 3, "coinbase suffix")?,
        merkle_branches,
        version: required_string(params, 5, "version")?,
        nbits,
        network_target,
        ntime: required_string(params, 7, "ntime")?,
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

fn validate_extranonce2_size(size: usize) -> Result<usize, String> {
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
