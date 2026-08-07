use std::{
    sync::{
        atomic::Ordering,
        mpsc::{Sender, SyncSender, TrySendError},
        Arc,
    },
    thread,
    time::Duration,
};

use tauri::AppHandle;

use crate::mining_events::{emit_runtime_event, MiningRuntimeEvent};
use crate::mining_hash::{
    build_header_work, difficulty_from_hash, extranonce2_hex, found_block_event,
};
use crate::mining_log::log_message_for_session;
#[cfg(test)]
use crate::mining_settings::CandidateSubmissionStatus;
use crate::mining_settings::{FoundBlockEvent, RealMiningSettings};
use crate::mining_state::{JobTemplate, ShareSubmission, SharedMiningState};

pub(crate) use btc_mining_core::BestDifficultyTracker;

#[derive(Clone)]
pub(crate) struct BlockCandidateSubmission {
    pub(crate) share: ShareSubmission,
    pub(crate) event: FoundBlockEvent,
}

fn solution_requires_submission(meets_share: bool, meets_network: bool) -> bool {
    meets_share || meets_network
}

fn enqueue_block_candidate(
    sender: &Sender<BlockCandidateSubmission>,
    share: ShareSubmission,
    event: FoundBlockEvent,
) -> bool {
    sender
        .send(BlockCandidateSubmission { share, event })
        .is_ok()
}

struct HashWorkerContext {
    worker_index: usize,
    worker_count: usize,
    shared: Arc<SharedMiningState>,
    share_sender: SyncSender<ShareSubmission>,
    candidate_sender: Sender<BlockCandidateSubmission>,
    app: AppHandle,
    pool: String,
    session_id: u64,
}

pub(crate) fn spawn_hash_workers(
    session_id: u64,
    settings: &RealMiningSettings,
    shared: &Arc<SharedMiningState>,
    share_sender: &SyncSender<ShareSubmission>,
    candidate_sender: &Sender<BlockCandidateSubmission>,
    app: &AppHandle,
) -> Vec<thread::JoinHandle<()>> {
    let pool = format!("{}:{}", settings.pool_host, settings.pool_port);
    let mut workers = Vec::new();

    let total_workers = settings.cpu_threads.max(1);

    // Spawn CPU workers
    for worker_index in 0..settings.cpu_threads {
        let shared = Arc::clone(shared);
        let share_sender = share_sender.clone();
        let candidate_sender = candidate_sender.clone();
        let worker_count = total_workers;
        let worker_app = app.clone();
        let worker_pool = pool.clone();

        match thread::Builder::new()
            .name(format!("btc-lottery-hash-{worker_index}"))
            .spawn(move || {
                hash_loop(HashWorkerContext {
                    worker_index,
                    worker_count,
                    shared,
                    share_sender,
                    candidate_sender,
                    app: worker_app,
                    pool: worker_pool,
                    session_id,
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
        candidate_sender,
        app,
        pool,
        session_id,
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
            let header_work = match build_header_work(&job, &extranonce2) {
                Ok(work) => work,
                Err(error) => {
                    discard_invalid_job(&shared, &app, session_id, &job, error);
                    break;
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

                let hash_words = midstate_hasher.double_sha256_words(&header_work.midstate, nonce);
                let [improves_best, meets_network, meets_share] =
                    crate::mining_kernel::hash_words_meet_three_targets(
                        &hash_words,
                        best_tracker.target_words(),
                        &network_target,
                        &share_target,
                    );
                let mut difficulty = improves_best
                    .then(|| best_tracker.record_words_improvement(&shared, &hash_words));

                let block_candidate = if meets_network {
                    let hash = crate::mining_kernel::hash_words_to_bytes(&hash_words);
                    let difficulty = difficulty.take().unwrap_or_else(|| {
                        let difficulty = difficulty_from_hash(&hash);
                        shared.update_best_difficulty(difficulty);
                        best_tracker.refresh(&shared);
                        difficulty
                    });
                    Some(found_block_event(
                        &job,
                        nonce,
                        &extranonce2,
                        &hash,
                        difficulty,
                        &pool,
                    ))
                } else {
                    None
                };

                if solution_requires_submission(meets_share, meets_network) {
                    best_tracker.refresh(&shared);
                    if block_candidate.is_none()
                        && (shared.stop.load(Ordering::Acquire)
                            || shared.job_generation.load(Ordering::Acquire) != job.generation)
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

                    if let Some(event) = block_candidate {
                        if !enqueue_block_candidate(&candidate_sender, submission, event) {
                            return;
                        }
                        continue;
                    }

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

#[cfg(test)]
mod tests {
    use std::sync::mpsc;

    use super::*;

    fn sample_share(nonce: u32) -> ShareSubmission {
        ShareSubmission {
            generation: 1,
            job_id: "job-candidate".into(),
            extranonce2: "00000001".into(),
            ntime: "5f5e1000".into(),
            nonce,
        }
    }

    fn sample_event() -> FoundBlockEvent {
        FoundBlockEvent {
            job_id: "job-candidate".into(),
            nonce: "0000002a".into(),
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

    #[test]
    fn network_solution_is_submitted_even_when_share_target_is_not_met() {
        assert!(solution_requires_submission(false, true));
        assert!(solution_requires_submission(true, false));
        assert!(solution_requires_submission(true, true));
        assert!(!solution_requires_submission(false, false));
    }

    #[test]
    fn block_candidate_bypasses_a_full_normal_share_queue() {
        let (normal_sender, _normal_receiver) = mpsc::sync_channel(1);
        assert!(normal_sender.try_send(sample_share(1)).is_ok());
        assert!(normal_sender.try_send(sample_share(2)).is_err());

        let (candidate_sender, candidate_receiver) = mpsc::channel();
        assert!(enqueue_block_candidate(
            &candidate_sender,
            sample_share(42),
            sample_event(),
        ));

        let queued = candidate_receiver.recv().unwrap();
        assert_eq!(queued.share.job_id, "job-candidate");
        assert_eq!(queued.share.nonce, 42);
        assert_eq!(queued.event.nonce, "0000002a");
    }
    #[test]
    fn best_difficulty_tracker_skips_hashes_below_current_best() {
        use btc_hash_cpu::DIFF_ONE_TARGET;
        use std::sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        };

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
}
