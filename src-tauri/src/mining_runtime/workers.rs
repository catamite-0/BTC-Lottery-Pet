use std::{
    sync::{
        atomic::Ordering,
        mpsc::{SyncSender, TrySendError},
        Arc,
    },
    thread,
    time::Duration,
};

use tauri::AppHandle;

use crate::mining_block::record_block_candidate;
use crate::mining_events::{emit_runtime_event, MiningRuntimeEvent};
use crate::mining_hash::{
    build_header, build_header_work, cpu_kernel_hash_words, difficulty_from_hash, extranonce2_hex,
    found_block_event, header_work_from_header,
};
use crate::mining_log::log_message_for_session;
use crate::mining_settings::{selected_cpu_kernel_mode, CpuKernelMode, RealMiningSettings};
use crate::mining_state::{JobTemplate, ShareSubmission, SharedMiningState};

pub(crate) use btc_mining_core::BestDifficultyTracker;

struct HashWorkerContext {
    worker_index: usize,
    worker_count: usize,
    shared: Arc<SharedMiningState>,
    share_sender: SyncSender<ShareSubmission>,
    app: AppHandle,
    pool: String,
    session_id: u64,
    cpu_kernel_mode: CpuKernelMode,
}

pub(crate) fn spawn_hash_workers(
    session_id: u64,
    settings: &RealMiningSettings,
    shared: &Arc<SharedMiningState>,
    share_sender: &SyncSender<ShareSubmission>,
    app: &AppHandle,
) -> Vec<thread::JoinHandle<()>> {
    let pool = format!("{}:{}", settings.pool_host, settings.pool_port);
    let mut workers = Vec::new();

    let total_workers = settings.cpu_threads.max(1);

    // Spawn CPU workers
    for worker_index in 0..settings.cpu_threads {
        let shared = Arc::clone(shared);
        let share_sender = share_sender.clone();
        let worker_count = total_workers;
        let worker_app = app.clone();
        let worker_pool = pool.clone();
        let cpu_kernel_mode = selected_cpu_kernel_mode();

        match thread::Builder::new()
            .name(format!("btc-lottery-hash-{worker_index}"))
            .spawn(move || {
                hash_loop(HashWorkerContext {
                    worker_index,
                    worker_count,
                    shared,
                    share_sender,
                    app: worker_app,
                    pool: worker_pool,
                    session_id,
                    cpu_kernel_mode,
                })
            }) {
            Ok(handle) => workers.push(handle),
            Err(error) => log_message_for_session(
                app,
                session_id,
                &format!("Failed to start hash worker {worker_index}: {error}"),
            ),
        }
    }

    workers
}

