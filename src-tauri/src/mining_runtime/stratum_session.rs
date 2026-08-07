use std::{
    io::ErrorKind,
    sync::{
        atomic::Ordering,
        mpsc::{Receiver, TryRecvError},
        Arc,
    },
    time::{Duration, Instant},
};

use serde_json::json;
use tauri::AppHandle;

use super::sanitize::{sanitize_pool_text, sanitize_protocol_event};
use super::submissions::{
    candidate_with_outcome, drain_share_queue, finalize_received_candidates,
    log_expired_pending_submissions, mining_runtime_event_from_protocol, submission_budget,
    submit_candidate_to_pool, submit_share_to_pool, ConnectionCandidates, ShareSubmitContext,
    CANDIDATE_UNKNOWN_CONNECTION_ENDED, CANDIDATE_UNKNOWN_NOT_SUBMITTED_SHUTDOWN,
    CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION, CANDIDATE_UNKNOWN_RESPONSE_TIMEOUT,
    CANDIDATE_UNKNOWN_SHUTDOWN, PENDING_SHARE_TIMEOUT,
};
use crate::mining_block::record_block_candidate;
use crate::mining_connection::{connect_to_pool, resolve_pool_addresses};
use crate::mining_events::{emit_runtime_event, emit_stats, MiningRuntimeEvent};
use crate::mining_log::log_message_for_session;
use crate::mining_protocol::{
    handle_server_message_with_callbacks, write_message, ProtocolState, StratumLineRead,
    StratumLineReader,
};
use crate::mining_settings::{CandidateSubmissionStatus, RealMiningSettings};
use crate::mining_state::{
    should_submit_share, PendingShareSubmissions, ShareSubmission, SharedMiningState,
};
use crate::mining_workers::BlockCandidateSubmission;

const CANDIDATE_RESPONSE_GRACE: Duration = Duration::from_secs(2);
const STRATUM_HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) fn run_stratum_connection(
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

pub(crate) fn run_stratum_connection_inner(
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
