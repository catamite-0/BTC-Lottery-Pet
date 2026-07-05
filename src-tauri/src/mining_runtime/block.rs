use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::mining_events::{emit_runtime_event, MiningRuntimeEvent};
use crate::mining_log::log_message_for_session;
use crate::mining_settings::FoundBlockEvent;

const BLOCK_FOUND_EVENT: &str = "block-found";

#[derive(Clone, Serialize)]
struct BlockFoundPayload<'a> {
    session_id: u64,
    block: &'a FoundBlockEvent,
}

pub(crate) fn record_block_candidate(app: &AppHandle, session_id: u64, event: &FoundBlockEvent) {
    log_message_for_session(app, session_id, "BLOCK CANDIDATE FOUND!");
    emit_runtime_event(
        app,
        session_id,
        MiningRuntimeEvent::BlockCandidate {
            block: event.clone(),
        },
    );
    let _ = app.emit(
        BLOCK_FOUND_EVENT,
        BlockFoundPayload {
            session_id,
            block: event,
        },
    );

    let Ok(log_dir) = app.path().app_log_dir() else {
        return;
    };

    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    let timestamp = chrono::Utc::now().format("%Y%m%d_%H%M%S");
    let path = log_dir.join(format!("found_block_{timestamp}.json"));
    match serde_json::to_vec_pretty(event) {
        Ok(payload) => {
            if let Err(error) = std::fs::write(&path, payload) {
                log_message_for_session(
                    app,
                    session_id,
                    &format!("Failed to save found block file: {error}"),
                );
            }
        }
        Err(error) => {
            log_message_for_session(
                app,
                session_id,
                &format!("Failed to encode found block file: {error}"),
            );
        }
    }
}
