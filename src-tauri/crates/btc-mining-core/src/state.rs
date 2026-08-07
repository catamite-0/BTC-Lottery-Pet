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
        self.entries
            .push_back(PendingShareSubmission::new(request_id, share, submitted_at));
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
        if active_job
            .as_ref()
            .is_none_or(|job| job.generation != generation)
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

        valid_previous_jobs
            .retain(|job| job.generation != previous.generation || job.job_id != previous.job_id);
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

pub fn share_matches_current_job(shared: &SharedMiningState, share: &ShareSubmission) -> bool {
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

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        time::{Duration, Instant},
    };

    use btc_hash_cpu::target_from_nbits;

    use super::{
        share_matches_current_job, share_matches_valid_previous_job, should_submit_share,
        JobTemplate, PendingShareSubmissions, ShareSubmission, SharedMiningState,
    };

    const PENDING_SHARE_TIMEOUT: Duration = Duration::from_secs(30);

    fn pending_share(job_id: &str, nonce: u32) -> ShareSubmission {
        ShareSubmission {
            generation: 1,
            job_id: job_id.into(),
            extranonce2: "00000001".into(),
            ntime: "5f5e1000".into(),
            nonce,
        }
    }

    fn validity_test_job(job_id: &str, prev_hash: &str, clean_jobs: bool) -> JobTemplate {
        JobTemplate {
            generation: 0,
            clean_jobs,
            job_id: job_id.to_owned(),
            prev_hash: prev_hash.to_owned(),
            coinbase1: String::new(),
            coinbase2: String::new(),
            merkle_branches: Vec::new(),
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        }
    }

    fn share_for_job(job: &JobTemplate) -> ShareSubmission {
        ShareSubmission {
            generation: job.generation,
            job_id: job.job_id.clone(),
            extranonce2: "00000001".into(),
            ntime: job.ntime.clone(),
            nonce: 0,
        }
    }

    #[test]
    fn stale_share_submissions_do_not_match_current_job() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        let base_job = JobTemplate {
            generation: 0,
            clean_jobs: true,
            job_id: "job-1".into(),
            prev_hash: String::new(),
            coinbase1: String::new(),
            coinbase2: String::new(),
            merkle_branches: Vec::new(),
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };

        shared.set_job(base_job.clone());
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = ShareSubmission {
            generation: active_job.generation,
            job_id: active_job.job_id.clone(),
            extranonce2: "00000001".into(),
            ntime: active_job.ntime.clone(),
            nonce: 0,
        };

        assert!(share_matches_current_job(&shared, &active_share));
        assert!(should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 0);

        let stale_generation = ShareSubmission {
            generation: active_job.generation.saturating_sub(1),
            ..active_share.clone()
        };

        assert!(!share_matches_current_job(&shared, &stale_generation));
        assert!(!should_submit_share(&shared, &stale_generation));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);

        let mut next_job = base_job;
        next_job.job_id = "job-2".into();
        shared.set_job(next_job);

        assert!(!share_matches_current_job(&shared, &active_share));
        assert!(!should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 2);
    }

    #[test]
    fn previous_job_share_remains_valid_when_clean_jobs_is_false() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        let prev_hash = "00".repeat(32);
        shared.set_job(validity_test_job("job-1", &prev_hash, true));
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = share_for_job(&active_job);

        shared.set_job(validity_test_job("job-2", &prev_hash, false));

        assert!(!share_matches_current_job(&shared, &active_share));
        assert!(share_matches_valid_previous_job(&shared, &active_share));
        assert!(should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 0);
        assert_eq!(shared.valid_previous_jobs.lock().unwrap().len(), 1);
    }

    #[test]
    fn previous_job_share_is_stale_when_prev_hash_changes() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        shared.set_job(validity_test_job("job-1", &"00".repeat(32), true));
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = share_for_job(&active_job);

        shared.set_job(validity_test_job("job-2", &"11".repeat(32), false));

        assert!(!share_matches_valid_previous_job(&shared, &active_share));
        assert!(!should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);
        assert!(shared.valid_previous_jobs.lock().unwrap().is_empty());
    }

    #[test]
    fn previous_job_share_expires_after_grace_window() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        let prev_hash = "00".repeat(32);
        shared.set_job(validity_test_job("job-1", &prev_hash, true));
        let active_job = shared.job.read().unwrap().as_ref().unwrap().clone();
        let active_share = share_for_job(&active_job);
        shared.set_job(validity_test_job("job-2", &prev_hash, false));

        {
            let mut valid_previous_jobs = shared.valid_previous_jobs.lock().unwrap();
            assert_eq!(valid_previous_jobs.len(), 1);
            valid_previous_jobs[0].expires_at = Instant::now()
                .checked_sub(Duration::from_secs(1))
                .unwrap_or_else(Instant::now);
        }

        assert!(!share_matches_valid_previous_job(&shared, &active_share));
        assert!(shared.valid_previous_jobs.lock().unwrap().is_empty());
        assert!(!should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn queued_share_drops_are_counted_in_stats_snapshot() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        assert_eq!(shared.snapshot(7, 0.0).session_id, 7);
        assert_eq!(shared.snapshot(7, 0.0).queued_shares_dropped, 0);

        shared.record_queued_share_drop();
        shared.record_queued_share_drop();

        assert_eq!(shared.queued_shares_dropped.load(Ordering::Relaxed), 2);
        assert_eq!(shared.snapshot(7, 123.0).queued_shares_dropped, 2);
    }

    #[test]
    fn pending_share_submissions_expire_by_age() {
        let mut pending = PendingShareSubmissions::default();
        let now = Instant::now();
        pending.insert(
            11,
            pending_share("job-old", 0),
            now.checked_sub(PENDING_SHARE_TIMEOUT + Duration::from_secs(1))
                .unwrap_or(now),
        );
        pending.insert(
            12,
            pending_share("job-new", 1),
            now.checked_sub(Duration::from_secs(1)).unwrap_or(now),
        );

        let expired = pending.prune_expired(now, PENDING_SHARE_TIMEOUT);

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].request_id, 11);
        assert!(!pending.contains_id(11));
        assert!(pending.contains_id(12));
    }
}
