use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    thread,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::notifications::{HeartbeatInterval, NotificationChannel};

const DEFAULT_CONFIG: &str = include_str!("../../../config.json");
const DEFAULT_POOL_HOST: &str = "public-pool.io";
const DEFAULT_POOL_PORT: u16 = 3333;
pub(crate) const DEFAULT_POOL_PASSWORD: &str = "x";
const DEFAULT_PET_PROFILE_ID: &str = "classic-slot";
const BUILTIN_PET_PROFILE_IDS: &[&str] = &["classic-slot", "cyber-miner", "lucky-cat"];
const OLD_PUBLIC_POOL_PORT: u16 = 21496;

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PerformancePreset {
    #[default]
    Eco,
    Normal,
    Turbo,
    Custom,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(default)]
pub(crate) struct AppConfig {
    pub(crate) btc_address: String,
    #[serde(alias = "pool_url")]
    pub(crate) pool_host: String,
    pub(crate) pool_port: u16,
    pub(crate) pool_password: String,
    pub(crate) worker_name: String,
    pub(crate) cpu_threads: usize,
    pub(crate) performance_preset: PerformancePreset,
    pub(crate) enable_notifications: bool,
    pub(crate) notify_on_jackpot: bool,
    pub(crate) notify_on_share_accepted: bool,
    pub(crate) notify_on_connection_error: bool,
    pub(crate) heartbeat_interval: HeartbeatInterval,
    pub(crate) notification_channel: NotificationChannel,
    pub(crate) webhook_url: String,
    pub(crate) pet_profile_id: String,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            btc_address: String::new(),
            pool_host: DEFAULT_POOL_HOST.into(),
            pool_port: DEFAULT_POOL_PORT,
            pool_password: DEFAULT_POOL_PASSWORD.into(),
            worker_name: "btc-lottery-pet".into(),
            cpu_threads: 1,
            performance_preset: PerformancePreset::Eco,
            enable_notifications: true,
            notify_on_jackpot: true,
            notify_on_share_accepted: false,
            notify_on_connection_error: true,
            heartbeat_interval: HeartbeatInterval::Off,
            notification_channel: NotificationChannel::LocalWindowsToast,
            webhook_url: String::new(),
            pet_profile_id: DEFAULT_PET_PROFILE_ID.into(),
        }
    }
}

impl AppConfig {
    pub(crate) fn normalized(mut self) -> Self {
        self.btc_address = self.btc_address.trim().to_owned();
        self.pool_host = self.pool_host.trim().to_owned();
        self.pool_password = normalize_pool_password(&self.pool_password);
        self.worker_name = self.worker_name.trim().to_owned();
        self.webhook_url = self.webhook_url.trim().to_owned();
        self.pet_profile_id = normalize_pet_profile_id(&self.pet_profile_id);

        if self.pool_host.is_empty() {
            self.pool_host = DEFAULT_POOL_HOST.into();
        }

        if is_known_pool_host(&self.pool_host)
            && (self.pool_port == 0 || self.pool_port == OLD_PUBLIC_POOL_PORT)
        {
            self.pool_port = DEFAULT_POOL_PORT;
        }

        if self.pool_port == 0 {
            self.pool_port = default_port_for_pool(&self.pool_host);
        }

        if self.worker_name.is_empty() {
            self.worker_name = "btc-lottery-pet".into();
        }

        let available_threads = available_parallelism();
        let recommended_threads = recommended_cpu_threads();
        self.cpu_threads = match self.performance_preset {
            PerformancePreset::Eco => 1,
            PerformancePreset::Normal => recommended_threads,
            PerformancePreset::Turbo => available_threads,
            PerformancePreset::Custom => self.cpu_threads.clamp(1, available_threads),
        };

        self
    }
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct SystemInfo {
    pub(crate) available_parallelism: usize,
    pub(crate) default_cpu_threads: usize,
    pub(crate) recommended_cpu_threads: usize,
}

pub(crate) fn available_parallelism() -> usize {
    thread::available_parallelism()
        .map(|count| count.get())
        .unwrap_or(1)
}

pub(crate) fn recommended_cpu_threads() -> usize {
    available_parallelism().min(2)
}

fn is_known_pool_host(pool_host: &str) -> bool {
    matches!(
        pool_host.trim().to_ascii_lowercase().as_str(),
        "public-pool.io" | "pool.nerdminer.io" | "pool.nerdminers.org"
    )
}

fn default_port_for_pool(_pool_host: &str) -> u16 {
    DEFAULT_POOL_PORT
}

pub(crate) fn normalize_pool_password(password: &str) -> String {
    let trimmed = password.trim();
    if trimmed.is_empty() {
        DEFAULT_POOL_PASSWORD.into()
    } else {
        trimmed.to_owned()
    }
}

fn normalize_pet_profile_id(profile_id: &str) -> String {
    let trimmed = profile_id.trim();
    if BUILTIN_PET_PROFILE_IDS.contains(&trimmed) {
        trimmed.to_owned()
    } else {
        DEFAULT_PET_PROFILE_ID.into()
    }
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    let config_dir = app
        .path()
        .app_config_dir()
        .map_err(|error| format!("failed to resolve app config directory: {error}"))?;

    fs::create_dir_all(&config_dir)
        .map_err(|error| format!("failed to create app config directory: {error}"))?;

    Ok(config_dir.join("config.json"))
}

fn ensure_config(app: &AppHandle) -> Result<PathBuf, String> {
    let path = config_path(app)?;

    if !path.exists() {
        fs::write(&path, DEFAULT_CONFIG)
            .map_err(|error| format!("failed to create default config: {error}"))?;
    }

    Ok(path)
}

fn config_temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    let timestamp = chrono::Utc::now().timestamp_millis();

