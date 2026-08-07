use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
};

use tauri::{AppHandle, Manager};

use crate::mining_events::{emit_runtime_event, MiningRuntimeEvent};
use crate::mining_log::log_message_for_session;
#[cfg(test)]
use crate::mining_settings::CandidateSubmissionStatus;
use crate::mining_settings::FoundBlockEvent;

const MAX_RECORD_CREATE_ATTEMPTS: usize = 16;

static BLOCK_RECORD_SEQUENCE: AtomicU64 = AtomicU64::new(0);

pub(crate) fn record_block_candidate(app: &AppHandle, session_id: u64, event: &FoundBlockEvent) {
    let recorded_event = match app.path().app_log_dir() {
        Ok(log_dir) => match persist_block_candidate(&log_dir, event) {
            Ok(recorded) => recorded,
            Err(error) => {
                log_message_for_session(
                    app,
                    session_id,
                    &format!("Failed to save found block file: {error}"),
                );
                without_record(event)
            }
        },
        Err(error) => {
            log_message_for_session(
                app,
                session_id,
                &format!("Failed to locate found block folder: {error}"),
            );
            without_record(event)
        }
    };

    log_message_for_session(app, session_id, "BLOCK CANDIDATE FOUND!");
    emit_runtime_event(
        app,
        session_id,
        MiningRuntimeEvent::BlockCandidate {
            block: recorded_event,
        },
    );
}

fn without_record(event: &FoundBlockEvent) -> FoundBlockEvent {
    let mut event = event.clone();
    event.record_saved = false;
    event.record_file = None;
    event
}

fn persist_block_candidate(
    log_dir: &Path,
    event: &FoundBlockEvent,
) -> Result<FoundBlockEvent, String> {
    fs::create_dir_all(log_dir)
        .map_err(|error| format!("failed to create log directory: {error}"))?;

    for _ in 0..MAX_RECORD_CREATE_ATTEMPTS {
        let sequence = BLOCK_RECORD_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let now = chrono::Utc::now();
        let timestamp = now
            .timestamp_nanos_opt()
            .unwrap_or_else(|| now.timestamp_micros().saturating_mul(1_000));
        let hash_prefix = event.hash.chars().take(12).collect::<String>();
        let file_name = format!(
            "found_block_{timestamp}_{}_{sequence}_{hash_prefix}.json",
            std::process::id()
        );
        let final_path = log_dir.join(&file_name);
        let temp_path = temporary_record_path(log_dir, &file_name, sequence);

        let mut recorded_event = event.clone();
        recorded_event.record_saved = true;
        recorded_event.record_file = Some(file_name);
        let payload = serde_json::to_vec_pretty(&recorded_event)
            .map_err(|error| format!("failed to encode block candidate: {error}"))?;

        let mut file = match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => file,
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("failed to create temporary block record: {error}")),
        };

        if let Err(error) = file.write_all(&payload) {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("failed to write block candidate: {error}"));
        }
        if let Err(error) = file.sync_all() {
            let _ = fs::remove_file(&temp_path);
            return Err(format!("failed to flush block candidate: {error}"));
        }
        drop(file);

        if final_path.exists() {
            let _ = fs::remove_file(&temp_path);
            continue;
        }
        match fs::rename(&temp_path, &final_path) {
            Ok(()) => return Ok(recorded_event),
            Err(error) => {
                let _ = fs::remove_file(&temp_path);
                return Err(format!("failed to publish block candidate record: {error}"));
            }
        }
    }

    Err("failed to create a unique block candidate record".into())
}

fn temporary_record_path(log_dir: &Path, file_name: &str, sequence: u64) -> PathBuf {
    log_dir.join(format!(
        ".{file_name}.tmp-{}-{sequence}",
        std::process::id()
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_event() -> FoundBlockEvent {
        FoundBlockEvent {
            job_id: "job-test".into(),
            nonce: "1234abcd".into(),
            ntime: "5f5e1000".into(),
            extranonce2: "00000001".into(),
            hash: "00".repeat(32),
            difficulty: 42.0,
            timestamp: "2026-07-30T00:00:00Z".into(),
            submission_status: CandidateSubmissionStatus::Unknown,
            submission_message: None,
            pool: "pool.example:3333".into(),
            record_saved: false,
            record_file: None,
        }
    }

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!(
            "btc-lottery-block-{name}-{}-{unique}",
            std::process::id()
        ))
    }

    #[test]
    fn persists_unique_complete_candidate_records() {
        let dir = temp_test_dir("unique");
        let event = sample_event();

        let first = persist_block_candidate(&dir, &event).unwrap();
        let second = persist_block_candidate(&dir, &event).unwrap();

        assert!(first.record_saved);
        assert!(second.record_saved);
        assert_ne!(first.record_file, second.record_file);
        for recorded in [first, second] {
            let path = dir.join(recorded.record_file.as_ref().unwrap());
            let decoded: serde_json::Value =
                serde_json::from_slice(&fs::read(path).unwrap()).unwrap();
            assert_eq!(decoded["record_saved"], true);
            assert_eq!(decoded["record_file"], recorded.record_file.unwrap());
        }
        assert_eq!(fs::read_dir(&dir).unwrap().count(), 2);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn persistence_failure_keeps_event_truthful() {
        let path = temp_test_dir("not-a-directory");
        fs::write(&path, b"file").unwrap();

        assert!(persist_block_candidate(&path, &sample_event()).is_err());
        let fallback = without_record(&sample_event());
        assert!(!fallback.record_saved);
        assert!(fallback.record_file.is_none());

        fs::remove_file(path).unwrap();
    }
}
