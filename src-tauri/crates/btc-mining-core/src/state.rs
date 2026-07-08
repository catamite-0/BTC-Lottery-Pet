use std::{
    collections::VecDeque,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::{Duration, Instant},
};

use serde::Serialize;

const MAX_VALID_PREVIOUS_JOBS: usize = 4;
const PREVIOUS_JOB_SHARE_GRACE: Duration = Duration::from_secs(60);

#[derive(Clone, Debug, Serialize)]
pub struct MiningStats {
    pub session_id: u64,
    pub hashrate: f64,
    pub accepted_shares: u64,
    pub rejected_shares: u64,
    pub stale_shares_dropped: u64,
    pub queued_shares_dropped: u64,
    pub best_difficulty: f64,
    pub share_difficulty: f64,
    pub current_job_id: String,
    pub connection_status: String,
}

impl MiningStats {
    pub fn stopped(session_id: u64) -> Self {
        Self {
            session_id,
            hashrate: 0.0,
            accepted_shares: 0,
            rejected_shares: 0,
            stale_shares_dropped: 0,
            queued_shares_dropped: 0,
            best_difficulty: 0.0,
            share_difficulty: 0.0,
            current_job_id: String::new(),
            connection_status: "Stopped".into(),
        }
    }
}

#[derive(Clone)]
pub struct JobTemplate {
    pub generation: u64,
    pub clean_jobs: bool,
    pub job_id: String,
    pub prev_hash: String,
    pub coinbase1: String,
    pub coinbase2: String,
    pub merkle_branches: Vec<String>,
    pub version: String,
    pub nbits: String,
    pub network_target: [u8; 32],
    pub ntime: String,
    pub extranonce1: String,
    pub extranonce2_size: usize,
    pub share_difficulty: f64,
}

#[derive(Clone)]
pub struct ValidPreviousJob {
    generation: u64,
    job_id: String,
    pub expires_at: Instant,
}

impl ValidPreviousJob {
    fn from_job(job: &JobTemplate, expires_at: Instant) -> Self {
        Self {
            generation: job.generation,
            job_id: job.job_id.clone(),
            expires_at,
        }
    }

    fn matches_share(&self, share: &ShareSubmission) -> bool {
        self.generation == share.generation && self.job_id == share.job_id
    }
}

#[derive(Clone)]
pub struct PendingShareSubmission {
    pub request_id: u64,
    pub share: ShareSubmission,
    submitted_at: Instant,
}

impl PendingShareSubmission {
    fn new(request_id: u64, share: ShareSubmission, submitted_at: Instant) -> Self {
        Self {
            request_id,
            share,
            submitted_at,
        }
    }

    pub fn age_at(&self, now: Instant) -> Duration {
        now.saturating_duration_since(self.submitted_at)
    }
}

#[derive(Default)]
pub struct PendingShareSubmissions {
    entries: VecDeque<PendingShareSubmission>,
}

impl PendingShareSubmissions {
    pub fn len(&self) -> usize {
        self.entries.len()
    }

    pub fn is_empty(&self) -> bool {
        self.entries.is_empty()
    }

    pub fn insert(&mut self, request_id: u64, share: ShareSubmission, submitted_at: Instant) {
        self.entries.push_back(PendingShareSubmission::new(
            request_id,
            share,
            submitted_at,
        ));
    }

    pub fn remove(&mut self, request_id: u64) -> Option<PendingShareSubmission> {
        let position = self
            .entries
            .iter()
            .position(|submission| submission.request_id == request_id)?;
        self.entries.remove(position)
    }

    pub fn contains_id(&self, request_id: u64) -> bool {
        self.entries
            .iter()
            .any(|submission| submission.request_id == request_id)
    }

    pub fn prune_expired(
        &mut self,
        now: Instant,
        timeout: Duration,
    ) -> Vec<PendingShareSubmission> {
        let mut expired = Vec::new();
        while self
            .entries
            .front()
            .is_some_and(|submission| submission.age_at(now) >= timeout)
        {
            if let Some(submission) = self.entries.pop_front() {
                expired.push(submission);
            }
        }
        expired
    }
}

pub struct SharedMiningState {
    pub stop: Arc<AtomicBool>,
    pub job: RwLock<Option<JobTemplate>>,
    pub valid_previous_jobs: Mutex<Vec<ValidPreviousJob>>,
    pub job_generation: AtomicU64,
    pub hashes: AtomicU64,
    pub accepted_shares: AtomicU64,
    pub rejected_shares: AtomicU64,
    pub stale_shares_dropped: AtomicU64,
    pub queued_shares_dropped: AtomicU64,
    pub best_difficulty_bits: AtomicU64,
    pub connection_status: Mutex<String>,
}

pub struct BestDifficultyTracker {
    target_words: [u32; 8],
}

impl BestDifficultyTracker {
    pub fn new(shared: &SharedMiningState) -> Self {
        let mut tracker = Self {
            target_words: [u32::MAX; 8],
        };
        tracker.refresh(shared);
        tracker
    }

    pub fn refresh(&mut self, shared: &SharedMiningState) {
        let current = f64::from_bits(shared.best_difficulty_bits.load(Ordering::Relaxed));
        self.target_words = if current > 0.0 && current.is_finite() {
            btc_hash_cpu::difficulty_to_target_words(current)
        } else {
            [u32::MAX; 8]
        };
    }

    pub fn target_words(&self) -> &[u32; 8] {
        &self.target_words
    }

