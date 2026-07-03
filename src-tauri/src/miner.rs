use std::{
    collections::HashSet,
    io::{self, BufRead, BufReader, ErrorKind, Read, Write},
    net::{TcpStream, ToSocketAddrs},
    str::FromStr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::{self, Receiver, SyncSender, TrySendError},
        Arc, Mutex, RwLock,
    },
    thread,
    time::{Duration, Instant},
};

use bitcoin::{Address, Network};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

pub(crate) const DIFF_ONE_TARGET: f64 =
    26_959_535_291_011_309_493_156_476_344_723_991_336_010_898_738_574_164_086_137_773_096_960.0;
const MAX_STRATUM_LINE_BYTES: usize = 64 * 1024;
const MAX_EXTRANONCE2_BYTES: usize = 16;
const MAX_PENDING_SUBMISSIONS: usize = 128;
const MAX_SHARE_SUBMISSIONS_PER_TICK: usize = 16;
const SHARE_QUEUE_CAPACITY: usize = 256;
const MAX_VALID_PREVIOUS_JOBS: usize = 4;
const PREVIOUS_JOB_SHARE_GRACE: Duration = Duration::from_secs(60);
const DEFAULT_POOL_PASSWORD: &str = "x";
const MAX_POOL_PASSWORD_BYTES: usize = 128;
// Below this, the share target saturates the full 256-bit hash space and every
// nonce qualifies. Treat that as a misconfigured pool rather than flooding the
// share path.
const MIN_SHARE_DIFFICULTY: f64 = 1e-9;
const MAX_LOG_FILE_BYTES: u64 = 1024 * 1024;
const STATS_EVENT: &str = "mining-stats";
const BLOCK_FOUND_EVENT: &str = "block-found";
const DIAGNOSTIC_READ_TIMEOUT: Duration = Duration::from_millis(250);
const DIAGNOSTIC_RESPONSE_TIMEOUT: Duration = Duration::from_secs(8);
const DIAGNOSTIC_JOB_TIMEOUT: Duration = Duration::from_secs(15);

