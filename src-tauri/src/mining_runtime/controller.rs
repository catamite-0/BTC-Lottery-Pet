use std::{
    collections::{HashMap, VecDeque},
    io::ErrorKind,
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::{self, Receiver, TryRecvError},
        Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use serde_json::json;
use tauri::AppHandle;

use crate::mining_block::record_block_candidate;
use crate::mining_connection::{connect_to_pool, resolve_pool_addresses};
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
    handle_server_message_with_callbacks, write_message, ProtocolEvent, ProtocolState,
    StratumLineRead, StratumLineReader,
};
#[cfg(test)]
use crate::mining_protocol::{
    pool_response_error, validate_share_difficulty, MAX_STRATUM_LINE_BYTES,
};
#[cfg(test)]
use crate::mining_settings::validate_mainnet_address;
use crate::mining_settings::{CandidateSubmissionStatus, FoundBlockEvent, RealMiningSettings};
#[cfg(test)]
use crate::mining_state::{
    share_matches_current_job, share_matches_valid_previous_job, JobTemplate,
};
use crate::mining_state::{
    should_submit_share, PendingShareSubmission, PendingShareSubmissions, ShareSubmission,
    SharedMiningState,
};
#[cfg(test)]
use crate::mining_workers::BestDifficultyTracker;
use crate::mining_workers::{spawn_hash_workers, BlockCandidateSubmission};

const MAX_PENDING_SUBMISSIONS: usize = 128;
const MAX_SHARE_SUBMISSIONS_PER_TICK: usize = 16;
const PENDING_SHARE_TIMEOUT: Duration = Duration::from_secs(30);
const CANDIDATE_RESPONSE_GRACE: Duration = Duration::from_secs(2);
const STRATUM_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_POOL_TEXT_CHARS: usize = 512;
const MIN_REDACTED_SECRET_CHARS: usize = 4;
const SHARE_QUEUE_CAPACITY: usize = 256;
const CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION: &str =
    "Candidate was not submitted because its original Stratum connection had already ended.";
const CANDIDATE_UNKNOWN_CONNECTION_ENDED: &str =
    "The pool connection ended before the candidate submission was confirmed.";
const CANDIDATE_UNKNOWN_RESPONSE_TIMEOUT: &str =
    "The pool did not confirm the candidate submission before the response timeout.";
const CANDIDATE_UNKNOWN_SHUTDOWN: &str =
    "The pool did not confirm the candidate submission before mining stopped.";
const CANDIDATE_UNKNOWN_NOT_SUBMITTED_SHUTDOWN: &str =
    "The candidate was not submitted before mining stopped.";

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
    let (candidate_sender, candidate_receiver) = mpsc::channel();
    let workers = spawn_hash_workers(
        session_id,
        &settings,
        &shared,
        &share_sender,
        &candidate_sender,
        &app,
    );
    drop(share_sender);
    drop(candidate_sender);

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

        if let Err(error) = run_stratum_connection(
            &app,
            session_id,
            &settings,
            &shared,
            &share_receiver,
            &candidate_receiver,
        ) {
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
    finalize_received_candidates(
        &app,
        session_id,
        &candidate_receiver,
        CANDIDATE_UNKNOWN_NOT_SUBMITTED_SHUTDOWN,
    );
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
    candidate_receiver: &Receiver<BlockCandidateSubmission>,
) -> Result<(), String> {
    let residual_candidates = finalize_received_candidates(
        app,
        session_id,
        candidate_receiver,
        CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION,
    );
    if residual_candidates > 0 {
        shared.stop.store(true, Ordering::Release);
        return Ok(());
    }

    let connection_generation_floor = shared.job_generation.load(Ordering::Acquire);
    let mut candidates = ConnectionCandidates::new(connection_generation_floor);
    let result = run_stratum_connection_inner(
        app,
        session_id,
        settings,
        shared,
        share_receiver,
        candidate_receiver,
        &mut candidates,
    );

    while let Ok(candidate) = candidate_receiver.try_recv() {
        candidates.queue(candidate);
    }

    if !candidates.is_empty() {
        shared.stop.store(true, Ordering::Release);
    }

    let (pending_message, queued_message) = if result.is_err() {
        (
            CANDIDATE_UNKNOWN_CONNECTION_ENDED,
            CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION,
        )
    } else {
        (
            CANDIDATE_UNKNOWN_SHUTDOWN,
            CANDIDATE_UNKNOWN_NOT_SUBMITTED_SHUTDOWN,
        )
    };
    for event in candidates.drain_unknown(pending_message, queued_message) {
        record_block_candidate(app, session_id, &event);
    }

    result
}

