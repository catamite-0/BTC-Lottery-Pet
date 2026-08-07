use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        mpsc, Arc, Mutex,
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use tauri::AppHandle;

use super::stratum_session::run_stratum_connection;
use super::submissions::{finalize_received_candidates, CANDIDATE_UNKNOWN_NOT_SUBMITTED_SHUTDOWN};
use crate::mining_events::{emit_runtime_event, emit_stopped_stats, MiningRuntimeEvent};
use crate::mining_log::log_message_for_session;
use crate::mining_settings::RealMiningSettings;
use crate::mining_state::SharedMiningState;
use crate::mining_workers::spawn_hash_workers;

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

fn sleep_until_stopped(stop: &AtomicBool, duration: Duration) {
    let deadline = Instant::now() + duration;
    while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
}