fn hash_loop(context: HashWorkerContext) {
    let HashWorkerContext {
        worker_index,
        worker_count,
        shared,
        share_sender,
        app,
        pool,
        session_id,
        cpu_kernel_mode,
    } = context;
    let mut best_tracker = BestDifficultyTracker::new(&shared);
    let mut queue_full_drops = 0_u64;

    while !shared.stop.load(Ordering::Acquire) {
        let Some(job) = shared.job.read().unwrap_or_else(|e| e.into_inner()).clone() else {
            thread::sleep(Duration::from_millis(25));
            continue;
        };

        let share_target = crate::mining_kernel::difficulty_to_target_words(job.share_difficulty);
        let network_target = crate::mining_kernel::target_bytes_to_words(&job.network_target);
        let mut extranonce_counter = worker_index as u64 + 1;

        while !shared.stop.load(Ordering::Acquire)
            && shared.job_generation.load(Ordering::Acquire) == job.generation
        {
            let extranonce2 = extranonce2_hex(extranonce_counter, job.extranonce2_size);
            let (mut header, header_work) = match cpu_kernel_mode {
                CpuKernelMode::Midstate => match build_header_work(&job, &extranonce2) {
                    Ok(work) => (Vec::new(), work),
                    Err(error) => {
                        discard_invalid_job(&shared, &app, session_id, &job, error);
                        break;
                    }
                },
                CpuKernelMode::FullHeader => {
                    let header = match build_header(&job, &extranonce2) {
                        Ok(header) => header,
                        Err(error) => {
                            discard_invalid_job(&shared, &app, session_id, &job, error);
                            break;
                        }
                    };
                    let work = match header_work_from_header(&header) {
                        Ok(work) => work,
                        Err(error) => {
                            discard_invalid_job(&shared, &app, session_id, &job, error);
                            break;
                        }
                    };
                    (header, work)
                }
            };
            let mut midstate_hasher =
                crate::mining_kernel::ReusableMidstateHasher::new(&header_work.tail);

            let mut completed_nonce_space = true;
            for nonce in 0..=u32::MAX {
                if nonce & 0x3FF == 0 {
                    if nonce > 0 {
                        shared.hashes.fetch_add(1024, Ordering::Relaxed);
                    }
                    best_tracker.refresh(&shared);
                    if shared.stop.load(Ordering::Acquire)
                        || shared.job_generation.load(Ordering::Acquire) != job.generation
                    {
                        // Count the hashes done in this partial 1024-block
                        let partial = nonce & 0x3FF;
                        if partial > 0 {
                            shared.hashes.fetch_add(partial as u64, Ordering::Relaxed);
                        }
                        completed_nonce_space = false;
                        break;
                    }
                }

                let hash_words = cpu_kernel_hash_words(
                    cpu_kernel_mode,
                    &mut header,
                    &header_work,
                    &mut midstate_hasher,
                    nonce,
                );
                let [improves_best, meets_network, meets_share] =
                    crate::mining_kernel::hash_words_meet_three_targets(
                        &hash_words,
                        best_tracker.target_words(),
                        &network_target,
                        &share_target,
                    );
                let mut difficulty = improves_best
                    .then(|| best_tracker.record_words_improvement(&shared, &hash_words));

                if meets_network {
                    let hash = crate::mining_kernel::hash_words_to_bytes(&hash_words);
                    let difficulty = difficulty.take().unwrap_or_else(|| {
                        let difficulty = difficulty_from_hash(&hash);
                        shared.update_best_difficulty(difficulty);
                        best_tracker.refresh(&shared);
                        difficulty
                    });
                    let event =
                        found_block_event(&job, nonce, &extranonce2, &hash, difficulty, &pool);
                    record_block_candidate(&app, session_id, &event);
                }

                if meets_share {
                    best_tracker.refresh(&shared);
                    if shared.stop.load(Ordering::Acquire)
                        || shared.job_generation.load(Ordering::Acquire) != job.generation
                    {
                        completed_nonce_space = false;
                        break;
                    }

                    let submission = ShareSubmission {
                        generation: job.generation,
                        job_id: job.job_id.clone(),
                        extranonce2: extranonce2.clone(),
                        ntime: job.ntime.clone(),
                        nonce,
                    };

                    match share_sender.try_send(submission) {
                        Ok(()) => {}
                        Err(TrySendError::Full(submission)) => {
                            shared.record_queued_share_drop();
                            queue_full_drops = queue_full_drops.saturating_add(1);
                            if queue_full_drops == 1 || queue_full_drops.is_power_of_two() {
                                log_message_for_session(
                                    &app,
                                    session_id,
                                    &format!(
                                        "Share queue full; dropped share job_id={}, nonce={:08x} on worker {} (worker drops={})",
                                        submission.job_id,
                                        submission.nonce,
                                        worker_index,
                                        queue_full_drops
                                    ),
                                );
                            }
                        }
                        Err(TrySendError::Disconnected(_)) => return,
                    }
                }
            }

            // Count the final block only when the full nonce space was exhausted.
            // The loop runs nonce 0..=u32::MAX. The fetch_add(1024) fires when
            // nonce & 0x3FF == 0 and nonce > 0, so the last block of up to 1024
            // nonces (including u32::MAX itself) is never counted.
            if completed_nonce_space {
                shared.hashes.fetch_add(1024, Ordering::Relaxed);
            }

            extranonce_counter = extranonce_counter.wrapping_add(worker_count as u64);
        }
    }
}

fn discard_invalid_job(
    shared: &SharedMiningState,
    app: &AppHandle,
    session_id: u64,
    job: &JobTemplate,
    error: String,
) {
    if !shared.clear_job_if_generation(job.generation) {
        return;
    }

    shared.set_connection_status("Invalid pool job");
    let message = format!(
        "Invalid pool job discarded: job_id={}, error={error}",
        job.job_id
    );
    log_message_for_session(app, session_id, &message);
    emit_runtime_event(
        app,
        session_id,
        MiningRuntimeEvent::ConnectionStatusChanged {
            status: "Invalid Pool Job".into(),
            message,
        },
    );
}
