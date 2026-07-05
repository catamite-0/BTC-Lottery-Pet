use std::io::Write;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const MAX_LOG_FILE_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Serialize)]
struct MiningLogPayload<'a> {
    session_id: Option<u64>,
    message: &'a str,
}

pub(crate) fn log_message(app: &AppHandle, message: &str) {
    log_message_with_session(app, None, message);
}

pub(crate) fn log_message_for_session(app: &AppHandle, session_id: u64, message: &str) {
    log_message_with_session(app, Some(session_id), message);
}

fn log_message_with_session(app: &AppHandle, session_id: Option<u64>, message: &str) {
    let _ = app.emit(
        "mining-log",
        MiningLogPayload {
            session_id,
            message,
        },
    );

    let log_dir = match app.path().app_log_dir() {
        Ok(dir) => dir,
        Err(_) => return,
    };

    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    let log_file_path = log_dir.join("mining.log");
    let archived_log_file_path = log_dir.join("mining.log.1");

    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S");
    let log_line = format!("[{}] {}\n", now, message);

    if should_rotate_log(
        std::fs::metadata(&log_file_path)
            .map(|metadata| metadata.len())
            .unwrap_or_default(),
        log_line.len(),
    ) {
        let _ = std::fs::remove_file(&archived_log_file_path);
        let _ = std::fs::rename(&log_file_path, &archived_log_file_path);
    }

    if let Ok(mut file) = std::fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file_path)
    {
        let _ = file.write_all(log_line.as_bytes());
    }
}

pub(crate) fn should_rotate_log(current_bytes: u64, incoming_bytes: usize) -> bool {
    current_bytes.saturating_add(incoming_bytes as u64) > MAX_LOG_FILE_BYTES
}
