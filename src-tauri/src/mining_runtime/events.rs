use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::mining_settings::{FoundBlockEvent, MiningStats};
use crate::mining_state::SharedMiningState;

const STATS_EVENT: &str = "mining-stats";
const RUNTIME_EVENT: &str = "mining-event";

#[derive(Clone, Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub(crate) enum MiningRuntimeEvent {
    ConnectionStatusChanged { status: String, message: String },
    JobReceived { job_id: String, message: String },
    ShareSubmitted { message: String },
    ShareAccepted { message: String },
    ShareRejected { message: String },
    BlockCandidate { block: FoundBlockEvent },
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct MiningRuntimeEventPayload {
    pub(crate) session_id: u64,
    #[serde(flatten)]
    pub(crate) event: MiningRuntimeEvent,
}

pub(crate) fn emit_stats(
    app: &AppHandle,
    session_id: u64,
    shared: &SharedMiningState,
    hashrate: f64,
) {
    let _ = app.emit(STATS_EVENT, shared.snapshot(session_id, hashrate));
}

pub(crate) fn emit_stopped_stats(app: &AppHandle, session_id: u64) {
    let _ = app.emit(STATS_EVENT, MiningStats::stopped(session_id));
}

pub(crate) fn emit_runtime_event(app: &AppHandle, session_id: u64, event: MiningRuntimeEvent) {
    let _ = app.emit(
        RUNTIME_EVENT,
        MiningRuntimeEventPayload { session_id, event },
    );
}