pub(crate) fn log_message(app: &AppHandle, message: &str) {
    let _ = app.emit("mining-log", message);

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

fn should_rotate_log(current_bytes: u64, incoming_bytes: usize) -> bool {
    current_bytes.saturating_add(incoming_bytes as u64) > MAX_LOG_FILE_BYTES
}

#[derive(Clone, Copy, Debug, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum CpuKernelMode {
    #[default]
    Midstate,
    FullHeader,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RealMiningSettings {
    pub pool_host: String,
    pub pool_port: u16,
    #[serde(default)]
    pub pool_password: String,
    pub btc_address: String,
    pub worker_name: String,
    pub cpu_threads: usize,
    pub confirmed_cpu_use: bool,
    #[serde(default)]
    pub gpu_enabled: bool,
    #[serde(default)]
    pub gpu_device_id: Option<String>,
    #[serde(default = "default_gpu_intensity")]
    pub gpu_intensity_percent: u8,
    #[serde(default)]
    pub cpu_kernel_mode: CpuKernelMode,
}

fn default_gpu_intensity() -> u8 {
    10
}

impl RealMiningSettings {
    fn validate(&self) -> Result<(), String> {
        if !self.confirmed_cpu_use {
            return Err("real mining requires an explicit CPU-use confirmation".into());
        }

        if self.pool_host.is_empty()
            || self.pool_host.chars().any(char::is_whitespace)
            || self.pool_host.contains("://")
            || self.pool_host.contains('/')
        {
            return Err("pool host must be a hostname without a URL scheme or path".into());
        }

        if self.pool_port == 0 {
            return Err("pool port must be greater than zero".into());
        }

        validate_pool_password(&self.pool_password)?;
        validate_mainnet_address(self.btc_address.trim())?;

        if self.worker_name.is_empty()
            || self
                .worker_name
                .chars()
                .any(|character| !(character.is_ascii_alphanumeric() || "-_".contains(character)))
        {
            return Err(
                "worker name may contain only letters, numbers, dashes, and underscores".into(),
            );
        }

        let available_threads = thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1);

        if self.cpu_threads > available_threads {
            return Err(format!(
                "CPU threads must be between 0 and {available_threads} on this computer"
            ));
        }
        if !self.gpu_enabled && self.cpu_threads == 0 {
            return Err("CPU threads must be at least 1 when GPU is disabled".into());
        }

        Ok(())
    }

    fn username(&self) -> String {
        format!("{}.{}", self.btc_address.trim(), self.worker_name)
    }

    fn pool_password(&self) -> String {
        normalize_pool_password(&self.pool_password)
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PoolDiagnosticSettings {
    pub pool_host: String,
    pub pool_port: u16,
    #[serde(default)]
    pub pool_password: String,
    pub btc_address: String,
    pub worker_name: String,
}

impl PoolDiagnosticSettings {
    fn normalized(&self) -> Self {
        Self {
            pool_host: self.pool_host.trim().to_owned(),
            pool_port: self.pool_port,
            pool_password: normalize_pool_password(&self.pool_password),
            btc_address: self.btc_address.trim().to_owned(),
            worker_name: self.worker_name.trim().to_owned(),
        }
    }

    fn validate_basic(&self) -> Result<(), String> {
        if self.pool_host.is_empty()
            || self.pool_host.chars().any(char::is_whitespace)
            || self.pool_host.contains("://")
            || self.pool_host.contains('/')
        {
            return Err("pool host must be a hostname without a URL scheme or path".into());
        }

        if self.pool_port == 0 {
            return Err("pool port must be greater than zero".into());
        }

        validate_pool_password(&self.pool_password)?;

        if !self.btc_address.is_empty() {
            validate_mainnet_address(&self.btc_address)?;
        }

        if self.worker_name.is_empty()
            || self
                .worker_name
                .chars()
                .any(|character| !(character.is_ascii_alphanumeric() || "-_".contains(character)))
        {
            return Err(
                "worker name may contain only letters, numbers, dashes, and underscores".into(),
            );
        }

        Ok(())
    }

    fn username(&self) -> String {
        format!("{}.{}", self.btc_address, self.worker_name)
    }

    fn pool_password(&self) -> String {
        normalize_pool_password(&self.pool_password)
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct PoolDiagnosticStep {
    pub name: String,
    pub status: String,
    pub message: String,
    pub duration_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct PoolDiagnosticReport {
    pub generated_at: String,
    pub pool: String,
    pub steps: Vec<PoolDiagnosticStep>,
    pub summary: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct MiningStats {
    pub hashrate: f64,
    pub accepted_shares: u64,
    pub rejected_shares: u64,
    pub stale_shares_dropped: u64,
    pub queued_shares_dropped: u64,
    pub best_difficulty: f64,
    pub share_difficulty: f64,
    pub current_job_id: String,
    pub connection_status: String,
    pub gpu_backend: String,
    pub gpu_device_name: String,
    pub gpu_dispatch_size: u64,
    pub gpu_dispatch_ms: u64,
    pub gpu_throttle_ms: u64,
}

#[derive(Clone, Debug, Serialize)]
pub struct FoundBlockEvent {
    pub job_id: String,
    pub nonce: String,
    pub ntime: String,
    pub extranonce2: String,
    pub hash: String,
    pub difficulty: f64,
    pub timestamp: String,
    pub pool: String,
}

impl MiningStats {
    fn stopped() -> Self {
        Self {
            hashrate: 0.0,
            accepted_shares: 0,
            rejected_shares: 0,
            stale_shares_dropped: 0,
            queued_shares_dropped: 0,
            best_difficulty: 0.0,
            share_difficulty: 0.0,
            current_job_id: String::new(),
            connection_status: "Stopped".into(),
            gpu_backend: String::new(),
            gpu_device_name: String::new(),
            gpu_dispatch_size: 0,
            gpu_dispatch_ms: 0,
            gpu_throttle_ms: 0,
        }
    }
}

#[derive(Default)]
pub struct MiningController {
    stop_signal: Mutex<Option<Arc<AtomicBool>>>,
}

impl MiningController {
    pub fn start(&self, app: AppHandle, settings: RealMiningSettings) -> Result<(), String> {
        settings.validate()?;
        self.stop(&app);

        let stop = Arc::new(AtomicBool::new(false));
        let worker_stop = Arc::clone(&stop);
        let worker_app = app.clone();

        thread::Builder::new()
            .name("btc-lottery-stratum".into())
            .spawn(move || run_miner(worker_app, settings, worker_stop))
            .map_err(|error| format!("failed to start Stratum worker: {error}"))?;

        *self.stop_signal.lock().unwrap_or_else(|e| e.into_inner()) = Some(stop);
        Ok(())
    }

    pub fn stop(&self, app: &AppHandle) {
        if let Some(stop) = self
            .stop_signal
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .take()
        {
            log_message(app, "Mining stop requested");
            stop.store(true, Ordering::Release);
        }

        let _ = app.emit(STATS_EVENT, MiningStats::stopped());
    }
}

#[derive(Clone)]
pub(crate) struct JobTemplate {
    pub(crate) generation: u64,
    pub(crate) clean_jobs: bool,
    pub(crate) job_id: String,
    pub(crate) prev_hash: String,
    pub(crate) coinbase1: String,
    pub(crate) coinbase2: String,
    pub(crate) merkle_branches: Vec<String>,
    pub(crate) version: String,
    pub(crate) nbits: String,
    pub(crate) network_target: [u8; 32],
    pub(crate) ntime: String,
    pub(crate) extranonce1: String,
    pub(crate) extranonce2_size: usize,
    pub(crate) share_difficulty: f64,
}

#[derive(Clone)]
pub(crate) struct ValidPreviousJob {
    generation: u64,
    job_id: String,
    expires_at: Instant,
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
pub(crate) struct SharedMiningState {
    pub(crate) stop: Arc<AtomicBool>,
    pub(crate) job: RwLock<Option<JobTemplate>>,
    pub(crate) valid_previous_jobs: Mutex<Vec<ValidPreviousJob>>,
    pub(crate) job_generation: AtomicU64,
    pub(crate) hashes: AtomicU64,
    pub(crate) accepted_shares: AtomicU64,
    pub(crate) rejected_shares: AtomicU64,
    pub(crate) stale_shares_dropped: AtomicU64,
    pub(crate) queued_shares_dropped: AtomicU64,
    pub(crate) best_difficulty_bits: AtomicU64,
    pub(crate) connection_status: Mutex<String>,
    pub(crate) gpu_backend: Mutex<String>,
    pub(crate) gpu_device_name: Mutex<String>,
    pub(crate) gpu_dispatch_size: AtomicU64,
    pub(crate) gpu_dispatch_ms: AtomicU64,
    pub(crate) gpu_throttle_ms: AtomicU64,
}

impl SharedMiningState {
    pub(crate) fn new(stop: Arc<AtomicBool>) -> Self {
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
            gpu_backend: Mutex::new(String::new()),
            gpu_device_name: Mutex::new(String::new()),
            gpu_dispatch_size: AtomicU64::new(0),
            gpu_dispatch_ms: AtomicU64::new(0),
            gpu_throttle_ms: AtomicU64::new(0),
        }
    }

    pub(crate) fn set_connection_status(&self, status: impl Into<String>) {
        *self
            .connection_status
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = status.into();
    }

    pub(crate) fn set_gpu_runtime(
        &self,
        backend: impl Into<String>,
        device_name: impl Into<String>,
    ) {
        *self.gpu_backend.lock().unwrap_or_else(|e| e.into_inner()) = backend.into();
        *self
            .gpu_device_name
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = device_name.into();
    }

    pub(crate) fn set_gpu_dispatch_stats(
        &self,
        dispatch_size: u64,
        dispatch_ms: u64,
        throttle_ms: u64,
    ) {
        self.gpu_dispatch_size
            .store(dispatch_size, Ordering::Relaxed);
        self.gpu_dispatch_ms.store(dispatch_ms, Ordering::Relaxed);
        self.gpu_throttle_ms.store(throttle_ms, Ordering::Relaxed);
    }

    pub(crate) fn set_job(&self, mut job: JobTemplate) {
        job.generation = self.job_generation.fetch_add(1, Ordering::AcqRel) + 1;
        let mut active_job = self.job.write().unwrap_or_else(|e| e.into_inner());
        self.update_previous_job_validity(active_job.as_ref(), &job);
        *active_job = Some(job);
    }

    pub(crate) fn clear_job(&self) {
        self.job_generation.fetch_add(1, Ordering::AcqRel);
        *self.job.write().unwrap_or_else(|e| e.into_inner()) = None;
        self.valid_previous_jobs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clear();
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
    pub(crate) fn update_best_difficulty(&self, difficulty: f64) {
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

    pub(crate) fn record_queued_share_drop(&self) {
        self.queued_shares_dropped.fetch_add(1, Ordering::Relaxed);
    }

    fn snapshot(&self, hashrate: f64) -> MiningStats {
        let (current_job_id, share_difficulty) = self
            .job
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
            .map(|job| (job.job_id.clone(), job.share_difficulty))
            .unwrap_or_default();

        MiningStats {
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
            gpu_backend: self
                .gpu_backend
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            gpu_device_name: self
                .gpu_device_name
                .lock()
                .unwrap_or_else(|e| e.into_inner())
                .clone(),
            gpu_dispatch_size: self.gpu_dispatch_size.load(Ordering::Relaxed),
            gpu_dispatch_ms: self.gpu_dispatch_ms.load(Ordering::Relaxed),
            gpu_throttle_ms: self.gpu_throttle_ms.load(Ordering::Relaxed),
        }
    }
}

#[derive(Clone)]
pub(crate) struct ShareSubmission {
    pub(crate) generation: u64,
    pub(crate) job_id: String,
    pub(crate) extranonce2: String,
    pub(crate) ntime: String,
    pub(crate) nonce: u32,
}

#[derive(Default)]
struct ProtocolState {
    extranonce1: Option<String>,
    extranonce2_size: Option<usize>,
    difficulty: f64,
}

fn run_miner(app: AppHandle, settings: RealMiningSettings, stop: Arc<AtomicBool>) {
    let shared = Arc::new(SharedMiningState::new(Arc::clone(&stop)));
    let (share_sender, share_receiver) = mpsc::sync_channel(SHARE_QUEUE_CAPACITY);
    let workers = spawn_hash_workers(&settings, &shared, &share_sender, &app);

    while !stop.load(Ordering::Acquire) {
        shared.set_connection_status("Connecting");

        if let Err(error) = run_stratum_connection(&app, &settings, &shared, &share_receiver) {
            if stop.load(Ordering::Acquire) {
                break;
            }

            shared.clear_job();
            shared.set_connection_status(format!("Retrying: {error}"));
            log_message(
                &app,
                &format!("Connection error: {}. Retrying in 2s...", error),
            );
            sleep_until_stopped(&stop, Duration::from_secs(2));
        }
    }

    stop.store(true, Ordering::Release);
    for worker in workers {
        let _ = worker.join();
    }

    shared.clear_job();
    shared.set_connection_status("Stopped");
    log_message(&app, "Mining stopped");
}

fn run_stratum_connection(
    app: &AppHandle,
    settings: &RealMiningSettings,
    shared: &Arc<SharedMiningState>,
    share_receiver: &Receiver<ShareSubmission>,
) -> Result<(), String> {
    let address = format!("{}:{}", settings.pool_host, settings.pool_port);
    let socket_addresses = address
        .to_socket_addrs()
        .map_err(|error| format!("DNS failed for {}: {error}", settings.pool_host))?
        .collect::<Vec<_>>();
    let mut stream = connect_to_pool(&address, &socket_addresses)?;
    log_message(app, "Connected to pool");

    stream
        .set_read_timeout(Some(Duration::from_millis(200)))
        .map_err(|error| format!("failed to set socket read timeout: {error}"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|error| format!("failed to set socket write timeout: {error}"))?;

    let reader_stream = stream
        .try_clone()
        .map_err(|error| format!("failed to initialize socket reader: {error}"))?;
    let mut reader = BufReader::new(reader_stream);
    let username = settings.username();
    let pool_password = settings.pool_password();
    let mut protocol = ProtocolState {
        difficulty: 0.001,
        ..ProtocolState::default()
    };
    let mut pending_submissions = HashSet::new();
    let mut request_id = 10_u64;
    let mut last_report = Instant::now();
    let mut last_hash_count = shared.hashes.load(Ordering::Relaxed);

    shared.set_connection_status("Subscribing");
    while share_receiver.try_recv().is_ok() {}
    write_message(
        &mut stream,
        &json!({
            "id": 1,
            "method": "mining.subscribe",
            "params": [format!("BTC Lottery Pet/{}", env!("CARGO_PKG_VERSION"))]
        }),
    )?;
    write_message(
        &mut stream,
        &json!({
            "id": 2,
            "method": "mining.authorize",
            "params": [username.clone(), pool_password]
        }),
    )?;

    let mut last_job_received = Instant::now();
    let mut debug_hint_logged = false;
    let mut smoothed_hashrate: f64 = 0.0;
    let mut last_activity = Instant::now();

    while !shared.stop.load(Ordering::Acquire) {
        if last_activity.elapsed() >= Duration::from_secs(300) {
            return Err("no message received from pool for 5 minutes".into());
        }

        let has_job = shared
            .job
            .read()
            .unwrap_or_else(|e| e.into_inner())
            .is_some();
        if has_job {
            last_job_received = Instant::now();
            debug_hint_logged = false;
        } else if !debug_hint_logged && last_job_received.elapsed() >= Duration::from_secs(20) {
            log_message(app, "[Warning] No jobs received yet. Verify your pool address, port, BTC address, and network firewall settings.");
            debug_hint_logged = true;
        }

        for _ in 0..submission_budget(pending_submissions.len()) {
            if shared.stop.load(Ordering::Acquire) {
                break;
            }

            let Ok(share) = share_receiver.try_recv() else {
                break;
            };

            if !should_submit_share(shared, &share) {
                log_message(
                    app,
                    &format!(
                        "Stale share dropped before submit: job_id={}, nonce={:08x}",
                        share.job_id, share.nonce
                    ),
                );
                continue;
            }

            request_id += 1;

            // Prune stale entries to prevent unbounded growth from unresponsive pools
            if pending_submissions.len() > 64 {
                let threshold = request_id.saturating_sub(64);
                pending_submissions.retain(|&id| id > threshold);
            }

            log_message(
                app,
                &format!(
                    "Share submitted: job_id={}, nonce={:08x}",
                    share.job_id, share.nonce
                ),
            );
            write_message(
                &mut stream,
                &json!({
                    "id": request_id,
                    "method": "mining.submit",
                    "params": [
                        username,
                        share.job_id,
                        share.extranonce2,
                        share.ntime,
                        format!("{:08x}", share.nonce)
                    ]
                }),
            )?;
            pending_submissions.insert(request_id);
        }

        match read_stratum_line(&mut reader) {
            Ok(None) => return Err(format!("pool {address} closed the connection")),
            Ok(Some(line)) => {
                last_activity = Instant::now();
                handle_server_message(
                    app,
                    line.trim(),
                    &mut protocol,
                    shared,
                    &mut pending_submissions,
                )?;
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }

        if last_report.elapsed() >= Duration::from_secs(1) {
            let elapsed = last_report.elapsed().as_secs_f64();
            let current_hash_count = shared.hashes.load(Ordering::Relaxed);
            let raw_hashrate = current_hash_count.saturating_sub(last_hash_count) as f64 / elapsed;
            // Exponential moving average for smooth display (ÃŽÂ± = 0.3)
            smoothed_hashrate = if smoothed_hashrate == 0.0 {
                raw_hashrate
            } else {
                0.3 * raw_hashrate + 0.7 * smoothed_hashrate
            };
            emit_stats(app, shared, smoothed_hashrate);
            last_hash_count = current_hash_count;
            last_report = Instant::now();
        }
    }

    Ok(())
}

pub(crate) fn diagnose_pool_connection(settings: PoolDiagnosticSettings) -> PoolDiagnosticReport {
    let settings = settings.normalized();
    let pool = format!("{}:{}", settings.pool_host, settings.pool_port);
    let mut report = PoolDiagnosticReport {
        generated_at: chrono::Utc::now().to_rfc3339(),
        pool: pool.clone(),
        steps: Vec::new(),
        summary: String::new(),
    };

    let validate_start = Instant::now();
    if let Err(error) = settings.validate_basic() {
        report.steps.push(diagnostic_step(
            "CONFIG",
            "failed",
            error.clone(),
            validate_start.elapsed(),
        ));
        report.summary = format!("Configuration check failed: {error}");
        return report;
    }
    report.steps.push(diagnostic_step(
        "CONFIG",
        "ok",
        "Local pool settings look valid.",
        validate_start.elapsed(),
    ));

    let dns_start = Instant::now();
    let socket_addresses = match pool.to_socket_addrs() {
        Ok(addresses) => addresses.collect::<Vec<_>>(),
        Err(error) => {
            report.steps.push(diagnostic_step(
                "DNS",
                "failed",
                format!("DNS failed for {}: {error}", settings.pool_host),
                dns_start.elapsed(),
            ));
            report.summary = "DNS lookup failed for the configured pool.".into();
            return report;
        }
    };
    if socket_addresses.is_empty() {
        report.steps.push(diagnostic_step(
            "DNS",
            "failed",
            format!("No address found for {}", settings.pool_host),
            dns_start.elapsed(),
        ));
        report.summary = "DNS lookup returned no usable address.".into();
        return report;
    }
    report.steps.push(diagnostic_step(
        "DNS",
        "ok",
        format!("Resolved {} address(es).", socket_addresses.len()),
        dns_start.elapsed(),
    ));

    let tcp_start = Instant::now();
    let mut stream = match connect_to_pool(&pool, &socket_addresses) {
        Ok(stream) => stream,
        Err(error) => {
            report.steps.push(diagnostic_step(
                "TCP",
                "failed",
                error.clone(),
                tcp_start.elapsed(),
            ));
            report.summary =
                "TCP connection failed. Check the pool port, firewall, or network.".into();
            return report;
        }
    };
    if let Err(error) = stream.set_read_timeout(Some(DIAGNOSTIC_READ_TIMEOUT)) {
        report.steps.push(diagnostic_step(
            "TCP",
            "failed",
            format!("Connected, but failed to set socket read timeout: {error}"),
            tcp_start.elapsed(),
        ));
        report.summary = "TCP connection setup failed after connecting.".into();
        return report;
    }
    if let Err(error) = stream.set_write_timeout(Some(Duration::from_secs(2))) {
        report.steps.push(diagnostic_step(
            "TCP",
            "failed",
            format!("Connected, but failed to set socket write timeout: {error}"),
            tcp_start.elapsed(),
        ));
        report.summary = "TCP connection setup failed after connecting.".into();
        return report;
    }
    let reader_stream = match stream.try_clone() {
        Ok(stream) => stream,
        Err(error) => {
            report.steps.push(diagnostic_step(
                "TCP",
                "failed",
                format!("Connected, but failed to initialize socket reader: {error}"),
                tcp_start.elapsed(),
            ));
            report.summary = "TCP connection setup failed after connecting.".into();
            return report;
        }
    };
    let mut reader = BufReader::new(reader_stream);
    report.steps.push(diagnostic_step(
        "TCP",
        "ok",
        "Connected to the pool TCP endpoint.",
        tcp_start.elapsed(),
    ));

    let subscribe_start = Instant::now();
    if let Err(error) = write_message(
        &mut stream,
        &json!({
            "id": 1,
            "method": "mining.subscribe",
            "params": [format!("BTC Lottery Pet/{}", env!("CARGO_PKG_VERSION"))]
        }),
    ) {
        report.steps.push(diagnostic_step(
            "SUBSCRIBE",
            "failed",
            error.clone(),
            subscribe_start.elapsed(),
        ));
        report.summary = "Could not send mining.subscribe to the pool.".into();
        return report;
    }
    let subscribe_message =
        match read_until_diagnostic_message(&mut reader, DIAGNOSTIC_RESPONSE_TIMEOUT, |message| {
            message.get("id").and_then(Value::as_u64) == Some(1)
        }) {
            Ok(message) => message,
            Err(error) => {
                report.steps.push(diagnostic_step(
                    "SUBSCRIBE",
                    "failed",
                    error.clone(),
                    subscribe_start.elapsed(),
                ));
                report.summary = "The pool did not complete mining.subscribe.".into();
                return report;
            }
        };
    let (extranonce1, extranonce2_size) = match diagnostic_subscribe_result(&subscribe_message) {
        Ok(result) => result,
        Err(error) => {
            report.steps.push(diagnostic_step(
                "SUBSCRIBE",
                "failed",
                error.clone(),
                subscribe_start.elapsed(),
            ));
            report.summary = error;
            return report;
        }
    };
    report.steps.push(diagnostic_step(
        "SUBSCRIBE",
        "ok",
        "Pool accepted mining.subscribe.",
        subscribe_start.elapsed(),
    ));

    if settings.btc_address.is_empty() {
        report.steps.push(diagnostic_step(
            "AUTHORIZE",
            "skipped",
            "Add a BTC address to test mining.authorize.",
            Duration::ZERO,
        ));
        report.steps.push(diagnostic_step(
            "JOB",
            "skipped",
            "Authorization was skipped, so job delivery was not tested.",
            Duration::ZERO,
        ));
        report.summary = "Network and subscribe checks passed. Add a BTC address to test authorization and job delivery.".into();
        return report;
    }

    let authorize_start = Instant::now();
    if let Err(error) = write_message(
        &mut stream,
        &json!({
            "id": 2,
            "method": "mining.authorize",
            "params": [settings.username(), settings.pool_password()]
        }),
    ) {
        report.steps.push(diagnostic_step(
            "AUTHORIZE",
            "failed",
            error.clone(),
            authorize_start.elapsed(),
        ));
        report.summary = "Could not send mining.authorize to the pool.".into();
        return report;
    }
    let authorize_message =
        match read_until_diagnostic_message(&mut reader, DIAGNOSTIC_RESPONSE_TIMEOUT, |message| {
            message.get("id").and_then(Value::as_u64) == Some(2)
        }) {
            Ok(message) => message,
            Err(error) => {
                report.steps.push(diagnostic_step(
                    "AUTHORIZE",
                    "failed",
                    error.clone(),
                    authorize_start.elapsed(),
                ));
                report.summary = "The pool did not complete mining.authorize.".into();
                return report;
            }
        };
    if let Err(error) = diagnostic_authorize_result(&authorize_message) {
        report.steps.push(diagnostic_step(
            "AUTHORIZE",
            "failed",
            error.clone(),
            authorize_start.elapsed(),
        ));
        report.summary = error;
        return report;
    }
    report.steps.push(diagnostic_step(
        "AUTHORIZE",
        "ok",
        "Pool accepted the configured worker.",
        authorize_start.elapsed(),
    ));

    let job_start = Instant::now();
    let mut protocol = ProtocolState {
        difficulty: 0.001,
        extranonce1: Some(extranonce1),
        extranonce2_size: Some(extranonce2_size),
    };
    match wait_for_diagnostic_job(&mut reader, &mut protocol, DIAGNOSTIC_JOB_TIMEOUT) {
        Ok((job_id, share_difficulty)) => {
            report.steps.push(diagnostic_step(
                "JOB",
                "ok",
                format!(
                    "Received mining.notify job {job_id} at share difficulty {share_difficulty}."
                ),
                job_start.elapsed(),
            ));
            report.summary = "Pool connection diagnostic passed.".into();
        }
        Err(error) => {
            report.steps.push(diagnostic_step(
                "JOB",
                "failed",
                error.clone(),
                job_start.elapsed(),
            ));
            report.summary = "Authorization passed, but no mining job was received.".into();
        }
    }

    report
}

fn diagnostic_step(
    name: &str,
    status: &str,
    message: impl Into<String>,
    duration: Duration,
) -> PoolDiagnosticStep {
    PoolDiagnosticStep {
        name: name.to_owned(),
        status: status.to_owned(),
        message: message.into(),
        duration_ms: duration.as_millis().min(u64::MAX as u128) as u64,
    }
}

fn diagnostic_subscribe_result(message: &Value) -> Result<(String, usize), String> {
    let result = message
        .get("result")
        .and_then(Value::as_array)
        .ok_or_else(|| {
            pool_response_error(message)
                .map(|reason| format!("pool rejected mining.subscribe: {reason}"))
                .unwrap_or_else(|| "pool returned an invalid mining.subscribe response".into())
        })?;

    let extranonce1 = result
        .get(1)
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| "pool returned an incomplete mining.subscribe response".to_string())?;
    let extranonce2_size = result
        .get(2)
        .and_then(Value::as_u64)
        .ok_or_else(|| "pool returned an incomplete mining.subscribe response".to_string())
        .and_then(|size| validate_extranonce2_size(size as usize))?;

    Ok((extranonce1, extranonce2_size))
}

fn diagnostic_authorize_result(message: &Value) -> Result<(), String> {
    if message.get("result").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }

    let reason =
        pool_response_error(message).unwrap_or_else(|| "authorization returned false".into());
    Err(format!("pool rejected mining.authorize: {reason}"))
}

fn read_until_diagnostic_message(
    reader: &mut impl BufRead,
    timeout: Duration,
    matches_message: impl Fn(&Value) -> bool,
) -> Result<Value, String> {
    let deadline = Instant::now() + timeout;

    loop {
        if Instant::now() >= deadline {
            return Err(format!("timed out after {} seconds", timeout.as_secs()));
        }

        match read_stratum_line(reader) {
            Ok(None) => return Err("pool closed the connection".into()),
            Ok(Some(line)) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }

                let message: Value = serde_json::from_str(trimmed)
                    .map_err(|error| format!("invalid Stratum JSON: {error}"))?;
                if matches_message(&message) {
                    return Ok(message);
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }
    }
}

fn wait_for_diagnostic_job(
    reader: &mut impl BufRead,
    protocol: &mut ProtocolState,
    timeout: Duration,
) -> Result<(String, f64), String> {
    let shared = Arc::new(SharedMiningState::new(Arc::new(AtomicBool::new(false))));
    let mut pending_submissions = HashSet::new();
    let deadline = Instant::now() + timeout;

    loop {
        if Instant::now() >= deadline {
            return Err(format!(
                "no mining.notify job received within {} seconds",
                timeout.as_secs()
            ));
        }

        match read_stratum_line(reader) {
            Ok(None) => return Err("pool closed the connection before sending a job".into()),
            Ok(Some(line)) => {
                handle_server_message_with_logger(
                    line.trim(),
                    protocol,
                    &shared,
                    &mut pending_submissions,
                    |_| {},
                )?;

                if let Some(job) = shared
                    .job
                    .read()
                    .unwrap_or_else(|error| error.into_inner())
                    .as_ref()
                {
                    return Ok((job.job_id.clone(), job.share_difficulty));
                }
            }
            Err(error) if matches!(error.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {}
            Err(error) => return Err(format!("socket read failed: {error}")),
        }
    }
}

fn handle_server_message(
    app: &AppHandle,
    line: &str,
    protocol: &mut ProtocolState,
    shared: &Arc<SharedMiningState>,
    pending_submissions: &mut HashSet<u64>,
) -> Result<(), String> {
    handle_server_message_with_logger(line, protocol, shared, pending_submissions, |message| {
        log_message(app, message)
    })
}

fn handle_server_message_with_logger(
    line: &str,
    protocol: &mut ProtocolState,
    shared: &Arc<SharedMiningState>,
    pending_submissions: &mut HashSet<u64>,
    mut log: impl FnMut(&str),
) -> Result<(), String> {
    if line.is_empty() {
        return Ok(());
    }

    let message: Value =
        serde_json::from_str(line).map_err(|error| format!("invalid Stratum JSON: {error}"))?;

    if let Some(method) = message.get("method").and_then(Value::as_str) {
        match method {
            "mining.set_difficulty" => {
                let difficulty = value_as_f64(&message["params"][0])
                    .ok_or_else(|| "pool sent an invalid share difficulty".to_string())?;
                protocol.difficulty = validate_share_difficulty(difficulty)?;
                log(&format!("Pool set share difficulty: {difficulty}"));
            }
            "mining.set_extranonce" => {
                protocol.extranonce1 = message["params"][0].as_str().map(str::to_owned);
                protocol.extranonce2_size = message["params"][1]
                    .as_u64()
                    .map(|size| validate_extranonce2_size(size as usize))
                    .transpose()?;
                shared.clear_job();
            }
            "mining.notify" => {
                if let Some(job) = parse_job(message.get("params"), protocol)? {
                    let job_id = job.job_id.clone();
                    let diff = job.share_difficulty;
                    let clean_jobs = job.clean_jobs;
                    shared.set_job(job);
                    shared.set_connection_status("Mining");
                    log(&format!(
                        "Job received: id={}, diff={}, clean_jobs={}",
                        job_id, diff, clean_jobs
                    ));
                }
            }
            _ => {}
        }

        return Ok(());
    }

    let Some(id) = message.get("id").and_then(Value::as_u64) else {
        return Ok(());
    };

    if id == 1 {
        let result = message
            .get("result")
            .and_then(Value::as_array)
            .ok_or_else(|| {
                pool_response_error(&message)
                    .map(|reason| format!("pool rejected mining.subscribe: {reason}"))
                    .unwrap_or_else(|| "pool returned an invalid mining.subscribe response".into())
            })?;
        protocol.extranonce1 = result.get(1).and_then(Value::as_str).map(str::to_owned);
        protocol.extranonce2_size = result
            .get(2)
            .and_then(Value::as_u64)
            .map(|size| validate_extranonce2_size(size as usize))
            .transpose()?;

        if protocol.extranonce1.is_none() || protocol.extranonce2_size.is_none() {
            return Err("pool returned an incomplete mining.subscribe response".into());
        }

        shared.set_connection_status("Authorizing");
    } else if id == 2 {
        if message.get("result").and_then(Value::as_bool) != Some(true) {
            let reason = pool_response_error(&message)
                .unwrap_or_else(|| "authorization returned false".into());
            return Err(format!("pool rejected mining.authorize: {reason}"));
        }

        shared.set_connection_status("Authorized");
        log("Worker authorized successfully");
    } else if pending_submissions.remove(&id) {
        if message.get("result").and_then(Value::as_bool) == Some(true) {
            shared.accepted_shares.fetch_add(1, Ordering::Relaxed);
            log("Share accepted!");
        } else {
            shared.rejected_shares.fetch_add(1, Ordering::Relaxed);
            let err_str = message
                .get("error")
                .map(|e| e.to_string())
                .unwrap_or_else(|| "unknown error".to_string());
            log(&format!("Share rejected. Reason: {}", err_str));
        }
    }

    Ok(())
}

fn pool_response_error(message: &Value) -> Option<String> {
    if let Some(error) = message.get("error") {
        if !error.is_null() {
            return Some(error.to_string());
        }
    }

    message
        .get("result")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|reason| !reason.is_empty())
        .map(str::to_owned)
}

fn parse_job(
    params: Option<&Value>,
    protocol: &ProtocolState,
) -> Result<Option<JobTemplate>, String> {
    let Some(params) = params.and_then(Value::as_array) else {
        return Err("pool sent mining.notify without params".into());
    };

    if params.len() < 9 {
        return Err("pool sent an incomplete mining.notify job".into());
    }

    let Some(extranonce1) = protocol.extranonce1.clone() else {
        return Ok(None);
    };
    let Some(extranonce2_size) = protocol.extranonce2_size else {
        return Ok(None);
    };

    let merkle_branches = params[4]
        .as_array()
        .ok_or_else(|| "pool sent invalid merkle branches".to_string())?
        .iter()
        .map(|branch| {
            branch
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| "pool sent a non-string merkle branch".to_string())
        })
        .collect::<Result<Vec<_>, _>>()?;

    if merkle_branches.len() > 64 {
        return Err("pool sent too many merkle branches".into());
    }

    let nbits = required_string(params, 6, "nbits")?;
    let network_target = target_from_nbits(&nbits)?;
    let clean_jobs = params[8]
        .as_bool()
        .ok_or_else(|| "pool sent an invalid clean_jobs flag".to_string())?;

    Ok(Some(JobTemplate {
        generation: 0,
        clean_jobs,
        job_id: required_string(params, 0, "job id")?,
        prev_hash: required_string(params, 1, "previous hash")?,
        coinbase1: required_string(params, 2, "coinbase prefix")?,
        coinbase2: required_string(params, 3, "coinbase suffix")?,
        merkle_branches,
        version: required_string(params, 5, "version")?,
        nbits,
        network_target,
        ntime: required_string(params, 7, "ntime")?,
        extranonce1,
        extranonce2_size,
        share_difficulty: validate_share_difficulty(protocol.difficulty)?,
    }))
}

fn connect_to_pool(
    address: &str,
    socket_addresses: &[std::net::SocketAddr],
) -> Result<TcpStream, String> {
    if socket_addresses.is_empty() {
        return Err(format!("no address found for {address}"));
    }

    let mut failures = Vec::new();
    for socket_address in socket_addresses {
        match TcpStream::connect_timeout(socket_address, Duration::from_secs(4)) {
            Ok(stream) => return Ok(stream),
            Err(error) => failures.push(format!("{socket_address}: {error}")),
        }
    }

    Err(format!(
        "could not connect to {address}: {}",
        failures.join("; ")
    ))
}

fn read_stratum_line(reader: &mut impl BufRead) -> io::Result<Option<String>> {
    let mut line = String::new();
    let bytes_read = reader
        .take((MAX_STRATUM_LINE_BYTES + 1) as u64)
        .read_line(&mut line)?;

    if bytes_read == 0 {
        return Ok(None);
    }

    if line.len() > MAX_STRATUM_LINE_BYTES {
        // Drain the rest of the oversized line so the next read starts at a
        // fresh message boundary, preventing framing corruption.
        let mut discard = Vec::new();
        let _ = reader.read_until(b'\n', &mut discard);
        return Err(io::Error::new(
            ErrorKind::InvalidData,
            "pool sent an oversized Stratum message",
        ));
    }

    Ok(Some(line))
}

fn required_string(params: &[Value], index: usize, label: &str) -> Result<String, String> {
    params[index]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("pool sent invalid {label}"))
}

fn value_as_f64(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|number| number.parse().ok()))
}

fn normalize_pool_password(password: &str) -> String {
    let trimmed = password.trim();
    if trimmed.is_empty() {
        DEFAULT_POOL_PASSWORD.into()
    } else {
        trimmed.to_owned()
    }
}

fn validate_pool_password(password: &str) -> Result<(), String> {
    let normalized = normalize_pool_password(password);
    if normalized.len() > MAX_POOL_PASSWORD_BYTES {
        return Err(format!(
            "pool password must be {MAX_POOL_PASSWORD_BYTES} bytes or fewer"
        ));
    }

    if normalized.chars().any(char::is_control) {
        return Err("pool password cannot contain control characters".into());
    }

    Ok(())
}

fn validate_mainnet_address(value: &str) -> Result<(), String> {
    Address::from_str(value)
        .map_err(|error| format!("invalid BTC address format: {error}"))?
        .require_network(Network::Bitcoin)
        .map_err(|_| "address is not a Bitcoin mainnet address".to_string())?;

    Ok(())
}

fn validate_share_difficulty(difficulty: f64) -> Result<f64, String> {
    if !difficulty.is_finite() || difficulty < MIN_SHARE_DIFFICULTY {
        return Err("pool sent an unsupported share difficulty".into());
    }

    Ok(difficulty)
}

fn submission_budget(pending_submissions: usize) -> usize {
    MAX_SHARE_SUBMISSIONS_PER_TICK.min(MAX_PENDING_SUBMISSIONS.saturating_sub(pending_submissions))
}

fn share_matches_current_job(shared: &SharedMiningState, share: &ShareSubmission) -> bool {
    shared
        .job
        .read()
        .unwrap_or_else(|error| error.into_inner())
        .as_ref()
        .is_some_and(|job| job.generation == share.generation && job.job_id == share.job_id)
}

fn share_matches_valid_previous_job(shared: &SharedMiningState, share: &ShareSubmission) -> bool {
    let now = Instant::now();
    let mut valid_previous_jobs = shared
        .valid_previous_jobs
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    valid_previous_jobs.retain(|job| job.expires_at > now);
    valid_previous_jobs.iter().any(|job| job.matches_share(share))
}

fn should_submit_share(shared: &SharedMiningState, share: &ShareSubmission) -> bool {
    if share_matches_current_job(shared, share) || share_matches_valid_previous_job(shared, share) {
        return true;
    }

    shared.stale_shares_dropped.fetch_add(1, Ordering::Relaxed);
    false
}
struct BestDifficultyTracker {
    target_words: [u32; 8],
}

impl BestDifficultyTracker {
    fn new(shared: &SharedMiningState) -> Self {
        let mut tracker = Self {
            target_words: [u32::MAX; 8],
        };
        tracker.refresh(shared);
        tracker
    }

    fn refresh(&mut self, shared: &SharedMiningState) {
        let current = f64::from_bits(shared.best_difficulty_bits.load(Ordering::Relaxed));
        self.target_words = if current > 0.0 && current.is_finite() {
            crate::gpu_miner::difficulty_to_target_words(current)
        } else {
            [u32::MAX; 8]
        };
    }

    fn target_words(&self) -> &[u32; 8] {
        &self.target_words
    }

    fn record_words_improvement(
        &mut self,
        shared: &SharedMiningState,
        hash_words: &[u32; 8],
    ) -> f64 {
        let hash = crate::gpu_miner::hash_words_to_bytes(hash_words);
        let difficulty = difficulty_from_hash(&hash);
        shared.update_best_difficulty(difficulty);
        self.refresh(shared);
        difficulty
    }
}

fn validate_extranonce2_size(size: usize) -> Result<usize, String> {
    if size == 0 || size > MAX_EXTRANONCE2_BYTES {
        return Err(format!(
            "pool sent an unsupported extranonce2 size of {size} bytes"
        ));
    }

    Ok(size)
}

fn spawn_hash_workers(
    settings: &RealMiningSettings,
    shared: &Arc<SharedMiningState>,
    share_sender: &SyncSender<ShareSubmission>,
    app: &AppHandle,
) -> Vec<thread::JoinHandle<()>> {
    let pool = format!("{}:{}", settings.pool_host, settings.pool_port);
    let mut workers = Vec::new();

    // Total worker count (CPU + GPU) for extranonce partitioning
    let gpu_count = if settings.gpu_enabled { 1 } else { 0 };
    let total_workers = (settings.cpu_threads + gpu_count).max(1);

    // Spawn CPU workers
    for worker_index in 0..settings.cpu_threads {
        let shared = Arc::clone(shared);
        let share_sender = share_sender.clone();
        let worker_count = total_workers;
        let worker_app = app.clone();
        let worker_pool = pool.clone();
        let cpu_kernel_mode = settings.cpu_kernel_mode;

        match thread::Builder::new()
            .name(format!("btc-lottery-hash-{worker_index}"))
            .spawn(move || {
                hash_loop(
                    worker_index,
                    worker_count,
                    shared,
                    share_sender,
                    worker_app,
                    worker_pool,
                    cpu_kernel_mode,
                )
            }) {
            Ok(handle) => workers.push(handle),
            Err(e) => eprintln!("[ERROR] failed to start hash worker: {e}"),
        }
    }

    // Spawn GPU worker(s)
    if settings.gpu_enabled {
        let shared = Arc::clone(shared);
        let share_sender = share_sender.clone();
        let gpu_app = app.clone();
        let gpu_pool = pool.clone();
        let gpu_device_id = settings.gpu_device_id.clone();
        let gpu_intensity = settings.gpu_intensity_percent;
        let gpu_worker_index = settings.cpu_threads; // GPU gets the last index

        match thread::Builder::new()
            .name("btc-lottery-gpu-0".into())
            .spawn(move || {
                crate::gpu_miner::gpu_hash_loop(
                    shared,
                    share_sender,
                    gpu_app,
                    gpu_pool,
                    gpu_device_id,
                    gpu_intensity,
                    gpu_worker_index,
                    total_workers,
                )
            }) {
            Ok(handle) => workers.push(handle),
            Err(e) => eprintln!("[ERROR] failed to start GPU worker: {e}"),
        }
    }

    workers
}

pub(crate) fn hash_loop(
    worker_index: usize,
    worker_count: usize,
    shared: Arc<SharedMiningState>,
    share_sender: SyncSender<ShareSubmission>,
    app: AppHandle,
    pool: String,
    cpu_kernel_mode: CpuKernelMode,
) {
    let mut best_tracker = BestDifficultyTracker::new(&shared);

    while !shared.stop.load(Ordering::Acquire) {
        let Some(job) = shared.job.read().unwrap_or_else(|e| e.into_inner()).clone() else {
            thread::sleep(Duration::from_millis(25));
            continue;
        };

        let share_target = crate::gpu_miner::difficulty_to_target_words(job.share_difficulty);
        let network_target = crate::gpu_miner::target_bytes_to_words(&job.network_target);
        let mut extranonce_counter = worker_index as u64 + 1;

        while !shared.stop.load(Ordering::Acquire)
            && shared.job_generation.load(Ordering::Acquire) == job.generation
        {
            let extranonce2 = extranonce2_hex(extranonce_counter, job.extranonce2_size);
            let (mut header, header_work) = match cpu_kernel_mode {
                CpuKernelMode::Midstate => match build_header_work(&job, &extranonce2) {
                    Ok(work) => (Vec::new(), work),
                    Err(_) => {
                        shared.set_connection_status("Invalid pool job");
                        shared.clear_job();
                        break;
                    }
                },
                CpuKernelMode::FullHeader => {
                    let Ok(header) = build_header(&job, &extranonce2) else {
                        shared.set_connection_status("Invalid pool job");
                        shared.clear_job();
                        break;
                    };
                    let Ok(work) = header_work_from_header(&header) else {
                        shared.set_connection_status("Invalid pool job");
                        shared.clear_job();
                        break;
                    };
                    (header, work)
                }
            };
            let mut midstate_hasher =
                crate::gpu_miner::ReusableMidstateHasher::new(&header_work.tail);

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
                    crate::gpu_miner::hash_words_meet_three_targets(
                        &hash_words,
                        best_tracker.target_words(),
                        &network_target,
                        &share_target,
                    );
                let mut difficulty = improves_best
                    .then(|| best_tracker.record_words_improvement(&shared, &hash_words));

                if meets_network {
                    let hash = crate::gpu_miner::hash_words_to_bytes(&hash_words);
                    let difficulty = difficulty.take().unwrap_or_else(|| {
                        let difficulty = difficulty_from_hash(&hash);
                        shared.update_best_difficulty(difficulty);
                        best_tracker.refresh(&shared);
                        difficulty
                    });
                    let event =
                        found_block_event(&job, nonce, &extranonce2, &hash, difficulty, &pool);
                    record_block_candidate(&app, &event);
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
                        Err(TrySendError::Full(_)) => {
                            shared.record_queued_share_drop();
                            eprintln!("[WARN] share queue full Ã¢â‚¬â€ share dropped");
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

fn cpu_kernel_hash_words(
    mode: CpuKernelMode,
    header: &mut [u8],
    work: &HeaderWork,
    midstate_hasher: &mut crate::gpu_miner::ReusableMidstateHasher,
    nonce: u32,
) -> [u32; 8] {
    match mode {
        CpuKernelMode::Midstate => midstate_hasher.double_sha256_words(&work.midstate, nonce),
        CpuKernelMode::FullHeader => {
            header[76..80].copy_from_slice(&nonce.to_le_bytes());
            let hash = double_sha256(header);
            crate::gpu_miner::target_bytes_to_words(&hash)
        }
    }
}

fn build_merkle_root(job: &JobTemplate, extranonce2: &str) -> Result<[u8; 32], String> {
    let mut coinbase = decode_hex(&job.coinbase1)?;
    coinbase.extend(decode_hex(&job.extranonce1)?);
    coinbase.extend(decode_hex(extranonce2)?);
    coinbase.extend(decode_hex(&job.coinbase2)?);

    let mut merkle_root = double_sha256(&coinbase);
    for branch in &job.merkle_branches {
        let branch = decode_hex(branch)?;
        let mut material = Vec::with_capacity(merkle_root.len() + branch.len());
        material.extend_from_slice(&merkle_root);
        material.extend(branch);
        merkle_root = double_sha256(&material);
    }

    Ok(merkle_root)
}

fn reversed_header_word(value: &str, field: &str) -> Result<[u8; 4], String> {
    let bytes = reversed_hex(value)?;
    bytes
        .try_into()
        .map_err(|bytes: Vec<u8>| format!("pool sent {field} as {} bytes, expected 4", bytes.len()))
}

pub(crate) fn build_header(job: &JobTemplate, extranonce2: &str) -> Result<Vec<u8>, String> {
    let merkle_root = build_merkle_root(job, extranonce2)?;
    let version = reversed_header_word(&job.version, "version")?;
    let prev_hash = word_swapped_hex(&job.prev_hash)?;
    if prev_hash.len() != 32 {
        return Err(format!(
            "pool sent previous hash as {} bytes, expected 32",
            prev_hash.len()
        ));
    }
    let ntime = reversed_header_word(&job.ntime, "ntime")?;
    let nbits = reversed_header_word(&job.nbits, "nbits")?;

    let mut header = Vec::with_capacity(80);
    header.extend_from_slice(&version);
    header.extend_from_slice(&prev_hash);
    header.extend_from_slice(&merkle_root);
    header.extend_from_slice(&ntime);
    header.extend_from_slice(&nbits);
    header.extend([0_u8; 4]);

    if header.len() != 80 {
        return Err(format!(
            "pool produced an invalid {}-byte block header",
            header.len()
        ));
    }

    Ok(header)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HeaderWork {
    pub(crate) midstate: [u32; 8],
    pub(crate) tail: [u32; 3],
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) struct HeaderWorkTemplate {
    midstate: [u32; 8],
    merkle_tail: [u8; 4],
    nbits: [u8; 4],
}

impl HeaderWorkTemplate {
    pub(crate) fn work_for_ntime(&self, ntime: &str) -> Result<HeaderWork, String> {
        let ntime = reversed_header_word(ntime, "ntime")?;
        Ok(HeaderWork {
            midstate: self.midstate,
            tail: [
                u32::from_le_bytes(self.merkle_tail),
                u32::from_le_bytes(ntime),
                u32::from_le_bytes(self.nbits),
            ],
        })
    }
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) struct HeaderHashBenchmark {
    pub(crate) nonce_count: u64,
    pub(crate) full_header_duration_micros: u128,
    pub(crate) midstate_duration_micros: u128,
    pub(crate) full_header_hashrate: f64,
    pub(crate) midstate_hashrate: f64,
    pub(crate) speedup_ratio: f64,
    pub(crate) checksum: u64,
}

pub(crate) fn build_header_work_template(
    job: &JobTemplate,
    extranonce2: &str,
) -> Result<HeaderWorkTemplate, String> {
    let merkle_root = build_merkle_root(job, extranonce2)?;
    let version = reversed_header_word(&job.version, "version")?;
    let prev_hash = word_swapped_hex(&job.prev_hash)?;
    if prev_hash.len() != 32 {
        return Err(format!(
            "pool sent previous hash as {} bytes, expected 32",
            prev_hash.len()
        ));
    }

    let mut first_block = [0_u8; 64];
    first_block[0..4].copy_from_slice(&version);
    first_block[4..36].copy_from_slice(&prev_hash);
    first_block[36..64].copy_from_slice(&merkle_root[0..28]);

    let merkle_tail: [u8; 4] = merkle_root[28..32]
        .try_into()
        .map_err(|_| "validated merkle root is missing tail bytes".to_string())?;
    let nbits = reversed_header_word(&job.nbits, "nbits")?;

    Ok(HeaderWorkTemplate {
        midstate: crate::gpu_miner::sha256_midstate(&first_block),
        merkle_tail,
        nbits,
    })
}

pub(crate) fn build_header_work(
    job: &JobTemplate,
    extranonce2: &str,
) -> Result<HeaderWork, String> {
    build_header_work_template(job, extranonce2)?.work_for_ntime(&job.ntime)
}

pub(crate) fn header_work_from_header(header: &[u8]) -> Result<HeaderWork, String> {
    if header.len() != 80 {
        return Err(format!(
            "midstate work requires an 80-byte block header, got {} bytes",
            header.len()
        ));
    }

    let first_block: [u8; 64] = header[0..64]
        .try_into()
        .map_err(|_| "validated block header is missing the first SHA-256 block".to_string())?;
    let midstate = crate::gpu_miner::sha256_midstate(&first_block);
    let tail = [
        u32::from_le_bytes(
            header[64..68]
                .try_into()
                .map_err(|_| "validated block header is missing tail word 0".to_string())?,
        ),
        u32::from_le_bytes(
            header[68..72]
                .try_into()
                .map_err(|_| "validated block header is missing tail word 1".to_string())?,
        ),
        u32::from_le_bytes(
            header[72..76]
                .try_into()
                .map_err(|_| "validated block header is missing tail word 2".to_string())?,
        ),
    ];

    Ok(HeaderWork { midstate, tail })
}
const MAX_HEADER_HASH_BENCHMARK_NONCES: u32 = 1_000_000;
pub(crate) fn benchmark_header_hash_paths(
    header: &[u8],
    nonce_count: u32,
) -> Result<HeaderHashBenchmark, String> {
    if nonce_count == 0 {
        return Err("header hash benchmark requires at least one nonce".into());
    }
    if nonce_count > MAX_HEADER_HASH_BENCHMARK_NONCES {
        return Err(format!(
            "header hash benchmark is capped at {} nonces",
            MAX_HEADER_HASH_BENCHMARK_NONCES
        ));
    }

    let work = header_work_from_header(header)?;
    let equivalence_checksum = verify_header_hash_window(header, &work, nonce_count)?;

    let mut candidate = header.to_vec();
    let full_header_start = Instant::now();
    let mut full_header_checksum = 0_u64;
    for nonce in 0..nonce_count {
        candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
        full_header_checksum =
            mix_hash_checksum(full_header_checksum, nonce, &double_sha256(&candidate));
    }
    let full_header_elapsed = full_header_start.elapsed();

    let mut midstate_hasher = crate::gpu_miner::ReusableMidstateHasher::new(&work.tail);
    let midstate_start = Instant::now();
    let mut midstate_checksum = 0_u64;
    for nonce in 0..nonce_count {
        let hash_words = midstate_hasher.double_sha256_words(&work.midstate, nonce);
        let hash = crate::gpu_miner::hash_words_to_bytes(&hash_words);
        midstate_checksum = mix_hash_checksum(midstate_checksum, nonce, &hash);
    }
    let midstate_elapsed = midstate_start.elapsed();

    if full_header_checksum != equivalence_checksum || midstate_checksum != equivalence_checksum {
        return Err("header hash benchmark checksums diverged".into());
    }

    let full_header_hashrate = benchmark_hashrate(nonce_count, full_header_elapsed);
    let midstate_hashrate = benchmark_hashrate(nonce_count, midstate_elapsed);
    let speedup_ratio = if full_header_hashrate > 0.0 {
        midstate_hashrate / full_header_hashrate
    } else {
        0.0
    };

    Ok(HeaderHashBenchmark {
        nonce_count: nonce_count as u64,
        full_header_duration_micros: full_header_elapsed.as_micros(),
        midstate_duration_micros: midstate_elapsed.as_micros(),
        full_header_hashrate,
        midstate_hashrate,
        speedup_ratio,
        checksum: equivalence_checksum,
    })
}
fn verify_header_hash_window(
    header: &[u8],
    work: &HeaderWork,
    nonce_count: u32,
) -> Result<u64, String> {
    let mut candidate = header.to_vec();
    let mut midstate_hasher = crate::gpu_miner::ReusableMidstateHasher::new(&work.tail);
    let mut checksum = 0_u64;

    for nonce in 0..nonce_count {
        candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
        let full_hash = double_sha256(&candidate);
        let midstate_hash = crate::gpu_miner::hash_words_to_bytes(
            &midstate_hasher.double_sha256_words(&work.midstate, nonce),
        );

        if full_hash != midstate_hash {
            return Err(format!("midstate hash mismatch at nonce {nonce}"));
        }

        checksum = mix_hash_checksum(checksum, nonce, &midstate_hash);
    }

    Ok(checksum)
}
fn mix_hash_checksum(current: u64, nonce: u32, hash: &[u8; 32]) -> u64 {
    let mut mixed = current.rotate_left(7) ^ nonce as u64;
    for chunk in hash.chunks_exact(8) {
        mixed ^= u64::from_be_bytes(chunk.try_into().unwrap());
        mixed = mixed.rotate_left(11).wrapping_mul(0x9E37_79B1_85EB_CA87);
    }
    mixed
}
fn benchmark_hashrate(nonce_count: u32, elapsed: Duration) -> f64 {
    let seconds = elapsed.as_secs_f64();
    if seconds > 0.0 {
        nonce_count as f64 / seconds
    } else {
        0.0
    }
}

fn decode_hex(value: &str) -> Result<Vec<u8>, String> {
    hex::decode(value).map_err(|error| format!("pool sent invalid hex: {error}"))
}

fn reversed_hex(value: &str) -> Result<Vec<u8>, String> {
    let mut bytes = decode_hex(value)?;
    bytes.reverse();
    Ok(bytes)
}

fn word_swapped_hex(value: &str) -> Result<Vec<u8>, String> {
    let mut bytes = decode_hex(value)?;

    if bytes.len() % 4 != 0 {
        return Err("pool sent a previous hash that is not word-aligned".into());
    }

    for word in bytes.chunks_exact_mut(4) {
        word.reverse();
    }

    Ok(bytes)
}

pub(crate) fn extranonce2_hex(counter: u64, size: usize) -> String {
    let mut bytes = vec![0_u8; size];
    let source = counter.to_be_bytes();
    let copied_bytes = size.min(source.len());
    bytes[size - copied_bytes..].copy_from_slice(&source[source.len() - copied_bytes..]);
    hex::encode(bytes)
}

pub(crate) fn double_sha256(value: &[u8]) -> [u8; 32] {
    let first_hash = Sha256::digest(value);
    Sha256::digest(first_hash).into()
}

pub(crate) fn difficulty_from_hash(hash: &[u8; 32]) -> f64 {
    let numeric_hash = hash
        .iter()
        .rev()
        .fold(0.0, |value, byte| value * 256.0 + f64::from(*byte));

    if numeric_hash == 0.0 {
        return DIFF_ONE_TARGET;
    }

    DIFF_ONE_TARGET / numeric_hash
}

fn target_from_nbits(nbits: &str) -> Result<[u8; 32], String> {
    let compact = decode_hex(nbits)?;
    if compact.len() != 4 {
        return Err("pool sent invalid compact target width".into());
    }

    if compact[1] & 0x80 != 0 {
        return Err("pool sent a negative compact target".into());
    }

    let exponent = compact[0] as usize;
    let mantissa = [compact[1], compact[2], compact[3]];
    let mut target = [0_u8; 32];

    if exponent == 0 {
        return Ok(target);
    }

    if exponent <= 3 {
        let shift = 8 * (3 - exponent);
        let value = u32::from_be_bytes([0, mantissa[0], mantissa[1], mantissa[2]]) >> shift;
        target[28..32].copy_from_slice(&value.to_be_bytes());
        return Ok(target);
    }

    if exponent > 32 {
        return Err("pool sent a compact target above uint256".into());
    }

    let start = 32 - exponent;
    target[start..start + 3].copy_from_slice(&mantissa);
    Ok(target)
}

pub(crate) fn hash_meets_network_target(hash: &[u8; 32], target: &[u8; 32]) -> bool {
    for (hash_byte, target_byte) in hash.iter().rev().zip(target.iter()) {
        if hash_byte < target_byte {
            return true;
        }

        if hash_byte > target_byte {
            return false;
        }
    }

    true
}

fn block_hash_hex(hash: &[u8; 32]) -> String {
    let bytes = hash.iter().rev().copied().collect::<Vec<_>>();
    hex::encode(bytes)
}

pub(crate) fn found_block_event(
    job: &JobTemplate,
    nonce: u32,
    extranonce2: &str,
    hash: &[u8; 32],
    difficulty: f64,
    pool: &str,
) -> FoundBlockEvent {
    FoundBlockEvent {
        job_id: job.job_id.clone(),
        nonce: format!("{nonce:08x}"),
        ntime: job.ntime.clone(),
        extranonce2: extranonce2.to_owned(),
        hash: block_hash_hex(hash),
        difficulty,
        timestamp: chrono::Utc::now().to_rfc3339(),
        pool: pool.to_owned(),
    }
}

pub(crate) fn record_block_candidate(app: &AppHandle, event: &FoundBlockEvent) {
    log_message(app, "BLOCK CANDIDATE FOUND!");
    let _ = app.emit(BLOCK_FOUND_EVENT, event);

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
                log_message(app, &format!("Failed to save found block file: {error}"));
            }
        }
        Err(error) => {
            log_message(app, &format!("Failed to encode found block file: {error}"));
        }
    }
}

fn write_message(stream: &mut TcpStream, message: &Value) -> Result<(), String> {
    let mut payload = serde_json::to_vec(message)
        .map_err(|error| format!("failed to encode Stratum JSON: {error}"))?;
    payload.push(b'\n');
    stream
        .write_all(&payload)
        .map_err(|error| format!("socket write failed: {error}"))
}

pub(crate) fn emit_stats(app: &AppHandle, shared: &SharedMiningState, hashrate: f64) {
    let _ = app.emit(STATS_EVENT, shared.snapshot(hashrate));
}

fn sleep_until_stopped(stop: &AtomicBool, duration: Duration) {
    let deadline = Instant::now() + duration;
    while !stop.load(Ordering::Acquire) && Instant::now() < deadline {
        thread::sleep(Duration::from_millis(50));
    }
}

#[cfg(test)]
mod tests {
    use std::{
        collections::HashSet,
        io::{BufRead, BufReader, Cursor, ErrorKind},
        net::{TcpListener, TcpStream},
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc,
        },
        thread,
        time::{Duration, Instant},
    };

    use super::{
        difficulty_from_hash, extranonce2_hex, found_block_event,
        handle_server_message_with_logger, hash_meets_network_target, read_stratum_line,
        target_from_nbits, validate_mainnet_address, validate_share_difficulty, word_swapped_hex,
        BestDifficultyTracker, CpuKernelMode, JobTemplate, PoolDiagnosticSettings, ProtocolState,
        RealMiningSettings, SharedMiningState, DIFF_ONE_TARGET, MAX_PENDING_SUBMISSIONS,
        MAX_SHARE_SUBMISSIONS_PER_TICK, MAX_STRATUM_LINE_BYTES,
    };

    fn read_mock_line(reader: &mut BufReader<TcpStream>) -> String {
        let mut line = String::new();
        reader.read_line(&mut line).expect("mock pool read line");
        assert!(!line.is_empty(), "mock pool connection closed early");
        line
    }

    fn protocol_test_state() -> (
        ProtocolState,
        Arc<SharedMiningState>,
        HashSet<u64>,
        Vec<String>,
    ) {
        (
            ProtocolState::default(),
            Arc::new(SharedMiningState::new(Arc::new(AtomicBool::new(false)))),
            HashSet::new(),
            Vec::new(),
        )
    }

    #[test]
    fn formats_extranonce2_to_pool_width() {
        assert_eq!(extranonce2_hex(1, 4), "00000001");
        assert_eq!(extranonce2_hex(0x1234, 2), "1234");
    }

    #[test]
    fn swaps_previous_hash_words_like_nerdminer() {
        assert_eq!(
            word_swapped_hex("11223344aabbccdd").unwrap(),
            vec![0x44, 0x33, 0x22, 0x11, 0xdd, 0xcc, 0xbb, 0xaa]
        );
    }

    #[test]
    fn zero_hash_has_maximum_reported_difficulty() {
        assert!(difficulty_from_hash(&[0; 32]).is_finite());
    }

    #[test]
    fn expands_compact_nbits_to_network_target() {
        let target = target_from_nbits("1d00ffff").unwrap();

        assert_eq!(
            hex::encode(target),
            "00000000ffff0000000000000000000000000000000000000000000000000000"
        );
    }

    #[test]
    fn compares_hashes_against_network_target() {
        let target = target_from_nbits("1d00ffff").unwrap();

        assert!(hash_meets_network_target(&[0; 32], &target));
        assert!(!hash_meets_network_target(&[0xff; 32], &target));
    }

    #[test]
    fn header_work_midstate_matches_full_header_hashing() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-midstate".into(),
            prev_hash: "00".repeat(32),
            coinbase1: "01000000".into(),
            coinbase2: "ffffffff".into(),
            merkle_branches: vec!["11".repeat(32), "22".repeat(32)],
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };
        let extranonce2 = extranonce2_hex(1, job.extranonce2_size);
        let header = super::build_header(&job, &extranonce2).unwrap();
        let work = super::build_header_work(&job, &extranonce2).unwrap();

        assert_eq!(header.len(), 80);
        assert_eq!(
            work.tail[0],
            u32::from_le_bytes(header[64..68].try_into().unwrap())
        );
        assert_eq!(
            work.tail[1],
            u32::from_le_bytes(header[68..72].try_into().unwrap())
        );
        assert_eq!(
            work.tail[2],
            u32::from_le_bytes(header[72..76].try_into().unwrap())
        );

        for nonce in [0, 1, 0x1234abcd, u32::MAX] {
            let mut candidate = header.clone();
            candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
            assert_eq!(
                crate::gpu_miner::double_sha256_from_midstate(&work.midstate, &work.tail, nonce),
                super::double_sha256(&candidate),
            );
        }
    }

    #[test]
    fn header_work_template_reuses_midstate_when_only_ntime_changes() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-midstate-template".into(),
            prev_hash: "00".repeat(32),
            coinbase1: "01000000".into(),
            coinbase2: "ffffffff".into(),
            merkle_branches: vec!["11".repeat(32), "22".repeat(32)],
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };
        let extranonce2 = extranonce2_hex(1, job.extranonce2_size);
        let template = super::build_header_work_template(&job, &extranonce2).unwrap();
        let first_work = template.work_for_ntime(&job.ntime).unwrap();

        let mut next_job = job.clone();
        next_job.ntime = "5f5e1010".into();
        let next_work = template.work_for_ntime(&next_job.ntime).unwrap();
        let rebuilt_next_work = super::build_header_work(&next_job, &extranonce2).unwrap();

        assert_eq!(first_work.midstate, next_work.midstate);
        assert_ne!(first_work.tail[1], next_work.tail[1]);
        assert_eq!(next_work, rebuilt_next_work);

        let next_header = super::build_header(&next_job, &extranonce2).unwrap();
        for nonce in [0, 1, 0x1234abcd, u32::MAX] {
            let mut candidate = next_header.clone();
            candidate[76..80].copy_from_slice(&nonce.to_le_bytes());
            assert_eq!(
                crate::gpu_miner::double_sha256_from_midstate(
                    &next_work.midstate,
                    &next_work.tail,
                    nonce,
                ),
                super::double_sha256(&candidate),
            );
        }
    }
    #[test]
    fn cpu_kernel_modes_match_across_nonce_window() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-cpu-kernel-mode".into(),
            prev_hash: "00".repeat(32),
            coinbase1: "01000000".into(),
            coinbase2: "ffffffff".into(),
            merkle_branches: vec!["11".repeat(32), "22".repeat(32)],
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };
        let extranonce2 = extranonce2_hex(1, job.extranonce2_size);
        let mut header = super::build_header(&job, &extranonce2).unwrap();
        let work = super::header_work_from_header(&header).unwrap();
        let mut midstate_hasher = crate::gpu_miner::ReusableMidstateHasher::new(&work.tail);

        for nonce in [0, 1, 1024, 0x1234abcd, u32::MAX] {
            let mut midstate_header = header.clone();
            let midstate_words = super::cpu_kernel_hash_words(
                CpuKernelMode::Midstate,
                &mut midstate_header,
                &work,
                &mut midstate_hasher,
                nonce,
            );
            let full_header_words = super::cpu_kernel_hash_words(
                CpuKernelMode::FullHeader,
                &mut header,
                &work,
                &mut midstate_hasher,
                nonce,
            );

            assert_eq!(midstate_words, full_header_words);
        }
    }
    #[test]
    fn header_hash_benchmark_compares_full_and_midstate_windows() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-midstate-bench".into(),
            prev_hash: "00".repeat(32),
            coinbase1: "01000000".into(),
            coinbase2: "ffffffff".into(),
            merkle_branches: vec!["11".repeat(32), "22".repeat(32)],
            version: "20000000".into(),
            nbits: "1d00ffff".into(),
            network_target: target_from_nbits("1d00ffff").unwrap(),
            ntime: "5f5e1000".into(),
            extranonce1: "abcd".into(),
            extranonce2_size: 4,
            share_difficulty: 1.0,
        };
        let extranonce2 = extranonce2_hex(1, job.extranonce2_size);
        let header = super::build_header(&job, &extranonce2).unwrap();
        let benchmark = super::benchmark_header_hash_paths(&header, 2048).unwrap();

        eprintln!(
            "midstate benchmark: full={:.0} H/s, midstate={:.0} H/s, ratio={:.2}x, nonces={}",
            benchmark.full_header_hashrate,
            benchmark.midstate_hashrate,
            benchmark.speedup_ratio,
            benchmark.nonce_count,
        );

        assert_eq!(benchmark.nonce_count, 2048);
        assert!(benchmark.full_header_duration_micros > 0);
        assert!(benchmark.midstate_duration_micros > 0);
        assert!(benchmark.full_header_hashrate.is_finite());
        assert!(benchmark.full_header_hashrate > 0.0);
        assert!(benchmark.midstate_hashrate.is_finite());
        assert!(benchmark.midstate_hashrate > 0.0);
        assert!(benchmark.speedup_ratio.is_finite());
        assert!(benchmark.speedup_ratio > 0.0);
    }

    #[test]
    fn header_work_rejects_invalid_header_width() {
        let error = super::header_work_from_header(&[0; 79]).unwrap_err();
        assert!(error.contains("80-byte block header"));
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

    fn share_for_job(job: &JobTemplate) -> super::ShareSubmission {
        super::ShareSubmission {
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
        let active_share = super::ShareSubmission {
            generation: active_job.generation,
            job_id: active_job.job_id.clone(),
            extranonce2: "00000001".into(),
            ntime: active_job.ntime.clone(),
            nonce: 0,
        };

        assert!(super::share_matches_current_job(&shared, &active_share));
        assert!(super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 0);

        let stale_generation = super::ShareSubmission {
            generation: active_job.generation.saturating_sub(1),
            ..active_share.clone()
        };

        assert!(!super::share_matches_current_job(
            &shared,
            &stale_generation
        ));
        assert!(!super::should_submit_share(&shared, &stale_generation));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);

        let mut next_job = base_job;
        next_job.job_id = "job-2".into();
        shared.set_job(next_job);

        assert!(!super::share_matches_current_job(&shared, &active_share));
        assert!(!super::should_submit_share(&shared, &active_share));
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

        assert!(!super::share_matches_current_job(&shared, &active_share));
        assert!(super::share_matches_valid_previous_job(
            &shared,
            &active_share
        ));
        assert!(super::should_submit_share(&shared, &active_share));
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

        assert!(!super::share_matches_valid_previous_job(
            &shared,
            &active_share
        ));
        assert!(!super::should_submit_share(&shared, &active_share));
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

        assert!(!super::share_matches_valid_previous_job(
            &shared,
            &active_share
        ));
        assert!(shared.valid_previous_jobs.lock().unwrap().is_empty());
        assert!(!super::should_submit_share(&shared, &active_share));
        assert_eq!(shared.stale_shares_dropped.load(Ordering::Relaxed), 1);
    }

    #[test]
    fn best_difficulty_tracker_skips_hashes_below_current_best() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        shared.update_best_difficulty(1.0);
        let mut tracker = BestDifficultyTracker::new(&shared);
        let weak_hash_words = [0xffff_ffff; 8];

        assert!(!crate::gpu_miner::hash_words_meet_target_words(
            &weak_hash_words,
            tracker.target_words(),
        ));
        assert_eq!(
            f64::from_bits(shared.best_difficulty_bits.load(Ordering::Relaxed)),
            1.0
        );

        let perfect_hash_words = [0_u32; 8];
        assert!(crate::gpu_miner::hash_words_meet_target_words(
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
    #[test]
    fn queued_share_drops_are_counted_in_stats_snapshot() {
        let shared = SharedMiningState::new(Arc::new(AtomicBool::new(false)));
        assert_eq!(shared.snapshot(0.0).queued_shares_dropped, 0);

        shared.record_queued_share_drop();
        shared.record_queued_share_drop();

        assert_eq!(shared.queued_shares_dropped.load(Ordering::Relaxed), 2);
        assert_eq!(shared.snapshot(123.0).queued_shares_dropped, 2);
    }

    #[test]
    fn found_block_event_uses_pool_metadata_without_address() {
        let job = JobTemplate {
            generation: 1,
            clean_jobs: true,
            job_id: "job-7".into(),
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

        let event = found_block_event(
            &job,
            0x1234abcd,
            "00000001",
            &[0; 32],
            42.0,
            "public-pool.io:3333",
        );
        let serialized = serde_json::to_string(&event).unwrap();

        assert_eq!(event.job_id, "job-7");
        assert_eq!(event.nonce, "1234abcd");
        assert!(serialized.contains("public-pool.io:3333"));
        assert!(!serialized.contains("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa"));
    }

    #[test]
    fn validates_mainnet_bitcoin_address_checksum_and_network() {
        assert!(validate_mainnet_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa").is_ok());
        assert!(validate_mainnet_address("1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb").is_err());
        assert!(validate_mainnet_address("mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn").is_err());
    }

    #[test]
    fn rejects_pathological_share_difficulty() {
        assert!(validate_share_difficulty(0.0001).is_ok());
        assert!(validate_share_difficulty(1e-9).is_ok());
        assert!(validate_share_difficulty(1e-10).is_err());
        assert!(validate_share_difficulty(0.0).is_err());
        assert!(validate_share_difficulty(f64::EPSILON).is_err());
        assert!(validate_share_difficulty(f64::INFINITY).is_err());
    }

    #[test]
    fn rejects_oversized_stratum_line_during_read() {
        let bytes = vec![b'a'; MAX_STRATUM_LINE_BYTES + 1];
        let mut reader = BufReader::new(Cursor::new(bytes));
        let error = read_stratum_line(&mut reader).unwrap_err();

        assert_eq!(error.kind(), ErrorKind::InvalidData);
    }

    #[test]
    fn surfaces_pool_rejection_reason_from_result_text() {
        let message = serde_json::json!({
            "id": 1,
            "result": "Only allowed user agents may subscribe",
            "error": null
        });

        assert_eq!(
            super::pool_response_error(&message).as_deref(),
            Some("Only allowed user agents may subscribe")
        );
    }

    #[test]
    fn rejects_malformed_stratum_json() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        let error = handle_server_message_with_logger(
            "{not-json",
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("invalid Stratum JSON"));
        assert!(logs.is_empty());
    }

    #[test]
    fn surfaces_subscribe_rejection_reason() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        let error = handle_server_message_with_logger(
            r#"{"id":1,"result":null,"error":["subscription disabled",20,null]}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("pool rejected mining.subscribe"));
        assert!(error.contains("subscription disabled"));
        assert!(protocol.extranonce1.is_none());
    }

    #[test]
    fn surfaces_authorize_rejection_reason() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        let error = handle_server_message_with_logger(
            r#"{"id":2,"result":false,"error":["bad user",24,null]}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap_err();

        assert!(error.contains("pool rejected mining.authorize"));
        assert!(error.contains("bad user"));
        assert_eq!(
            shared.connection_status.lock().unwrap().as_str(),
            "Starting"
        );
    }

    #[test]
    fn ignores_unknown_response_ids_without_share_accounting() {
        let (mut protocol, shared, mut pending_submissions, mut logs) = protocol_test_state();
        pending_submissions.insert(99);

        handle_server_message_with_logger(
            r#"{"id":42,"result":true,"error":null}"#,
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap();

        assert_eq!(shared.accepted_shares.load(Ordering::Relaxed), 0);
        assert_eq!(shared.rejected_shares.load(Ordering::Relaxed), 0);
        assert!(pending_submissions.contains(&99));
        assert!(logs.is_empty());
    }

    #[test]
    fn mock_stratum_pool_drives_handshake_job_and_share_accounting() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());

            let subscribe = read_mock_line(&mut reader);
            assert!(subscribe.contains("\"mining.subscribe\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 1,
                    "result": [null, "abcd", 4],
                    "error": null
                }),
            )
            .unwrap();

            let authorize = read_mock_line(&mut reader);
            assert!(authorize.contains("\"mining.authorize\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 2,
                    "result": true,
                    "error": null
                }),
            )
            .unwrap();
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "method": "mining.set_difficulty",
                    "params": [0.001]
                }),
            )
            .unwrap();
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "method": "mining.notify",
                    "params": [
                        "job-1",
                        "0000000000000000000000000000000000000000000000000000000000000000",
                        "00",
                        "00",
                        [],
                        "20000000",
                        "1d00ffff",
                        "5f5e1000",
                        true
                    ]
                }),
            )
            .unwrap();

            let submit = read_mock_line(&mut reader);
            assert!(submit.contains("\"mining.submit\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 11,
                    "result": true,
                    "error": null
                }),
            )
            .unwrap();

            let rejected_submit = read_mock_line(&mut reader);
            assert!(rejected_submit.contains("\"mining.submit\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 12,
                    "result": false,
                    "error": ["low difficulty share", 23, null]
                }),
            )
            .unwrap();
        });

        let mut stream = TcpStream::connect(address).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let stop = Arc::new(AtomicBool::new(false));
        let shared = Arc::new(SharedMiningState::new(stop));
        let mut protocol = ProtocolState {
            difficulty: 0.001,
            ..ProtocolState::default()
        };
        let mut pending_submissions = HashSet::new();
        let mut logs = Vec::new();

        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 1,
                "method": "mining.subscribe",
                "params": ["BTC Lottery Pet/test"]
            }),
        )
        .unwrap();
        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 2,
                "method": "mining.authorize",
                "params": ["1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.worker", "x"]
            }),
        )
        .unwrap();

        for _ in 0..4 {
            let line = read_stratum_line(&mut reader).unwrap().unwrap();
            handle_server_message_with_logger(
                line.trim(),
                &mut protocol,
                &shared,
                &mut pending_submissions,
                |message| logs.push(message.to_owned()),
            )
            .unwrap();
        }

        assert_eq!(
            shared
                .job
                .read()
                .unwrap()
                .as_ref()
                .map(|job| job.job_id.as_str()),
            Some("job-1")
        );
        assert_eq!(shared.connection_status.lock().unwrap().as_str(), "Mining");

        pending_submissions.insert(11);
        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 11,
                "method": "mining.submit",
                "params": [
                    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.worker",
                    "job-1",
                    "00000001",
                    "5f5e1000",
                    "00000000"
                ]
            }),
        )
        .unwrap();
        let line = read_stratum_line(&mut reader).unwrap().unwrap();
        handle_server_message_with_logger(
            line.trim(),
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap();

        assert_eq!(shared.accepted_shares.load(Ordering::Relaxed), 1);
        assert_eq!(shared.rejected_shares.load(Ordering::Relaxed), 0);
        assert!(logs.iter().any(|line| line == "Share accepted!"));

        pending_submissions.insert(12);
        super::write_message(
            &mut stream,
            &serde_json::json!({
                "id": 12,
                "method": "mining.submit",
                "params": [
                    "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa.worker",
                    "job-1",
                    "00000002",
                    "5f5e1000",
                    "00000001"
                ]
            }),
        )
        .unwrap();
        let line = read_stratum_line(&mut reader).unwrap().unwrap();
        handle_server_message_with_logger(
            line.trim(),
            &mut protocol,
            &shared,
            &mut pending_submissions,
            |message| logs.push(message.to_owned()),
        )
        .unwrap();

        assert_eq!(shared.accepted_shares.load(Ordering::Relaxed), 1);
        assert_eq!(shared.rejected_shares.load(Ordering::Relaxed), 1);
        assert!(logs
            .iter()
            .any(|line| line.contains("low difficulty share")));
        server.join().unwrap();
    }

    #[test]
    fn pool_diagnostic_skips_authorization_without_address() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());

            let subscribe = read_mock_line(&mut reader);
            assert!(subscribe.contains("\"mining.subscribe\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 1,
                    "result": [null, "abcd", 4],
                    "error": null
                }),
            )
            .unwrap();
        });

        let report = super::diagnose_pool_connection(PoolDiagnosticSettings {
            pool_host: "127.0.0.1".into(),
            pool_port: address.port(),
            pool_password: String::new(),
            btc_address: String::new(),
            worker_name: "desk_1".into(),
        });

        assert_eq!(report.pool, address.to_string());
        assert_eq!(
            report
                .steps
                .iter()
                .find(|step| step.name == "SUBSCRIBE")
                .map(|step| step.status.as_str()),
            Some("ok")
        );
        assert_eq!(
            report
                .steps
                .iter()
                .find(|step| step.name == "AUTHORIZE")
                .map(|step| step.status.as_str()),
            Some("skipped")
        );
        assert!(report.summary.contains("Add a BTC address"));
        server.join().unwrap();
    }

    #[test]
    fn pool_diagnostic_reports_successful_job_delivery() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let server = thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            stream
                .set_write_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut reader = BufReader::new(stream.try_clone().unwrap());

            let subscribe = read_mock_line(&mut reader);
            assert!(subscribe.contains("\"mining.subscribe\""));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 1,
                    "result": [null, "abcd", 4],
                    "error": null
                }),
            )
            .unwrap();

            let authorize = read_mock_line(&mut reader);
            assert!(authorize.contains("\"mining.authorize\""));
            assert!(authorize.contains("desk_1"));
            assert!(authorize.contains("d=1"));
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "id": 2,
                    "result": true,
                    "error": null
                }),
            )
            .unwrap();
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "method": "mining.set_difficulty",
                    "params": [0.001]
                }),
            )
            .unwrap();
            super::write_message(
                &mut stream,
                &serde_json::json!({
                    "method": "mining.notify",
                    "params": [
                        "job-diagnostic",
                        "0000000000000000000000000000000000000000000000000000000000000000",
                        "00",
                        "00",
                        [],
                        "20000000",
                        "1d00ffff",
                        "5f5e1000",
                        true
                    ]
                }),
            )
            .unwrap();
        });

        let report = super::diagnose_pool_connection(PoolDiagnosticSettings {
            pool_host: "127.0.0.1".into(),
            pool_port: address.port(),
            pool_password: " d=1 ".into(),
            btc_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".into(),
            worker_name: "desk_1".into(),
        });

        assert_eq!(report.summary, "Pool connection diagnostic passed.");
        for step in &report.steps {
            assert_eq!(
                step.status, "ok",
                "step {} failed: {}",
                step.name, step.message
            );
        }
        assert!(report
            .steps
            .iter()
            .any(|step| step.name == "JOB" && step.message.contains("job-diagnostic")));
        server.join().unwrap();
    }

    #[test]
    fn caps_share_submission_budget() {
        assert_eq!(super::submission_budget(0), MAX_SHARE_SUBMISSIONS_PER_TICK);
        assert_eq!(super::submission_budget(MAX_PENDING_SUBMISSIONS - 1), 1);
        assert_eq!(super::submission_budget(MAX_PENDING_SUBMISSIONS), 0);
        assert_eq!(super::submission_budget(MAX_PENDING_SUBMISSIONS + 1), 0);
    }

    #[test]
    fn rotates_log_before_exceeding_size_cap() {
        assert!(!super::should_rotate_log(0, 1));
        assert!(!super::should_rotate_log(super::MAX_LOG_FILE_BYTES - 1, 1));
        assert!(super::should_rotate_log(super::MAX_LOG_FILE_BYTES, 1));
    }

    #[test]
    fn rejects_real_mining_threads_above_local_parallelism() {
        let available_threads = std::thread::available_parallelism()
            .map(|count| count.get())
            .unwrap_or(1);
        let settings = RealMiningSettings {
            pool_host: "public-pool.io".into(),
            pool_port: 3333,
            pool_password: String::new(),
            btc_address: "1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa".into(),
            worker_name: "btc-lottery-pet".into(),
            cpu_threads: available_threads + 1,
            confirmed_cpu_use: true,
            gpu_enabled: false,
            gpu_device_id: None,
            gpu_intensity_percent: 10,
            cpu_kernel_mode: CpuKernelMode::Midstate,
        };

        assert!(settings.validate().is_err());
    }
}
