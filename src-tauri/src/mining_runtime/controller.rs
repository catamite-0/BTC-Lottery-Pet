use std::{
    io::{BufReader, ErrorKind},
    net::ToSocketAddrs,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde_json::json;
use tauri::AppHandle;

use crate::mining_connection::connect_to_pool;
use crate::mining_events::{
    emit_runtime_event, emit_stats, emit_stopped_stats, MiningRuntimeEvent,
};
#[cfg(test)]
use crate::mining_hash::{
    build_header, build_header_work, build_header_work_template, difficulty_from_hash,
    double_sha256, extranonce2_hex, found_block_event, hash_meets_network_target,
    header_work_from_header, target_from_nbits, word_swapped_hex, DIFF_ONE_TARGET,
};
use crate::mining_log::log_message_for_session;
#[cfg(test)]
use crate::mining_protocol::handle_server_message_with_logger;
use crate::mining_protocol::{
    handle_server_message_with_callbacks, read_stratum_line, write_message, ProtocolEvent,
    ProtocolState,
};
#[cfg(test)]
use crate::mining_protocol::{
    pool_response_error, validate_share_difficulty, MAX_STRATUM_LINE_BYTES,
};
#[cfg(test)]
use crate::mining_settings::validate_mainnet_address;
use crate::mining_settings::RealMiningSettings;
#[cfg(test)]
use crate::mining_state::{
    share_matches_current_job, share_matches_valid_previous_job, JobTemplate,
};
use crate::mining_state::{
    should_submit_share, PendingShareSubmission, PendingShareSubmissions, ShareSubmission,
    SharedMiningState,
};
use crate::mining_workers::spawn_hash_workers;
#[cfg(test)]
use crate::mining_workers::BestDifficultyTracker;

const MAX_PENDING_SUBMISSIONS: usize = 128;
const MAX_SHARE_SUBMISSIONS_PER_TICK: usize = 16;
const PENDING_SHARE_TIMEOUT: Duration = Duration::from_secs(30);
const SHARE_QUEUE_CAPACITY: usize = 256;
struct ActiveMiningSession {
    session_id: u64,
    stop: Arc<AtomicBool>,
    handle: JoinHandle<()>,
}

struct MiningControllerState {
    next_session_id: u64,
    active_session: Option<ActiveMiningSession>,
}

impl Default for MiningControllerState {
    fn default() -> Self {
        Self {
            next_session_id: 1,
            active_session: None,
        }
    }
}

#[derive(Default)]
pub struct MiningController {
    state: Mutex<MiningControllerState>,
}

impl MiningController {
    pub fn start(&self, app: AppHandle, settings: RealMiningSettings) -> Result<u64, String> {
        settings.validate()?;

        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        stop_active_session(&app, state.active_session.take())?;

        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker_app = app.clone();
        let session_id = state.next_session_id;
        state.next_session_id = state.next_session_id.saturating_add(1).max(1);

        let handle = thread::Builder::new()
            .name("btc-lottery-stratum".into())
            .spawn(move || run_miner(worker_app, session_id, settings, worker_stop))
            .map_err(|error| format!("failed to start Stratum worker: {error}"))?;

        state.active_session = Some(ActiveMiningSession {
            session_id,
            stop,
            handle,
        });
        Ok(session_id)
    }

    pub fn stop(&self, app: &AppHandle) -> Result<(), String> {
        let mut state = self.state.lock().unwrap_or_else(|e| e.into_inner());
        stop_active_session(app, state.active_session.take())
    }
}

fn stop_active_session(
    app: &AppHandle,
    session: Option<ActiveMiningSession>,
) -> Result<(), String> {
    if let Some(session) = session {
        log_message_for_session(app, session.session_id, "Mining stop requested");
        session.stop.store(true, Ordering::Release);
        session
            .handle
            .join()
            .map_err(|_| "mining worker thread panicked during shutdown".to_string())?;
    }

    Ok(())
}

fn run_miner(app: AppHandle, session_id: u64, settings: RealMiningSettings, stop: Arc<AtomicBool>) {
    let shared = Arc::new(SharedMiningState::new(Arc::clone(&stop)));
    let (share_sender, share_receiver) = mpsc::sync_channel(SHARE_QUEUE_CAPACITY);
    let workers = spawn_hash_workers(session_id, &settings, &shared, &share_sender, &app);

    while !stop.load(Ordering::Acquire) {
        shared.set_connection_status("Connecting");
        emit_runtime_event(
            &app,
            session_id,
            MiningRuntimeEvent::ConnectionStatusChanged {
                status: "Connecting".into(),
                message: "Connecting to pool".into(),
            },
        );

        if let Err(error) =
            run_stratum_connection(&app, session_id, &settings, &shared, &share_receiver)
        {
            if stop.load(Ordering::Acquire) {
                break;
            }

            shared.clear_job();
            shared.set_connection_status(format!("Retrying: {error}"));
            let message = format!("Connection error: {}. Retrying in 2s...", error);
            log_message_for_session(&app, session_id, &message);
            emit_runtime_event(
                &app,
                session_id,
                MiningRuntimeEvent::ConnectionStatusChanged {
                    status: "Connection Error".into(),
                    message,
                },
            );
            sleep_until_stopped(&stop, Duration::from_secs(2));
        }
    }

    stop.store(true, Ordering::Release);
    for worker in workers {
        let _ = worker.join();
    }

    shared.clear_job();
    shared.set_connection_status("Stopped");
    log_message_for_session(&app, session_id, "Mining stopped");
    emit_runtime_event(
        &app,
        session_id,
        MiningRuntimeEvent::ConnectionStatusChanged {
            status: "Stopped".into(),
            message: "Mining stopped".into(),
        },
    );
    emit_stopped_stats(&app, session_id);
}

fn run_stratum_connection(
    app: &AppHandle,
    session_id: u64,
    settings: &RealMiningSettings,
    shared: &Arc<SharedMiningState>,
    share_receiver: &Receiver<ShareSubmission>,
) -> Result<(), String> {
    let address = format!("{}:{}", settings.pool_host, settings.pool_port);
    let socket_addresses = address
        .to_socket_addrs()
        .map_err(|error| format!("DNS failed for {}: {error}", settings.pool_host))?
        .collect::<Vec<_>>();
    let mut stream = connect_to_pool(&address, &socket_addresses)?;
    log_message_for_session(app, session_id, "Connected to pool");
    emit_runtime_event(
        app,
        session_id,
        MiningRuntimeEvent::ConnectionStatusChanged {
            status: "Connected".into(),
            message: "Connected to pool".into(),
        },
    );

    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|error| format!("failed to set socket read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| format!("failed to set socket write timeout: {error}"))?;

    let reader_stream = stream
        .try_clone()
        .map_err(|error| format!("failed to initialize socket reader: {error}"))?;
    let mut reader = BufReader::new(reader_stream);
    let username = settings.username();
    let pool_password = settings.pool_password();
    let mut protocol = ProtocolState {
        difficulty: 0.001,
        ..ProtocolState::default()
    };
    let mut pending_submissions = PendingShareSubmissions::default();
    let mut request_id = 10_u64;
    let mut last_report = Instant::now();
    let mut last_hash_count = shared.hashes.load(Ordering::Relaxed);

    shared.set_connection_status("Subscribing");
    emit_runtime_event(
        app,
        session_id,
        MiningRuntimeEvent::ConnectionStatusChanged {
            status: "Subscribing".into(),
            message: "Subscribing to pool".into(),
        },
    );
    let drained_shares = drain_share_queue(share_receiver);
    if drained_shares > 0 {
        shared.record_stale_share_drops(drained_shares as u64);
        log_message_for_session(
            app,
            session_id,
            &format!("Dropped {drained_shares} queued share(s) from the previous pool connection"),
        );
    }
    write_message(
        &mut stream,
        &json!({
            "id": 1,
            "method": "mining.subscribe",
            "params": [format!("BTC Lottery Pet/{}", env!("CARGO_PKG_VERSION"))]
        }),
    )?;
    write_message(
        &mut stream,
        &json!({
            "id": 2,
            "method": "mining.authorize",
            "params": [username.clone(), pool_password]
        }),
    )?;

    let mut last_job_received = Instant::now();
    let mut debug_hint_logged = false;
    let mut smoothed_hashrate: f64 = 0.0;
    let mut last_activity = Instant::now();

    while !shared.stop.load(Ordering::Acquire) {
        if last_activity.elapsed() >= Duration::from_secs(300) {
            return Err("no message received from pool for 5 minutes".into());
        }

        let has_job = shared
            .job
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();
        if has_job {
            last_job_received = Instant::now();
            debug_hint_logged = false;
        } else if !debug_hint_logged && last_job_received.elapsed() >= Duration::from_secs(20) {
            log_message_for_session(app, session_id, "[Warning] No jobs received yet. Verify your pool address, port, BTC address, and network firewall settings.");
            debug_hint_logged = true;
        }

        let now = Instant::now();
        let expired = pending_submissions.prune_expired(now, PENDING_SHARE_TIMEOUT);
        log_expired_pending_submissions(app, session_id, &expired, now);

        for _ in 0..submission_budget(pending_submissions.len()) {
            if shared.stop.load(Ordering::Acquire) {
                break;
            }

            let Ok(share) = share_receiver.try_recv() else {
                break;
            };

            if !should_submit_share(shared, &share) {
                log_message_for_session(
                    app,
                    session_id,
                    &format!(
                        "Stale share dropped before submit: job_id={}, nonce={:08x}",
                        share.job_id, share.nonce
                    ),
                );
                continue;
            }

            request_id = request_id.saturating_add(1);

            let message = format!(
                "Share submitted: job_id={}, nonce={:08x}",
                share.job_id, share.nonce
            );
            log_message_for_session(app, session_id, &message);
            emit_runtime_event(
                app,
                session_id,
                MiningRuntimeEvent::ShareSubmitted { message },
            );
            write_message(
                &mut stream,
                &json!({
                    "id": request_id,
                    "method": "mining.submit",
                    "params": [
                        &username,
                        &share.job_id,
                        &share.extranonce2,
                        &share.ntime,
                        format!("{:08x}", share.nonce)
                    ]
                }),
            )?;
            pending_submissions.insert(request_id, share, Instant::now());
        }

        match read_stratum_line(&mut reader) {
            Ok(None) => return Err(format!("pool {address} closed the connection")),
            Ok(Some(line)) => {
                last_activity = Instant::now();
                handle_server_message_with_callbacks(
                    line.trim(),
                    &mut protocol,
                    shared,
                    &mut pending_submissions,
                    |message| log_message_for_session(app, session_id, message),
                    |event| {
                        emit_runtime_event(
                            app,
                            session_id,
                            mining_runtime_event_from_protocol(event),
                        )
                    },
                )?;
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }

        if last_report.elapsed() >= Duration::from_secs(1) {
            let elapsed = last_report.elapsed().as_secs_f64();
            let current_hash_count = shared.hashes.load(Ordering::Relaxed);
            let raw_hashrate = current_hash_count.saturating_sub(last_hash_count) as f64 / elapsed;
            // Exponential moving average for smooth display (alpha = 0.3)
            smoothed_hashrate = if smoothed_hashrate == 0.0 {
                raw_hashrate
            } else {
                0.3 * raw_hashrate + 0.7 * smoothed_hashrate
            };
            emit_stats(app, session_id, shared, smoothed_hashrate);
            last_hash_count = current_hash_count;
            last_report = Instant::now();
        }
    }

    Ok(())
}

fn mining_runtime_event_from_protocol(event: ProtocolEvent) -> MiningRuntimeEvent {
    match event {
        ProtocolEvent::ConnectionStatusChanged { status, message } => {
            MiningRuntimeEvent::ConnectionStatusChanged { status, message }
        }
        ProtocolEvent::JobReceived { job_id, message } => {
            MiningRuntimeEvent::JobReceived { job_id, message }
        }
        ProtocolEvent::ShareAccepted { message } => MiningRuntimeEvent::ShareAccepted { message },
        ProtocolEvent::ShareRejected { message } => MiningRuntimeEvent::ShareRejected { message },
    }
}

fn submission_budget(pending_submissions: usize) -> usize {
    MAX_SHARE_SUBMISSIONS_PER_TICK.min(MAX_PENDING_SUBMISSIONS.saturating_sub(pending_submissions))
}

fn drain_share_queue(share_receiver: &Receiver<ShareSubmission>) -> usize {
    let mut drained = 0;
    while share_receiver.try_recv().is_ok() {
        drained += 1;
    }
    drained
}

fn log_expired_pending_submissions(
    app: &AppHandle,
    session_id: u64,
    expired: &[PendingShareSubmission],
    now: Instant,
) {
    let Some(first) = expired.first() else {
        return;
    };

    let age = first.age_at(now).as_secs();
    log_message_for_session(
        app,
        session_id,
        &format!(
            "Timed out {} pending share submission(s); oldest request_id={}, job_id={}, nonce={:08x}, age={}s",
            expired.len(),
            first.request_id,
            first.share.job_id,
            first.share.nonce,
            age
        ),
    );
}

fn sleep_until_stopped(stop: &AtomicBool, duration: Duration) {
    let deadline = Instant::now() + duration;
    while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use std::{
        io::{BufRead, BufReader, Cursor, ErrorKind},
        net::{TcpListener, TcpStream},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    use super::{
        difficulty_from_hash, extranonce2_hex, found_block_event,
        handle_server_message_with_logger, hash_meets_network_target, read_stratum_line,
        target_from_nbits, validate_mainnet_address, validate_share_difficulty, word_swapped_hex,
        BestDifficultyTracker, JobTemplate, PendingShareSubmissions, ProtocolState,
        RealMiningSettings, SharedMiningState, DIFF_ONE_TARGET, MAX_PENDING_SUBMISSIONS,
        MAX_SHARE_SUBMISSIONS_PER_TICK, MAX_STRATUM_LINE_BYTES, PENDING_SHARE_TIMEOUT,
    };
    use crate::mining_log::{should_rotate_log, MAX_LOG_FILE_BYTES};

    fn read_mock_line(reader: &mut BufReader<TcpStream>) -> String {
        let mut line = String::new();
        reader.read_line(&mut line).expect("mock pool read line");
        assert!(!line.is_empty(), "mock pool connection closed early");
        line
    }

    fn protocol_test_state() -> (
        ProtocolState,
        Arc<SharedMiningState>,
        PendingShareSubmissions,
        Vec<String>,
    ) {
        (
            ProtocolState::default(),
            Arc::new(SharedMiningState::new(Arc::new(AtomicBool::new(false)))),
            PendingShareSubmissions::default(),
            Vec::new(),
        )
    }

    fn pending_share(job_id: &str, nonce: u32) -> super::ShareSubmission {
        super::ShareSubmission {
            generation: 1,
            job_id: job_id.into(),
            extranonce2: "00000001".into(),
            ntime: "5f5e1000".into(),
            nonce,
        }
    }

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
        let header = super::build_header(&job, &extranonce2).unwrap();
        let work = super::build_header_work(&job, &extranonce2).unwrap();

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
                super::double_sha256(&candidate),
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
        let template = super::build_header_work_template(&job, &extranonce2).unwrap();
        let first_work = template.work_for_ntime(&job.ntime).unwrap();

        let mut next_job = job.clone();
        next_job.ntime = "5f5e1010".into();
        let next_work = template.work_for_ntime(&next_job.ntime).unwrap();
        let rebuilt_next_work = super::build_header_work(&next_job, &extranonce2).unwrap();

        assert_eq!(first_work.midstate, next_work.midstate);
        assert_ne!(first_work.tail[1], next_work.tail[1]);
        assert_eq!(next_work, rebuilt_next_work);

        let next_header = super::build_header(&next_job, &extranonce2).unwrap();
        for nonce in [0, 1, 0x1234abcd, u32::MAX] {
            let mut candidate = next_header.clone();
            candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
            assert_eq!(
                crate::mining_kernel::double_sha256_from_midstate(
                    &next_work.midstate,
                    &next_work.tail,
                    nonce,
                ),
                super::double_sha256(&candidate),
            );
        }
    }

    #[test]
    fn header_work_rejects_invalid_header_width() {
        let error = super::header_work_from_header(&[0; 79]).unwrap_err();
        assert!(error.contains("80-byte block header"));
    }

    fn validity_test_job(job_id: &str, prev_hash: &str, clean_jobs: bool) -> JobTemplate {
        JobTemplate {
            generation: 0,
            clean_jobs,
            job_id: job_id.to_owned(),
            prev_hash: prev_hash.to_owned(),
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
        }
    }

    fn share_for_job(job: &JobTemplate) -> super::ShareSubmission {
        super::ShareSubmission {
            generation: job.generation,
            job_id: job.job_id.clone(),
            extranonce2: "00000001".into(),
            ntime: job.ntime.clone(),
            nonce: 0,
        }
    }

    #[test]
    fn stale_share_submissions_do_not_match_current_job() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        let base_job = JobTemplate {
            generation: 0,
            clean_jobs: true,
            job_id: "job-1".into(),
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

        shared.set_job(base_job.clone());
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = super::ShareSubmission {
            generation: active_job.generation,
            job_id: active_job.job_id.clone(),
            extranonce2: "00000001".into(),
            ntime: active_job.ntime.clone(),
            nonce: 0,
        };

        assert!(super::share_matches_current_job(&shared, &active_share));
        assert!(super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 0);

        let stale_generation = super::ShareSubmission {
            generation: active_job.generation.saturating_sub(1),
            ..active_share.clone()
        };

        assert!(!super::share_matches_current_job(
            &shared,
            &stale_generation
        ));
        assert!(!super::should_submit_share(&shared, &stale_generation));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);

        let mut next_job = base_job;
        next_job.job_id = "job-2".into();
        shared.set_job(next_job);

        assert!(!super::share_matches_current_job(&shared, &active_share));
        assert!(!super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn previous_job_share_remains_valid_when_clean_jobs_is_false() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        let prev_hash = "00".repeat(32);
        shared.set_job(validity_test_job("job-1", &prev_hash, true));
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = share_for_job(&active_job);

        shared.set_job(validity_test_job("job-2", &prev_hash, false));

        assert!(!super::share_matches_current_job(&shared, &active_share));
        assert!(super::share_matches_valid_previous_job(
            &shared,
            &active_share
        ));
        assert!(super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 0);
        assert_eq!(shared.valid_previous_jobs.lock().unwrap().len(), 1);
    }

    #[test]
    fn previous_job_share_is_stale_when_prev_hash_changes() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        shared.set_job(validity_test_job("job-1", &"00".repeat(32), true));
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = share_for_job(&active_job);

        shared.set_job(validity_test_job("job-2", &"11".repeat(32), false));

        assert!(!super::share_matches_valid_previous_job(
            &shared,
            &active_share
        ));
        assert!(!super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);
        assert!(shared.valid_previous_jobs.lock().unwrap().is_empty());
    }

    #[test]
    fn previous_job_share_expires_after_grace_window() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        let prev_hash = "00".repeat(32);
        shared.set_job(validity_test_job("job-1", &prev_hash, true));
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = share_for_job(&active_job);
        shared.set_job(validity_test_job("job-2", &prev_hash, false));

        {
            let mut valid_previous_jobs = shared.valid_previous_jobs.lock().unwrap();
            assert_eq!(valid_previous_jobs.len(), 1);
            valid_previous_jobs[0].expires_at = Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now);
        }

        assert!(!super::share_matches_valid_previous_job(
            &shared,
            &active_share
        ));
        assert!(shared.valid_previous_jobs.lock().unwrap().is_empty());
        assert!(!super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn best_difficulty_tracker_skips_hashes_below_current_best() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        shared.update_best_difficulty(1.0);
        let mut tracker = BestDifficultyTracker::new(&shared);
        let weak_hash_words = [0xffff_ffff; 8];

        assert!(!crate::mining_kernel::hash_words_meet_target_words(
            &weak_hash_words,
            tracker.target_words(),
        ));
        assert_eq!(
            f64::from_bits(shared.best_difficulty_bits.load(Ordering::Relaxed)),
            1.0
        );

        let perfect_hash_words = [0_u32; 8];
        assert!(crate::mining_kernel::hash_words_meet_target_words(
            &perfect_hash_words,
            tracker.target_words(),
        ));
        let improved = tracker.record_words_improvement(&shared, &perfect_hash_words);
        assert_eq!(improved, DIFF_ONE_TARGET);
        assert_eq!(
            f64::from_bits(shared.best_difficulty_bits.load(Ordering::Relaxed)),
            DIFF_ONE_TARGET
        );
    }
    #[test]
    fn queued_share_drops_are_counted_in_stats_snapshot() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        assert_eq!(shared.snapshot(7, 0.0).session_id, 7);
        assert_eq!(shared.snapshot(7, 0.0).queued_shares_dropped, 0);

        shared.record_queued_share_drop();
        shared.record_queued_share_drop();

        assert_eq!(shared.queued_shares_dropped.load(Ordering::Relaxed), 2);
        assert_eq!(shared.snapshot(7, 123.0).queued_shares_dropped, 2);
    }

    #[test]
    fn pending_share_submissions_expire_by_age() {
        let mut pending = PendingShareSubmissions::default();
        let now = Instant::now();
        pending.insert(
            11,
            pending_share("job-old", 0),
            now.checked_sub(PENDING_SHARE_TIMEOUT + Duration::from_secs(1))
                .unwrap_or(now),
        );
        pending.insert(
            12,
            pending_share("job-new", 1),
            now.checked_sub(Duration::from_secs(1)).unwrap_or(now),
        );

        let expired = pending.prune_expired(now, PENDING_SHARE_TIMEOUT);

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].request_id, 11);
        assert!(!pending.contains_id(11));
        assert!(pending.contains_id(12));
    }

    #[test]
    fn drains_queued_shares_before_new_pool_connection() {
        let (sender, receiver) = std::sync::mpsc::sync_channel(4);
        sender.try_send(pending_share("old-job", 0)).unwrap();
        sender.try_send(pending_share("old-job", 1)).unwrap();

        assert_eq!(super::drain_share_queue(&receiver), 2);
        assert_eq!(super::drain_share_queue(&receiver), 0);
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

    #[test]
    fn validates_mainnet_bitcoin_address_checksum_and_network() {
        assert!(validate_mainnet_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa").is_ok());
        assert!(validate_mainnet_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb").is_err());
        assert!(validate_mainnet_address("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn").is_err());
    }

    #[test]
    fn rejects_pathological_share_difficulty() {
        assert!(validate_share_difficulty(0.0001).is_ok());
        assert!(validate_share_difficulty(1e-9).is_ok());
        assert!(validate_share_difficulty(1e-10).is_err());
        assert!(validate_share_difficulty(0.0).is_err());
        assert!(validate_share_difficulty(f64::EPSILON).is_err());
        assert!(validate_share_difficulty(f64::INFINITY).is_err());
    }

    #[test]
    fn rejects_oversized_stratum_line_during_read() {
        let bytes = vec![b'a'; MAX_STRATUM_LINE_BYTES + 1];
        let mut reader = BufReader::new(Cursor::new(bytes));
        let error = read_stratum_line(&mut reader).unwrap_err();

        assert_eq!(error.kind(), ErrorKind::InvalidData);
    }

    #[test]
    fn surfaces_pool_rejection_reason_from_result_text() {
        let message = serde_json::json!({
            "id": 1,
            "result": "Only allowed user agents may subscribe",
            "error": null
        });

        assert_eq!(
            super::pool_response_error(&message).as_deref(),
            Some("Only allowed user agents may subscribe")
        );
    }

    #[test]
    fn rejects_malformed_stratum_json() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        let error = handle_server_message_with_logger(
            "{not-json",
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("invalid Stratum JSON"));
        assert!(logs.is_empty());
    }

    #[test]
    fn rejects_notify_with_invalid_hex_before_worker_dispatch() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        protocol.extranonce1 = Some("abcd".into());
        protocol.extranonce2_size = Some(4);
        protocol.difficulty = 0.001;

        let error = handle_server_message_with_logger(
            r#"{"method":"mining.notify","params":["job-bad","zz","00","00",[],"20000000","1d00ffff","5f5e1000",true]}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("previous hash"));
        assert!(shared.job.read().unwrap().is_none());
        assert!(logs.is_empty());
    }

    #[test]
    fn surfaces_subscribe_rejection_reason() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        let error = handle_server_message_with_logger(
            r#"{"id":1,"result":null,"error":["subscription disabled",20,null]}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("pool rejected mining.subscribe"));
        assert!(error.contains("subscription disabled"));
        assert!(protocol.extranonce1.is_none());
    }

    #[test]
    fn surfaces_authorize_rejection_reason() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        let error = handle_server_message_with_logger(
            r#"{"id":2,"result":false,"error":["bad user",24,null]}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("pool rejected mining.authorize"));
        assert!(error.contains("bad user"));
        assert_eq!(
            shared.connection_status.lock().unwrap().as_str(),
            "Starting"
        );
    }

    #[test]
    fn ignores_unknown_response_ids_without_share_accounting() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        pending_submissions.insert(99, pending_share("job-unknown", 0), Instant::now());

        handle_server_message_with_logger(
            r#"{"id":42,"result":true,"error":null}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap();

        assert_eq!(shared.accepted_shares.load(Ordering::Relaxed), 0);
        assert_eq!(shared.rejected_shares.load(Ordering::Relaxed), 0);
        assert!(pending_submissions.contains_id(99));
        assert!(logs.is_empty());
    }

    #[test]
    fn mock_stratum_pool_drives_handshake_job_and_share_accounting() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());

            let subscribe = read_mock_line(&mut reader);
            assert!(subscribe.contains("\"mining.subscribe\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 1,
                    "result": [null, "abcd", 4],
                    "error": null
                }),
            )
            .unwrap();

            let authorize = read_mock_line(&mut reader);
            assert!(authorize.contains("\"mining.authorize\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 2,
                    "result": true,
                    "error": null
                }),
            )
            .unwrap();
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "method": "mining.set_difficulty",
                    "params": [0.001]
                }),
            )
            .unwrap();
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "method": "mining.notify",
                    "params": [
                        "job-1",
                        "0000000000000000000000000000000000000000000000000000000000000000",
                        "00",
                        "00",
                        [],
                        "20000000",
                        "1d00ffff",
                        "5f5e1000",
                        true
                    ]
                }),
            )
            .unwrap();

            let submit = read_mock_line(&mut reader);
            assert!(submit.contains("\"mining.submit\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 11,
                    "result": true,
                    "error": null
                }),
            )
            .unwrap();

            let rejected_submit = read_mock_line(&mut reader);
            assert!(rejected_submit.contains("\"mining.submit\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 12,
                    "result": false,
                    "error": ["low difficulty share", 23, null]
                }),
            )
            .unwrap();
        });

        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(SharedMiningState::new(stop));
        let mut protocol = ProtocolState {
            difficulty: 0.001,
            ..ProtocolState::default()
        };
        let mut pending_submissions = PendingShareSubmissions::default();
        let mut logs = Vec::new();

        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 1,
                "method": "mining.subscribe",
                "params": ["BTC Lottery Pet/test"]
            }),
        )
        .unwrap();
        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 2,
                "method": "mining.authorize",
                "params": ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.worker", "x"]
            }),
        )
        .unwrap();

        for _ in 0..4 {
            let line = read_stratum_line(&mut reader).unwrap().unwrap();
            handle_server_message_with_logger(
                line.trim(),
                &mut protocol,
                &shared,
                &mut pending_submissions,
                |message| logs.push(message.to_owned()),
            )
            .unwrap();
        }

        assert_eq!(
            shared
                .job
                .read()
                .unwrap()
                .as_ref()
                .map(|job| job.job_id.as_str()),
            Some("job-1")
        );
        assert_eq!(shared.connection_status.lock().unwrap().as_str(), "Mining");

        pending_submissions.insert(11, pending_share("job-1", 0), Instant::now());
        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 11,
                "method": "mining.submit",
                "params": [
                    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.worker",
                    "job-1",
                    "00000001",
                    "5f5e1000",
                    "00000000"
                ]
            }),
        )
        .unwrap();
        let line = read_stratum_line(&mut reader).unwrap().unwrap();
        handle_server_message_with_logger(
            line.trim(),
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap();

        assert_eq!(shared.accepted_shares.load(Ordering::Relaxed), 1);
        assert_eq!(shared.rejected_shares.load(Ordering::Relaxed), 0);
        assert!(logs
            .iter()
            .any(|line| line.contains("Share accepted: job_id=job-1")));

        pending_submissions.insert(12, pending_share("job-1", 1), Instant::now());
        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 12,
                "method": "mining.submit",
                "params": [
                    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.worker",
                    "job-1",
                    "00000002",
                    "5f5e1000",
                    "00000001"
                ]
            }),
        )
        .unwrap();
        let line = read_stratum_line(&mut reader).unwrap().unwrap();
        handle_server_message_with_logger(
            line.trim(),
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap();

        assert_eq!(shared.accepted_shares.load(Ordering::Relaxed), 1);
        assert_eq!(shared.rejected_shares.load(Ordering::Relaxed), 1);
        assert!(logs
            .iter()
            .any(|line| line.contains("low difficulty share")));
        server.join().unwrap();
    }

    #[test]
    fn caps_share_submission_budget() {
        assert_eq!(super::submission_budget(0), MAX_SHARE_SUBMISSIONS_PER_TICK);
        assert_eq!(super::submission_budget(MAX_PENDING_SUBMISSIONS - 1), 1);
        assert_eq!(super::submission_budget(MAX_PENDING_SUBMISSIONS), 0);
        assert_eq!(super::submission_budget(MAX_PENDING_SUBMISSIONS + 1), 0);
    }

    #[test]
    fn rotates_log_before_exceeding_size_cap() {
        assert!(!should_rotate_log(0, 1));
        assert!(!should_rotate_log(MAX_LOG_FILE_BYTES - 1, 1));
        assert!(should_rotate_log(MAX_LOG_FILE_BYTES, 1));
    }

    #[test]
    fn rejects_real_mining_threads_above_local_parallelism() {
        let available_threads = std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1);
        let settings = RealMiningSettings {
            pool_host: "public-pool.io".into(),
            pool_port: 3333,
            pool_password: String::new(),
            btc_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".into(),
            worker_name: "btc-lottery-pet".into(),
            cpu_threads: available_threads + 1,
            confirmed_cpu_use: true,
        };

        assert!(settings.validate().is_err());
    }
}
