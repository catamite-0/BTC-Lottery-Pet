use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc::Receiver,
    },
    time::{Duration, Instant},
};

use serde_json::json;
use tauri::AppHandle;

use crate::mining_block::record_block_candidate;
use crate::mining_events::{emit_runtime_event, MiningRuntimeEvent};
use crate::mining_log::log_message_for_session;
use crate::mining_protocol::{write_message, ProtocolEvent};
use crate::mining_settings::{CandidateSubmissionStatus, FoundBlockEvent};
use crate::mining_state::{
    PendingShareSubmission, PendingShareSubmissions, ShareSubmission, SharedMiningState,
};
use crate::mining_workers::BlockCandidateSubmission;

pub(crate) const MAX_PENDING_SUBMISSIONS: usize = 128;
pub(crate) const MAX_SHARE_SUBMISSIONS_PER_TICK: usize = 16;
pub(crate) const PENDING_SHARE_TIMEOUT: Duration = Duration::from_secs(30);
pub(crate) const CANDIDATE_UNKNOWN_PREVIOUS_CONNECTION: &str =
    "Candidate was not submitted because its original Stratum connection had already ended.";
pub(crate) const CANDIDATE_UNKNOWN_CONNECTION_ENDED: &str =
    "The pool connection ended before the candidate submission was confirmed.";
pub(crate) const CANDIDATE_UNKNOWN_RESPONSE_TIMEOUT: &str =
    "The pool did not confirm the candidate submission before the response timeout.";
pub(crate) const CANDIDATE_UNKNOWN_SHUTDOWN: &str =
    "The pool did not confirm the candidate submission before mining stopped.";
pub(crate) const CANDIDATE_UNKNOWN_NOT_SUBMITTED_SHUTDOWN: &str =
    "The candidate was not submitted before mining stopped.";

pub(crate) struct ShareSubmitContext<'a> {
    pub(crate) app: &'a AppHandle,
    pub(crate) session_id: u64,
    pub(crate) username: &'a str,
}

#[derive(Default)]
pub(crate) struct ConnectionCandidates {
    pub(crate) generation_floor: u64,
    queued: VecDeque<BlockCandidateSubmission>,
    pending: HashMap<u64, FoundBlockEvent>,
    orphaned: Vec<FoundBlockEvent>,
}

impl ConnectionCandidates {
    pub(crate) fn new(generation_floor: u64) -> Self {
        Self {
            generation_floor,
            ..Self::default()
        }
    }

    pub(crate) fn queue(&mut self, candidate: BlockCandidateSubmission) {
        self.queued.push_back(candidate);
    }

    pub(crate) fn queue_front(&mut self, candidate: BlockCandidateSubmission) {
        self.queued.push_front(candidate);
    }

    pub(crate) fn pop_queued(&mut self) -> Option<BlockCandidateSubmission> {
        self.queued.pop_front()
    }

    pub(crate) fn track(&mut self, request_id: u64, event: FoundBlockEvent) {
        if let Some(previous) = self.pending.insert(request_id, event) {
            self.orphaned.push(previous);
        }
    }

    pub(crate) fn finish(
        &mut self,
        request_id: u64,
        status: CandidateSubmissionStatus,
        message: Option<String>,
    ) -> Option<FoundBlockEvent> {
        self.pending
            .remove(&request_id)
            .map(|event| candidate_with_outcome(event, status, message))
    }

    pub(crate) fn finish_protocol_event(
        &mut self,
        event: &ProtocolEvent,
    ) -> Option<FoundBlockEvent> {
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

    pub(crate) fn drain_pending_unknown(&mut self, message: &str) -> Vec<FoundBlockEvent> {
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

    pub(crate) fn drain_unknown(
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

    pub(crate) fn pending_len(&self) -> usize {
        self.pending.len() + self.orphaned.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.queued.is_empty() && self.pending.is_empty() && self.orphaned.is_empty()
    }
}

pub(crate) fn candidate_with_outcome(
    mut event: FoundBlockEvent,
    status: CandidateSubmissionStatus,
    message: Option<String>,
) -> FoundBlockEvent {
    event.submission_status = status;
    event.submission_message = message;
    event
}

pub(crate) fn finalize_received_candidates(
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

pub(crate) fn share_submit_message(
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

pub(crate) fn record_submitted_share(
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

pub(crate) fn submit_share_to_pool(
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

pub(crate) fn attempt_candidate_submission(
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

pub(crate) fn submit_candidate_to_pool(
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

pub(crate) fn mining_runtime_event_from_protocol(event: ProtocolEvent) -> MiningRuntimeEvent {
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

pub(crate) fn submission_budget(pending_submissions: usize) -> usize {
    MAX_SHARE_SUBMISSIONS_PER_TICK.min(MAX_PENDING_SUBMISSIONS.saturating_sub(pending_submissions))
}

pub(crate) fn drain_share_queue(share_receiver: &Receiver<ShareSubmission>) -> usize {
    let mut drained = 0;
    while share_receiver.try_recv().is_ok() {
        drained += 1;
    }
    drained
}

pub(crate) fn log_expired_pending_submissions(
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