fn run_stratum_connection_inner(
    app: &AppHandle,
    session_id: u64,
    settings: &RealMiningSettings,
    shared: &Arc<SharedMiningState>,
    share_receiver: &Receiver<ShareSubmission>,
    candidate_receiver: &Receiver<BlockCandidateSubmission>,
    candidates: &mut ConnectionCandidates,
) -> Result<(), String> {
    let address = format!("{}:{}", settings.pool_host, settings.pool_port);
    let Some(socket_addresses) =
        resolve_pool_addresses(&address, &settings.pool_host, &shared.stop)?
    else {
        return Ok(());
    };
    let Some(mut stream) = connect_to_pool(&address, &socket_addresses, &shared.stop)? else {
        return Ok(());
    };
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

    if shared.stop.load(Ordering::Acquire) {
        return Ok(());
    }

    let mut reader_stream = stream
        .try_clone()
        .map_err(|error| format!("failed to initialize socket reader: {error}"))?;
    let mut line_reader = StratumLineReader::default();
    let username = settings.username();
    let pool_password = settings.pool_password();
    let submit_context = ShareSubmitContext {
        app,
        session_id,
        username: &username,
    };
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
            "params": [username.clone(), pool_password.clone()]
        }),
    )?;

    let mut last_job_received = Instant::now();
    let mut debug_hint_logged = false;
    let handshake_started = Instant::now();
    let mut smoothed_hashrate: f64 = 0.0;
    let mut last_activity = Instant::now();
    let mut candidate_channel_disconnected = false;
    let mut shutdown_deadline = None;

    loop {
        let stopping = shared.stop.load(Ordering::Acquire);
        if stopping && shutdown_deadline.is_none() {
            shutdown_deadline = Some(Instant::now() + CANDIDATE_RESPONSE_GRACE);
        }

        if !stopping && last_activity.elapsed() >= Duration::from_secs(300) {
            return Err("no message received from pool for 5 minutes".into());
        }

        if !stopping
            && !protocol.is_ready()
            && handshake_started.elapsed() >= STRATUM_HANDSHAKE_TIMEOUT
        {
            return Err("pool did not complete the Stratum handshake within 15 seconds".into());
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
        for submission in &expired {
            if let Some(event) = candidates.finish(
                submission.request_id,
                CandidateSubmissionStatus::Unknown,
                Some(CANDIDATE_UNKNOWN_RESPONSE_TIMEOUT.into()),
            ) {
                record_block_candidate(app, session_id, &event);
            }
        }

        loop {
            match candidate_receiver.try_recv() {
                Ok(candidate) if candidate.share.generation <= candidates.generation_floor => {
                    shared.stop.store(true, Ordering::Release);
                    let event = candidate_with_outcome(
                        candidate.event,
                        CandidateSubmissionStatus::Unknown,
                        Some(CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION.into()),
                    );
                    record_block_candidate(app, session_id, &event);
                }
                Ok(candidate) => candidates.queue(candidate),
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => {
                    candidate_channel_disconnected = true;
                    break;
                }
            }
        }

        if protocol.is_ready() {
            while let Some(candidate) = candidates.pop_queued() {
                submit_candidate_to_pool(
                    &mut stream,
                    &submit_context,
                    shared,
                    &mut request_id,
                    &mut pending_submissions,
                    candidates,
                    candidate,
                )?;
            }
        }

        if !stopping {
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

                submit_share_to_pool(
                    &mut stream,
                    &submit_context,
                    &mut request_id,
                    &mut pending_submissions,
                    share,
                )?;
            }
        }

        match line_reader.read_from(&mut reader_stream) {
            Ok(StratumLineRead::Closed) => {
                return Err(format!("pool {address} closed the connection"));
            }
            Ok(StratumLineRead::Pending) => {}
            Ok(StratumLineRead::Line(line)) => {
                last_activity = Instant::now();
                let result = handle_server_message_with_callbacks(
                    line.trim(),
                    &mut protocol,
                    shared,
                    &mut pending_submissions,
                    |message| {
                        let message = sanitize_pool_text(
                            message,
                            [
                                username.as_str(),
                                settings.btc_address.as_str(),
                                pool_password.as_str(),
                            ],
                        );
                        log_message_for_session(app, session_id, &message);
                    },
                    |event| {
                        let event = sanitize_protocol_event(
                            event,
                            [
                                username.as_str(),
                                settings.btc_address.as_str(),
                                pool_password.as_str(),
                            ],
                        );
                        let finalized_candidate = candidates.finish_protocol_event(&event);
                        emit_runtime_event(
                            app,
                            session_id,
                            mining_runtime_event_from_protocol(event),
                        );
                        if let Some(event) = finalized_candidate {
                            record_block_candidate(app, session_id, &event);
                        }
                    },
                );
                if let Err(error) = result {
                    return Err(sanitize_pool_text(
                        &error,
                        [
                            username.as_str(),
                            settings.btc_address.as_str(),
                            pool_password.as_str(),
                        ],
                    ));
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }

        if stopping {
            if candidate_channel_disconnected && candidates.is_empty() {
                break;
            }

            if shutdown_deadline.is_some_and(|deadline| Instant::now() >= deadline) {
                if candidates.pending_len() > 0 {
                    log_message_for_session(
                        app,
                        session_id,
                        &format!(
                            "Stopped after waiting {}s for {} block candidate response(s)",
                            CANDIDATE_RESPONSE_GRACE.as_secs(),
                            candidates.pending_len()
                        ),
                    );
                }
                for event in candidates.drain_pending_unknown(CANDIDATE_UNKNOWN_RESPONSE_TIMEOUT) {
                    record_block_candidate(app, session_id, &event);
                }
                break;
            }
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

struct ShareSubmitContext<'a> {
    app: &'a AppHandle,
    session_id: u64,
    username: &'a str,
}

#[derive(Default)]
struct ConnectionCandidates {
    generation_floor: u64,
    queued: VecDeque<BlockCandidateSubmission>,
    pending: HashMap<u64, FoundBlockEvent>,
    orphaned: Vec<FoundBlockEvent>,
}

impl ConnectionCandidates {
    fn new(generation_floor: u64) -> Self {
        Self {
            generation_floor,
            ..Self::default()
        }
    }

    fn queue(&mut self, candidate: BlockCandidateSubmission) {
        self.queued.push_back(candidate);
    }

    fn queue_front(&mut self, candidate: BlockCandidateSubmission) {
        self.queued.push_front(candidate);
    }

    fn pop_queued(&mut self) -> Option<BlockCandidateSubmission> {
        self.queued.pop_front()
    }

    fn track(&mut self, request_id: u64, event: FoundBlockEvent) {
        if let Some(previous) = self.pending.insert(request_id, event) {
            self.orphaned.push(previous);
        }
    }

    fn finish(
        &mut self,
        request_id: u64,
        status: CandidateSubmissionStatus,
        message: Option<String>,
    ) -> Option<FoundBlockEvent> {
        self.pending
            .remove(&request_id)
            .map(|event| candidate_with_outcome(event, status, message))
    }

    fn finish_protocol_event(&mut self, event: &ProtocolEvent) -> Option<FoundBlockEvent> {
        match event {
            ProtocolEvent::ShareAccepted {
                request_id,
                message,
            } => self.finish(
                *request_id,
                CandidateSubmissionStatus::Accepted,
                Some(message.clone()),
            ),
            ProtocolEvent::ShareRejected {
                request_id,
                message,
            } => self.finish(
                *request_id,
                CandidateSubmissionStatus::Rejected,
                Some(message.clone()),
            ),
            _ => None,
        }
    }

    fn drain_pending_unknown(&mut self, message: &str) -> Vec<FoundBlockEvent> {
        let mut finalized = Vec::with_capacity(self.pending.len() + self.orphaned.len());
        finalized.extend(self.pending.drain().map(|(_, event)| {
            candidate_with_outcome(
                event,
                CandidateSubmissionStatus::Unknown,
                Some(message.into()),
            )
        }));
        finalized.extend(self.orphaned.drain(..).map(|event| {
            candidate_with_outcome(
                event,
                CandidateSubmissionStatus::Unknown,
                Some(message.into()),
            )
        }));
        finalized
    }

    fn drain_unknown(
        &mut self,
        pending_message: &str,
        queued_message: &str,
    ) -> Vec<FoundBlockEvent> {
        let mut finalized = self.drain_pending_unknown(pending_message);
        finalized.extend(self.queued.drain(..).map(|candidate| {
            candidate_with_outcome(
                candidate.event,
                CandidateSubmissionStatus::Unknown,
                Some(queued_message.into()),
            )
        }));
        finalized
    }

    fn pending_len(&self) -> usize {
        self.pending.len() + self.orphaned.len()
    }

    fn is_empty(&self) -> bool {
        self.queued.is_empty() && self.pending.is_empty() && self.orphaned.is_empty()
    }
}

fn candidate_with_outcome(
    mut event: FoundBlockEvent,
    status: CandidateSubmissionStatus,
    message: Option<String>,
) -> FoundBlockEvent {
    event.submission_status = status;
    event.submission_message = message;
    event
}

fn finalize_received_candidates(
    app: &AppHandle,
    session_id: u64,
    receiver: &Receiver<BlockCandidateSubmission>,
    message: &str,
) -> usize {
    let candidates = receiver.try_iter().collect::<Vec<_>>();
    let count = candidates.len();
    for candidate in candidates {
        let event = candidate_with_outcome(
            candidate.event,
            CandidateSubmissionStatus::Unknown,
            Some(message.into()),
        );
        record_block_candidate(app, session_id, &event);
    }
    count
}

fn share_submit_message(
    username: &str,
    request_id: u64,
    share: &ShareSubmission,
) -> serde_json::Value {
    json!({
        "id": request_id,
        "method": "mining.submit",
        "params": [
            username,
            &share.job_id,
            &share.extranonce2,
            &share.ntime,
            format!("{:08x}", share.nonce)
        ]
    })
}

fn record_submitted_share(
    context: &ShareSubmitContext<'_>,
    request_id: &mut u64,
    pending_submissions: &mut PendingShareSubmissions,
    next_request_id: u64,
    share: ShareSubmission,
) {
    let message = format!(
        "Share submitted: job_id={}, nonce={:08x}",
        share.job_id, share.nonce
    );
    pending_submissions.insert(next_request_id, share, Instant::now());
    *request_id = next_request_id;
    log_message_for_session(context.app, context.session_id, &message);
    emit_runtime_event(
        context.app,
        context.session_id,
        MiningRuntimeEvent::ShareSubmitted { message },
    );
}

fn submit_share_to_pool(
    stream: &mut std::net::TcpStream,
    context: &ShareSubmitContext<'_>,
    request_id: &mut u64,
    pending_submissions: &mut PendingShareSubmissions,
    share: ShareSubmission,
) -> Result<u64, String> {
    let next_request_id = request_id
        .checked_add(1)
        .ok_or_else(|| "Stratum request id exhausted".to_string())?;
    write_message(
        stream,
        &share_submit_message(context.username, next_request_id, &share),
    )?;
    record_submitted_share(
        context,
        request_id,
        pending_submissions,
        next_request_id,
        share,
    );
    Ok(next_request_id)
}

fn attempt_candidate_submission(
    request_id: &mut u64,
    candidates: &mut ConnectionCandidates,
    candidate: BlockCandidateSubmission,
    stop: &AtomicBool,
    write: impl FnOnce(u64, &ShareSubmission) -> Result<(), String>,
) -> Result<(u64, ShareSubmission), String> {
    let Some(next_request_id) = request_id.checked_add(1) else {
        candidates.queue_front(candidate);
        stop.store(true, Ordering::Release);
        return Err("Stratum request id exhausted".into());
    };

    let BlockCandidateSubmission { share, event } = candidate;
    candidates.track(next_request_id, event);
    let result = write(next_request_id, &share);
    stop.store(true, Ordering::Release);
    result?;
    *request_id = next_request_id;
    Ok((next_request_id, share))
}

fn submit_candidate_to_pool(
    stream: &mut std::net::TcpStream,
    context: &ShareSubmitContext<'_>,
    shared: &SharedMiningState,
    request_id: &mut u64,
    pending_submissions: &mut PendingShareSubmissions,
    candidates: &mut ConnectionCandidates,
    candidate: BlockCandidateSubmission,
) -> Result<u64, String> {
    let (next_request_id, share) = attempt_candidate_submission(
        request_id,
        candidates,
        candidate,
        &shared.stop,
        |next_request_id, share| {
            write_message(
                stream,
                &share_submit_message(context.username, next_request_id, share),
            )
        },
    )?;
    record_submitted_share(
        context,
        request_id,
        pending_submissions,
        next_request_id,
        share,
    );
    Ok(next_request_id)
}

fn mining_runtime_event_from_protocol(event: ProtocolEvent) -> MiningRuntimeEvent {
    match event {
        ProtocolEvent::ConnectionStatusChanged { status, message } => {
            MiningRuntimeEvent::ConnectionStatusChanged { status, message }
        }
        ProtocolEvent::JobReceived { job_id, message } => {
            MiningRuntimeEvent::JobReceived { job_id, message }
        }
        ProtocolEvent::ShareAccepted { message, .. } => {
            MiningRuntimeEvent::ShareAccepted { message }
        }
        ProtocolEvent::ShareRejected { message, .. } => {
            MiningRuntimeEvent::ShareRejected { message }
        }
    }
}

fn sanitize_pool_text(message: &str, secrets: [&str; 3]) -> String {
    let mut cleaned = message
        .chars()
        .map(|character| {
            if character.is_control() {
                ' '
            } else {
                character
            }
        })
        .collect::<String>();

    for (index, secret) in secrets.into_iter().enumerate() {
        let is_pool_password = index == 2;
        if !secret.is_empty()
            && (is_pool_password || secret.chars().count() >= MIN_REDACTED_SECRET_CHARS)
        {
            cleaned = cleaned.replace(secret, "[redacted]");
        }
    }

    let mut characters = cleaned.chars();
    let mut bounded = characters
        .by_ref()
        .take(MAX_POOL_TEXT_CHARS)
        .collect::<String>();
    if characters.next().is_some() {
        bounded.push('…');
    }
    bounded
}

fn sanitize_protocol_event(event: ProtocolEvent, secrets: [&str; 3]) -> ProtocolEvent {
    match event {
        ProtocolEvent::ConnectionStatusChanged { status, message } => {
            ProtocolEvent::ConnectionStatusChanged {
                status,
                message: sanitize_pool_text(&message, secrets),
            }
        }
        ProtocolEvent::JobReceived { job_id, message } => ProtocolEvent::JobReceived {
            job_id: sanitize_pool_text(&job_id, secrets),
            message: sanitize_pool_text(&message, secrets),
        },
        ProtocolEvent::ShareAccepted {
            request_id,
            message,
        } => ProtocolEvent::ShareAccepted {
            request_id,
            message: sanitize_pool_text(&message, secrets),
        },
        ProtocolEvent::ShareRejected {
            request_id,
            message,
        } => ProtocolEvent::ShareRejected {
            request_id,
            message: sanitize_pool_text(&message, secrets),
        },
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
        io::{BufRead, BufReader, Cursor, ErrorKind, Write},
        net::{TcpListener, TcpStream},
        sync::{
            atomic::{AtomicBool, Ordering},
            mpsc, Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    use super::{
        difficulty_from_hash, extranonce2_hex, found_block_event,
        handle_server_message_with_logger, hash_meets_network_target, target_from_nbits,
        validate_mainnet_address, validate_share_difficulty, word_swapped_hex,
        BestDifficultyTracker, JobTemplate, PendingShareSubmissions, ProtocolState,
        RealMiningSettings, SharedMiningState, StratumLineRead, StratumLineReader, DIFF_ONE_TARGET,
        MAX_PENDING_SUBMISSIONS, MAX_SHARE_SUBMISSIONS_PER_TICK, MAX_STRATUM_LINE_BYTES,
        PENDING_SHARE_TIMEOUT,
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

    fn block_candidate(nonce: u32) -> super::BlockCandidateSubmission {
        super::BlockCandidateSubmission {
            share: pending_share("job-candidate", nonce),
            event: super::FoundBlockEvent {
                job_id: "job-candidate".into(),
                nonce: format!("{nonce:08x}"),
                ntime: "5f5e1000".into(),
                extranonce2: "00000001".into(),
                hash: "00".repeat(32),
                difficulty: 42.0,
                timestamp: "2026-07-30T00:00:00Z".into(),
                submission_status: super::CandidateSubmissionStatus::Unknown,
                submission_message: None,
                pool: "pool.example:3333".into(),
                record_saved: false,
                record_file: None,
            },
        }
    }

    #[test]
    fn candidate_pool_responses_finalize_once_with_request_id() {
        let mut accepted = super::ConnectionCandidates::default();
        accepted.track(11, block_candidate(1).event);
        let event = super::ProtocolEvent::ShareAccepted {
            request_id: 11,
            message: "Pool accepted candidate submission; this is not a network confirmation."
                .into(),
        };
        let finalized = accepted.finish_protocol_event(&event).unwrap();
        assert_eq!(
            finalized.submission_status,
            super::CandidateSubmissionStatus::Accepted
        );
        assert!(finalized
            .submission_message
            .as_deref()
            .unwrap()
            .contains("not a network confirmation"));
        assert!(accepted.finish_protocol_event(&event).is_none());
        assert!(accepted.is_empty());

        let mut rejected = super::ConnectionCandidates::default();
        rejected.track(12, block_candidate(2).event);
        let event = super::ProtocolEvent::ShareRejected {
            request_id: 12,
            message: "Pool rejected candidate submission.".into(),
        };
        let finalized = rejected.finish_protocol_event(&event).unwrap();
        assert_eq!(
            finalized.submission_status,
            super::CandidateSubmissionStatus::Rejected
        );
        assert_eq!(
            finalized.submission_message.as_deref(),
            Some("Pool rejected candidate submission.")
        );
        assert!(rejected.finish_protocol_event(&event).is_none());
        assert!(rejected.is_empty());
    }

    #[test]
    fn written_candidate_stops_backend_and_disconnect_or_timeout_is_unknown_once() {
        let stop = AtomicBool::new(false);
        let mut request_id = 10;
        let mut candidates = super::ConnectionCandidates::default();
        let write_observed = std::cell::Cell::new(false);

        let (submitted_id, _) = super::attempt_candidate_submission(
            &mut request_id,
            &mut candidates,
            block_candidate(3),
            &stop,
            |next_request_id, share| {
                assert_eq!(next_request_id, 11);
                assert_eq!(share.nonce, 3);
                assert!(!stop.load(Ordering::Acquire));
                write_observed.set(true);
                Ok(())
            },
        )
        .unwrap();

        assert!(write_observed.get());
        assert!(stop.load(Ordering::Acquire));
        assert_eq!(submitted_id, 11);
        assert_eq!(request_id, 11);
        assert_eq!(candidates.pending_len(), 1);
        assert!(candidates.pop_queued().is_none());

        let finalized = candidates.drain_unknown(
            super::CANDIDATE_UNKNOWN_CONNECTION_ENDED,
            super::CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION,
        );
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0].submission_status,
            super::CandidateSubmissionStatus::Unknown
        );
        assert!(finalized[0]
            .submission_message
            .as_deref()
            .unwrap()
            .contains("connection ended"));
        assert!(candidates
            .drain_unknown("duplicate", "duplicate")
            .is_empty());

        let mut timed_out = super::ConnectionCandidates::default();
        timed_out.track(12, block_candidate(4).event);
        let finalized = timed_out
            .finish(
                12,
                super::CandidateSubmissionStatus::Unknown,
                Some(super::CANDIDATE_UNKNOWN_RESPONSE_TIMEOUT.into()),
            )
            .unwrap();
        assert_eq!(
            finalized.submission_status,
            super::CandidateSubmissionStatus::Unknown
        );
        assert!(timed_out
            .finish(12, super::CandidateSubmissionStatus::Unknown, None)
            .is_none());
    }

    #[test]
    fn candidate_write_failure_is_unknown_and_never_requeued() {
        let stop = AtomicBool::new(false);
        let mut request_id = 10;
        let mut candidates = super::ConnectionCandidates::default();

        let result = super::attempt_candidate_submission(
            &mut request_id,
            &mut candidates,
            block_candidate(5),
            &stop,
            |_, _| Err("scripted partial socket write".into()),
        );
        let error = match result {
            Err(error) => error,
            Ok(_) => panic!("scripted candidate write unexpectedly succeeded"),
        };

        assert!(error.contains("partial socket write"));
        assert!(stop.load(Ordering::Acquire));
        assert_eq!(request_id, 10);
        assert_eq!(candidates.pending_len(), 1);
        assert!(candidates.pop_queued().is_none());
        let finalized = candidates.drain_unknown(
            super::CANDIDATE_UNKNOWN_CONNECTION_ENDED,
            super::CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION,
        );
        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0].submission_status,
            super::CandidateSubmissionStatus::Unknown
        );
        assert!(candidates.is_empty());
    }

    #[test]
    fn unattempted_candidate_from_ended_connection_is_unknown_not_replayed() {
        let mut candidates = super::ConnectionCandidates::default();
        candidates.queue(block_candidate(6));

        let finalized = candidates.drain_unknown(
            super::CANDIDATE_UNKNOWN_CONNECTION_ENDED,
            super::CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION,
        );

        assert_eq!(finalized.len(), 1);
        assert_eq!(
            finalized[0].submission_status,
            super::CandidateSubmissionStatus::Unknown
        );
        assert_eq!(
            finalized[0].submission_message.as_deref(),
            Some(super::CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION)
        );
        assert!(candidates.pop_queued().is_none());
        assert!(candidates.is_empty());
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
        assert!(validate_share_difficulty(0.000099).is_err());
        assert!(validate_share_difficulty(1e-9).is_err());
        assert!(validate_share_difficulty(0.0).is_err());
        assert!(validate_share_difficulty(f64::EPSILON).is_err());
        assert!(validate_share_difficulty(f64::INFINITY).is_err());
    }

    #[test]
    fn stop_signal_is_observed_during_slow_drip_input() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let mut client = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        let (mut server, _) = listener.accept().unwrap();
        client
            .set_read_timeout(Some(Duration::from_millis(200)))
            .unwrap();

        let stop = Arc::new(AtomicBool::new(false));
        let writer_stop = Arc::clone(&stop);
        let writer_handle = thread::spawn(move || {
            while !writer_stop.load(Ordering::Acquire) {
                if server.write_all(b"a").is_err() {
                    break;
                }
                thread::sleep(Duration::from_millis(20));
            }
        });

        let reader_stop = Arc::clone(&stop);
        let (ready_sender, ready_receiver) = mpsc::channel();
        let (done_sender, done_receiver) = mpsc::channel();
        let reader_handle = thread::spawn(move || {
            let mut line_reader = StratumLineReader::default();
            ready_sender.send(()).unwrap();
            while !reader_stop.load(Ordering::Acquire) {
                match line_reader.read_from(&mut client) {
                    Ok(StratumLineRead::Pending | StratumLineRead::Line(_)) => {}
                    Ok(StratumLineRead::Closed) => break,
                    Err(error)
                        if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
                    Err(error) => panic!("unexpected slow-drip read error: {error}"),
                }
            }
            done_sender.send(()).unwrap();
        });

        ready_receiver.recv().unwrap();
        thread::sleep(Duration::from_millis(60));
        let stop_started = Instant::now();
        stop.store(true, Ordering::Release);
        done_receiver
            .recv_timeout(Duration::from_millis(500))
            .expect("slow-drip reader did not observe the stop signal");

        assert!(stop_started.elapsed() < Duration::from_millis(500));
        reader_handle.join().unwrap();
        writer_handle.join().unwrap();
    }

    #[test]
    fn rejects_oversized_stratum_line_during_read() {
        let bytes = vec![b'a'; MAX_STRATUM_LINE_BYTES + 1];
        let mut reader = Cursor::new(bytes);
        let mut line_reader = StratumLineReader::default();
        let error = loop {
            match line_reader.read_from(&mut reader) {
                Ok(StratumLineRead::Pending) => {}
                Err(error) => break error,
                other => panic!("unexpected oversized read result: {other:?}"),
            }
        };

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
            let line = read_mock_line(&mut reader);
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
        let line = read_mock_line(&mut reader);
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
        let line = read_mock_line(&mut reader);
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

    #[test]
    fn sanitizes_pool_text_before_logging_or_emitting_it() {
        let username = "wallet.worker";
        let address = "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa";
        let password = "secret-password";
        let message = format!(
            "pool error\r\nuser={username} address={address} password={password} {}",
            "x".repeat(super::MAX_POOL_TEXT_CHARS + 100)
        );

        let sanitized = super::sanitize_pool_text(&message, [username, address, password]);

        assert!(!sanitized.contains('\r'));
        assert!(!sanitized.contains('\n'));
        assert!(!sanitized.contains(username));
        assert!(!sanitized.contains(address));
        assert!(!sanitized.contains(password));
        assert_eq!(sanitized.matches("[redacted]").count(), 3);
        assert!(sanitized.ends_with('…'));
        assert!(sanitized.chars().count() <= super::MAX_POOL_TEXT_CHARS + 1);
    }

    #[test]
    fn sanitizes_non_empty_short_pool_password_without_redacting_short_identity_fields() {
        let username = "u";
        let address = "a";
        let password = "x";
        let message = "user=u address=a password=x";

        let sanitized = super::sanitize_pool_text(message, [username, address, password]);

        assert!(sanitized.contains("user=u"));
        assert!(sanitized.contains("address=a"));
        assert!(!sanitized.contains("password=x"));
        assert!(sanitized.contains("password=[redacted]"));
    }
}