    pub fn record_words_improvement(
        &mut self,
        shared: &SharedMiningState,
        hash_words: &[u32; 8],
    ) -> f64 {
        let hash = btc_hash_cpu::hash_words_to_bytes(hash_words);
        let difficulty = btc_hash_cpu::difficulty_from_hash(&hash);
        shared.update_best_difficulty(difficulty);
        self.refresh(shared);
        difficulty
    }
}

impl SharedMiningState {
    pub fn new(stop: Arc<AtomicBool>) -> Self {
        Self {
            stop,
            job: RwLock::new(None),
            valid_previous_jobs: Mutex::new(Vec::new()),
            job_generation: AtomicU64::new(0),
            hashes: AtomicU64::new(0),
            accepted_shares: AtomicU64::new(0),
            rejected_shares: AtomicU64::new(0),
            stale_shares_dropped: AtomicU64::new(0),
            queued_shares_dropped: AtomicU64::new(0),
            best_difficulty_bits: AtomicU64::new(0.0_f64.to_bits()),
            connection_status: Mutex::new("Starting".into()),
        }
    }

    pub fn set_connection_status(&self, status: impl Into<String>) {
        *self
            .connection_status
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = status.into();
    }

    pub fn set_job(&self, mut job: JobTemplate) {
        job.generation = self.job_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let mut active_job = self.job.write().unwrap_or_else(|e| e.into_inner());
        self.update_previous_job_validity(active_job.as_ref(), &job);
        *active_job = Some(job);
    }

    pub fn clear_job(&self) {
        self.job_generation.fetch_add(1, Ordering::AcqRel);
        *self.job.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.valid_previous_jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
    }

    pub fn clear_job_if_generation(&self, generation: u64) -> bool {
        let mut active_job = self.job.write().unwrap_or_else(|e| e.into_inner());
        if !active_job
            .as_ref()
            .is_some_and(|job| job.generation == generation)
        {
            return false;
        }

        self.job_generation.fetch_add(1, Ordering::AcqRel);
        *active_job = None;
        self.valid_previous_jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
        true
    }

    fn update_previous_job_validity(&self, previous: Option<&JobTemplate>, next: &JobTemplate) {
        let now = Instant::now();
        let mut valid_previous_jobs = self
            .valid_previous_jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        valid_previous_jobs.retain(|job| job.expires_at > now);

        if next.clean_jobs {
            valid_previous_jobs.clear();
            return;
        }

        let Some(previous) = previous else {
            return;
        };

        if previous.prev_hash != next.prev_hash {
            valid_previous_jobs.clear();
            return;
        }

        valid_previous_jobs.retain(|job| {
            job.generation != previous.generation || job.job_id != previous.job_id
        });
        valid_previous_jobs.push(ValidPreviousJob::from_job(
            previous,
            now + PREVIOUS_JOB_SHARE_GRACE,
        ));

        let overflow = valid_previous_jobs
            .len()
            .saturating_sub(MAX_VALID_PREVIOUS_JOBS);
        if overflow > 0 {
            let _ = valid_previous_jobs.drain(0..overflow);
        }
    }

    pub fn update_best_difficulty(&self, difficulty: f64) {
        let mut current = self.best_difficulty_bits.load(Ordering::Relaxed);

        while difficulty > f64::from_bits(current) {
            match self.best_difficulty_bits.compare_exchange_weak(
                current,
                difficulty.to_bits(),
                Ordering::Relaxed,
                Ordering::Relaxed,
            ) {
                Ok(_) => break,
                Err(updated) => current = updated,
            }
        }
    }

    pub fn record_queued_share_drop(&self) {
        self.queued_shares_dropped.fetch_add(1, Ordering::Relaxed);
    }

    pub fn record_stale_share_drops(&self, count: u64) {
        self.stale_shares_dropped
            .fetch_add(count, Ordering::Relaxed);
    }

    pub fn snapshot(&self, session_id: u64, hashrate: f64) -> MiningStats {
        let (current_job_id, share_difficulty) = self
            .job
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|job| (job.job_id.clone(), job.share_difficulty))
            .unwrap_or_default();

        MiningStats {
            session_id,
            hashrate,
            accepted_shares: self.accepted_shares.load(Ordering::Relaxed),
            rejected_shares: self.rejected_shares.load(Ordering::Relaxed),
            stale_shares_dropped: self.stale_shares_dropped.load(Ordering::Relaxed),
            queued_shares_dropped: self.queued_shares_dropped.load(Ordering::Relaxed),
            best_difficulty: f64::from_bits(self.best_difficulty_bits.load(Ordering::Relaxed)),
            share_difficulty,
            current_job_id,
            connection_status: self
                .connection_status
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
        }
    }
}

#[derive(Clone)]
pub struct ShareSubmission {
    pub generation: u64,
    pub job_id: String,
    pub extranonce2: String,
    pub ntime: String,
    pub nonce: u32,
}

pub fn share_matches_current_job(
    shared: &SharedMiningState,
    share: &ShareSubmission,
) -> bool {
    shared
        .job
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .is_some_and(|job| job.generation == share.generation && job.job_id == share.job_id)
}

pub fn share_matches_valid_previous_job(
    shared: &SharedMiningState,
    share: &ShareSubmission,
) -> bool {
    let now = Instant::now();
    let mut valid_previous_jobs = shared
        .valid_previous_jobs
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    valid_previous_jobs.retain(|job| job.expires_at > now);
    valid_previous_jobs
        .iter()
        .any(|job| job.matches_share(share))
}

pub fn should_submit_share(shared: &SharedMiningState, share: &ShareSubmission) -> bool {
    if share_matches_current_job(shared, share) || share_matches_valid_previous_job(shared, share) {
        return true;
    }

    shared.record_stale_share_drops(1);
    false
}