    path.with_file_name(format!(
        "{file_name}.tmp-{}-{timestamp}",
        std::process::id()
    ))
}

pub(crate) fn replace_file_with_backup(source: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(source, destination)
            .map_err(|error| format!("failed to save config: {error}"));
    }

    let backup = destination.with_extension("json.bak");
    if backup.exists() {
        fs::remove_file(&backup)
            .map_err(|error| format!("failed to remove old config backup: {error}"))?;
    }

    fs::rename(destination, &backup)
        .map_err(|error| format!("failed to prepare config backup: {error}"))?;

    match fs::rename(source, destination) {
        Ok(()) => {
            let _ = fs::remove_file(&backup);
            Ok(())
        }
        Err(error) => match fs::rename(&backup, destination) {
            Ok(()) => Err(format!("failed to save config: {error}")),
            Err(restore_error) => Err(format!(
                "failed to save config: {error}; failed to restore previous config: {restore_error}"
            )),
        },
    }
}

pub(crate) fn backup_broken_config(path: &Path, contents: &str) -> Result<PathBuf, String> {
    let timestamp = chrono::Utc::now().timestamp_millis();
    let backup_path = path.with_file_name(format!("config.broken-{timestamp}.json"));

    fs::write(&backup_path, contents)
        .map_err(|error| format!("failed to back up broken config: {error}"))?;

    Ok(backup_path)
}

pub(crate) fn write_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let contents = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to encode config: {error}"))?;
    let path = config_path(app)?;
    let temp_path = config_temp_path(&path);
    let payload = format!("{contents}\n");

    let mut file = fs::File::create(&temp_path)
        .map_err(|error| format!("failed to create temporary config: {error}"))?;
    if let Err(error) = file.write_all(payload.as_bytes()) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to write temporary config: {error}"));
    }
    if let Err(error) = file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to flush temporary config: {error}"));
    }
    drop(file);

    if let Err(error) = replace_file_with_backup(&temp_path, &path) {
        let _ = fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(())
}

pub(crate) fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let path = ensure_config(app)?;
    let contents =
        fs::read_to_string(&path).map_err(|error| format!("failed to read config: {error}"))?;

    // If the saved config contains values that the current version can't parse,
    // fall back to the default config rather than crashing on startup.
    let config: AppConfig = match serde_json::from_str(&contents) {
        Ok(c) => c,
        Err(error) => {
            eprintln!("[Config] Failed to parse saved config: {error}. Using defaults.");
            match backup_broken_config(&path, &contents) {
                Ok(backup_path) => eprintln!(
                    "[Config] Backed up broken config to {}.",
                    backup_path.display()
                ),
                Err(backup_error) => eprintln!("[Config] {backup_error}."),
            }
            let default: AppConfig =
                serde_json::from_str(DEFAULT_CONFIG).expect("DEFAULT_CONFIG must always be valid");
            if let Err(write_error) = write_config(app, &default) {
                eprintln!("[Config] Failed to rewrite default config: {write_error}.");
            }
            default
        }
    };

    Ok(config.normalized())
}

pub(crate) fn reset_saved_config_to_safe_defaults(app: &AppHandle) -> Result<(), String> {
    let config = load_config(app)?;
    write_config(app, &config)
}
