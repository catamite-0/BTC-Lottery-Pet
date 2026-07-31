use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, MutexGuard,
    },
    thread,
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

const CURRENT_CONFIG_SCHEMA_VERSION: u64 = 1;
const DEFAULT_CONFIG: &str = include_str!("../../../config.json");
const DEFAULT_POOL_HOST: &str = "public-pool.io";
const DEFAULT_POOL_PORT: u16 = 3333;
pub(crate) const DEFAULT_POOL_PASSWORD: &str = "x";
const DEFAULT_PET_PROFILE_ID: &str = "classic-slot";
const BUILTIN_PET_PROFILE_IDS: &[&str] = &["classic-slot"];
const OLD_PUBLIC_POOL_PORT: u16 = 21496;
const MAX_TEMP_CREATE_ATTEMPTS: usize = 16;

static CONFIG_IO_LOCK: Mutex<()> = Mutex::new(());
static CONFIG_TEMP_SEQUENCE: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Default, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
pub(crate) enum PerformancePreset {
    #[default]
    Eco,
    Normal,
    Turbo,
    Custom,
}

#[derive(Serialize)]
struct StoredAppConfig<'a> {
    config_schema_version: u64,
    #[serde(flatten)]
    config: &'a AppConfig,
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
        self.cpu_threads = match self.performance_preset {
            PerformancePreset::Eco => 1,
            PerformancePreset::Normal => recommended_cpu_threads(),
            PerformancePreset::Turbo => turbo_cpu_threads(),
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
    // Moderate default: about half the logical cores, capped so large machines
    // do not default to an aggressive thread count. At least one thread.
    (available_parallelism() / 2).clamp(1, 4)
}

pub(crate) fn turbo_cpu_threads() -> usize {
    // Leave one logical thread free so the desktop stays responsive while the
    // background pet mines. At least one thread.
    available_parallelism().saturating_sub(1).max(1)
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

fn saved_config_schema_version(value: &serde_json::Value) -> Result<u64, String> {
    match value.get("config_schema_version") {
        None => Ok(0),
        Some(version) => version
            .as_u64()
            .ok_or_else(|| "saved config has an invalid config_schema_version".to_string()),
    }
}

fn ensure_supported_config_schema(schema_version: u64) -> Result<(), String> {
    if schema_version > CURRENT_CONFIG_SCHEMA_VERSION {
        return Err(format!(
            "saved config schema {schema_version} is newer than supported schema {CURRENT_CONFIG_SCHEMA_VERSION}; the file was left unchanged"
        ));
    }

    Ok(())
}

fn migrate_legacy_config(config: AppConfig) -> AppConfig {
    migrate_legacy_config_for_available_threads(config, available_parallelism())
}

fn migrate_legacy_config_for_available_threads(
    mut config: AppConfig,
    available_threads: usize,
) -> AppConfig {
    let available_threads = available_threads.max(1);
    if matches!(
        config.performance_preset,
        PerformancePreset::Normal | PerformancePreset::Turbo
    ) {
        config.performance_preset = PerformancePreset::Custom;
    }
    config.cpu_threads = config.cpu_threads.clamp(1, available_threads);
    config
}

fn lock_config_io() -> MutexGuard<'static, ()> {
    CONFIG_IO_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner())
}

fn config_backup_path(path: &Path) -> PathBuf {
    path.with_extension("json.bak")
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

fn validate_config_contents(contents: &str) -> Result<(), String> {
    let raw: serde_json::Value = serde_json::from_str(contents)
        .map_err(|error| format!("saved config is not valid JSON: {error}"))?;
    let schema_version = saved_config_schema_version(&raw)?;
    ensure_supported_config_schema(schema_version)?;
    serde_json::from_value::<AppConfig>(raw)
        .map_err(|error| format!("saved config has invalid fields: {error}"))?;
    Ok(())
}

fn ensure_config_file(path: &Path, default_contents: &str) -> Result<(), String> {
    if path.exists() {
        return Ok(());
    }

    let backup = config_backup_path(path);
    if backup.exists() {
        if !backup.is_file() {
            return Err(format!(
                "config backup path is not a file: {}; default config was not written",
                backup.display()
            ));
        }

        let backup_contents = fs::read_to_string(&backup)
            .map_err(|error| format!("failed to read config backup: {error}"))?;
        validate_config_contents(&backup_contents).map_err(|error| {
            format!(
                "config backup {} is invalid and was left unchanged: {error}; default config was not written",
                backup.display()
            )
        })?;
        fs::rename(&backup, path)
            .map_err(|error| format!("failed to restore config backup: {error}"))?;
        return Ok(());
    }

    fs::write(path, default_contents)
        .map_err(|error| format!("failed to create default config: {error}"))
}

fn ensure_config(app: &AppHandle) -> Result<PathBuf, String> {
    let path = config_path(app)?;
    ensure_config_file(&path, DEFAULT_CONFIG)?;
    Ok(path)
}

fn config_temp_path(path: &Path) -> PathBuf {
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("config.json");
    let timestamp = chrono::Utc::now().timestamp_millis();
    let sequence = CONFIG_TEMP_SEQUENCE.fetch_add(1, Ordering::Relaxed);

    path.with_file_name(format!(
        "{file_name}.tmp-{}-{timestamp}-{sequence}",
        std::process::id()
    ))
}

fn create_config_temp_file(path: &Path, description: &str) -> Result<(PathBuf, fs::File), String> {
    for _ in 0..MAX_TEMP_CREATE_ATTEMPTS {
        let temp_path = config_temp_path(path);
        match fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp_path)
        {
            Ok(file) => return Ok((temp_path, file)),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(format!("failed to create {description}: {error}")),
        }
    }

    Err(format!(
        "failed to create {description}: exhausted unique temporary file names"
    ))
}

pub(crate) fn replace_file_with_backup(source: &Path, destination: &Path) -> Result<(), String> {
    if !destination.exists() {
        return fs::rename(source, destination)
            .map_err(|error| format!("failed to save config: {error}"));
    }

    let backup = config_backup_path(destination);
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

fn backup_legacy_config(path: &Path, contents: &str) -> Result<PathBuf, String> {
    let backup_path = path.with_file_name(format!(
        "config.pre-schema-{}.json",
        CURRENT_CONFIG_SCHEMA_VERSION
    ));

    if backup_path.is_file() {
        let existing = fs::read_to_string(&backup_path)
            .map_err(|error| format!("failed to read legacy config backup: {error}"))?;
        let existing_value = serde_json::from_str::<serde_json::Value>(&existing)
            .map_err(|error| format!("existing legacy config backup is invalid: {error}"))?;
        let current_value = serde_json::from_str::<serde_json::Value>(contents)
            .map_err(|error| format!("legacy config is invalid: {error}"))?;
        if existing_value != current_value {
            return Err(format!(
                "existing legacy config backup does not match the config being migrated: {}",
                backup_path.display()
            ));
        }
        return Ok(backup_path);
    }
    if backup_path.exists() {
        return Err(format!(
            "legacy config backup path is not a file: {}",
            backup_path.display()
        ));
    }

    let (temp_path, mut file) = create_config_temp_file(&backup_path, "legacy config backup")?;
    if let Err(error) = file.write_all(contents.as_bytes()) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to write legacy config backup: {error}"));
    }
    if let Err(error) = file.sync_all() {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to flush legacy config backup: {error}"));
    }
    drop(file);
    if let Err(error) = fs::rename(&temp_path, &backup_path) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("failed to save legacy config backup: {error}"));
    }

    Ok(backup_path)
}

fn encode_stored_config(config: &AppConfig) -> Result<String, String> {
    serde_json::to_string_pretty(&StoredAppConfig {
        config_schema_version: CURRENT_CONFIG_SCHEMA_VERSION,
        config,
    })
    .map_err(|error| format!("failed to encode config: {error}"))
}

fn write_config_unlocked(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let contents = encode_stored_config(config)?;
    let path = config_path(app)?;
    let payload = format!("{contents}\n");

    let (temp_path, mut file) = create_config_temp_file(&path, "temporary config")?;
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

fn recover_broken_config(
    app: &AppHandle,
    path: &Path,

    contents: &str,
    error: &str,
) -> Result<AppConfig, String> {
    eprintln!("[Config] Failed to parse saved config: {error}. Using defaults.");
    let backup_path = backup_broken_config(path, contents)?;
    eprintln!(
        "[Config] Backed up broken config to {}.",
        backup_path.display()
    );

    let default: AppConfig =
        serde_json::from_str(DEFAULT_CONFIG).expect("DEFAULT_CONFIG must always be valid");
    let default = default.normalized();
    write_config_unlocked(app, &default)?;
    Ok(default)
}

pub(crate) fn write_config(app: &AppHandle, config: &AppConfig) -> Result<(), String> {
    let _guard = lock_config_io();
    write_config_unlocked(app, config)
}

fn load_config_unlocked(app: &AppHandle) -> Result<AppConfig, String> {
    let path = ensure_config(app)?;
    let contents =
        fs::read_to_string(&path).map_err(|error| format!("failed to read config: {error}"))?;

    let raw: serde_json::Value = match serde_json::from_str(&contents) {
        Ok(value) => value,
        Err(error) => return recover_broken_config(app, &path, &contents, &error.to_string()),
    };
    let schema_version = saved_config_schema_version(&raw)?;
    ensure_supported_config_schema(schema_version)?;

    let config: AppConfig = match serde_json::from_value(raw) {
        Ok(config) => config,
        Err(error) => return recover_broken_config(app, &path, &contents, &error.to_string()),
    };

    if schema_version < CURRENT_CONFIG_SCHEMA_VERSION {
        let backup_path = backup_legacy_config(&path, &contents)?;
        let migrated = migrate_legacy_config(config).normalized();
        write_config_unlocked(app, &migrated)?;
        eprintln!(
            "[Config] Migrated legacy config and preserved the original at {}.",
            backup_path.display()
        );
        return Ok(migrated);
    }

    Ok(config.normalized())
}

pub(crate) fn reset_saved_config_to_safe_defaults(app: &AppHandle) -> Result<(), String> {
    let _guard = lock_config_io();
    let config = load_config_unlocked(app)?;
    write_config_unlocked(app, &config)
}

pub(crate) fn load_config(app: &AppHandle) -> Result<AppConfig, String> {
    let _guard = lock_config_io();
    load_config_unlocked(app)
}

#[cfg(test)]
mod migration_tests {
    use super::*;
    use std::{sync::mpsc, time::Duration};

    const LEGACY_V0_8_CONFIG: &str = include_str!("../../test-fixtures/config-v0.8.0.json");

    fn temp_test_dir(name: &str) -> PathBuf {
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "btc-lottery-pet-{name}-{}-{unique}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn stored_config_has_schema_without_adding_it_to_app_config() {
        let encoded = encode_stored_config(&AppConfig::default()).unwrap();
        let value: serde_json::Value = serde_json::from_str(&encoded).unwrap();

        assert_eq!(
            value
                .get("config_schema_version")
                .and_then(|value| value.as_u64()),
            Some(CURRENT_CONFIG_SCHEMA_VERSION)
        );
        let decoded: AppConfig = serde_json::from_value(value).unwrap();
        assert_eq!(decoded, AppConfig::default());
    }

    #[test]
    fn missing_schema_is_legacy_and_invalid_schema_is_rejected() {
        assert_eq!(
            saved_config_schema_version(&serde_json::json!({})).unwrap(),
            0
        );
        assert_eq!(
            saved_config_schema_version(&serde_json::json!({
                "config_schema_version": CURRENT_CONFIG_SCHEMA_VERSION
            }))
            .unwrap(),
            CURRENT_CONFIG_SCHEMA_VERSION
        );
        assert!(saved_config_schema_version(&serde_json::json!({
            "config_schema_version": "1"
        }))
        .is_err());
        assert!(ensure_supported_config_schema(CURRENT_CONFIG_SCHEMA_VERSION).is_ok());
        assert!(ensure_supported_config_schema(CURRENT_CONFIG_SCHEMA_VERSION + 1).is_err());
    }

    #[test]
    fn legacy_presets_preserve_effective_thread_count() {
        let old_normal = AppConfig {
            cpu_threads: 2,
            performance_preset: PerformancePreset::Normal,
            ..AppConfig::default()
        };
        let migrated = migrate_legacy_config_for_available_threads(old_normal, 8);
        assert_eq!(migrated.performance_preset, PerformancePreset::Custom);
        assert_eq!(migrated.cpu_threads, 2);

        let current_normal = AppConfig {
            cpu_threads: 4,
            performance_preset: PerformancePreset::Normal,
            ..AppConfig::default()
        };
        let migrated = migrate_legacy_config_for_available_threads(current_normal, 8);
        assert_eq!(migrated.performance_preset, PerformancePreset::Custom);
        assert_eq!(migrated.cpu_threads, 4);

        let old_turbo = AppConfig {
            cpu_threads: 8,
            performance_preset: PerformancePreset::Turbo,
            ..AppConfig::default()
        };
        let migrated = migrate_legacy_config_for_available_threads(old_turbo, 8);
        assert_eq!(migrated.performance_preset, PerformancePreset::Custom);
        assert_eq!(migrated.cpu_threads, 8);
    }

    #[test]
    fn matching_legacy_backup_is_reused_by_json_semantics() {
        let dir = temp_test_dir("legacy-config-backup");
        let config_path = dir.join("config.json");

        let original = r#"{"legacy":"first","nested":{"value":1}}"#;
        let equivalent = "{\n  \"nested\": { \"value\": 1 },\n  \"legacy\": \"first\"\n}";
        let first = backup_legacy_config(&config_path, original).unwrap();
        let second = backup_legacy_config(&config_path, equivalent).unwrap();

        assert_eq!(first, second);
        assert_eq!(fs::read_to_string(&first).unwrap(), original);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn mismatched_existing_legacy_backup_blocks_migration() {
        let dir = temp_test_dir("mismatched-legacy-config-backup");
        let config_path = dir.join("config.json");

        let first = backup_legacy_config(&config_path, r#"{"legacy":"first"}"#).unwrap();
        let result = backup_legacy_config(&config_path, r#"{"legacy":"second"}"#);

        assert!(result.is_err());
        assert!(result.unwrap_err().contains("does not match"));
        assert_eq!(fs::read_to_string(&first).unwrap(), r#"{"legacy":"first"}"#);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn legacy_fields_are_kept_only_in_the_backup() {
        let legacy = serde_json::json!({
            "btc_address": "",
            "cpu_threads": 2,
            "performance_preset": "normal",
            "heartbeat_interval": "1h",
            "notification_channel": "webhook",
            "webhook_url": "https://example.invalid/secret"
        });
        let config: AppConfig = serde_json::from_value(legacy).unwrap();
        let migrated = migrate_legacy_config_for_available_threads(config, 8);
        let stored: serde_json::Value =
            serde_json::from_str(&encode_stored_config(&migrated).unwrap()).unwrap();

        assert!(stored.get("heartbeat_interval").is_none());
        assert!(stored.get("notification_channel").is_none());
        assert!(stored.get("webhook_url").is_none());
    }

    #[test]
    fn complete_v0_8_fixture_migrates_to_current_schema_once() {
        let dir = temp_test_dir("complete-v0-8-migration");
        let config_path = dir.join("config.json");
        let raw: serde_json::Value = serde_json::from_str(LEGACY_V0_8_CONFIG).unwrap();

        assert_eq!(saved_config_schema_version(&raw).unwrap(), 0);
        let config: AppConfig = serde_json::from_value(raw).unwrap();
        let migrated = migrate_legacy_config(config).normalized();
        let backup_path = backup_legacy_config(&config_path, LEGACY_V0_8_CONFIG).unwrap();
        let encoded = encode_stored_config(&migrated).unwrap();
        let stored: serde_json::Value = serde_json::from_str(&encoded).unwrap();

        assert_eq!(fs::read_to_string(backup_path).unwrap(), LEGACY_V0_8_CONFIG);
        assert_eq!(
            saved_config_schema_version(&stored).unwrap(),
            CURRENT_CONFIG_SCHEMA_VERSION
        );
        assert!(
            ensure_supported_config_schema(saved_config_schema_version(&stored).unwrap()).is_ok()
        );
        assert!(stored.get("heartbeat_interval").is_none());
        assert!(stored.get("notification_channel").is_none());
        assert!(stored.get("webhook_url").is_none());

        let reloaded: AppConfig = serde_json::from_value(stored).unwrap();
        assert_eq!(reloaded.performance_preset, PerformancePreset::Custom);
        assert_eq!(reloaded.cpu_threads, available_parallelism().min(2));
        assert_eq!(reloaded.worker_name, "legacy-desk");
        assert_eq!(reloaded.pet_profile_id, DEFAULT_PET_PROFILE_ID);

        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_existing_legacy_backup_blocks_migration() {
        let dir = temp_test_dir("invalid-legacy-backup");
        let config_path = dir.join("config.json");
        let backup_path = dir.join(format!(
            "config.pre-schema-{}.json",
            CURRENT_CONFIG_SCHEMA_VERSION
        ));
        fs::write(&backup_path, "{").unwrap();

        let result = backup_legacy_config(&config_path, LEGACY_V0_8_CONFIG);
        assert!(result.is_err());
        assert_eq!(fs::read_to_string(&backup_path).unwrap(), "{");
        fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn config_io_lock_serializes_callers() {
        let first_guard = lock_config_io();
        let (started_sender, started_receiver) = mpsc::channel();
        let (acquired_sender, acquired_receiver) = mpsc::channel();
        let handle = thread::spawn(move || {
            started_sender.send(()).unwrap();
            let _guard = lock_config_io();
            acquired_sender.send(()).unwrap();
        });

        started_receiver.recv().unwrap();
        assert!(acquired_receiver
            .recv_timeout(Duration::from_millis(50))
            .is_err());
        drop(first_guard);
        acquired_receiver
            .recv_timeout(Duration::from_secs(1))
            .expect("second config caller should acquire the lock after release");
        handle.join().unwrap();
    }

    #[test]
    fn temporary_config_files_are_unique_and_created_without_clobbering() {
        let dir = temp_test_dir("unique-config-temp-files");
        let config_path = dir.join("config.json");

        let (first_path, mut first_file) =
            create_config_temp_file(&config_path, "first test config").unwrap();
        first_file.write_all(b"first").unwrap();
        first_file.sync_all().unwrap();
        drop(first_file);

        let (second_path, mut second_file) =
            create_config_temp_file(&config_path, "second test config").unwrap();
        second_file.write_all(b"second").unwrap();
        second_file.sync_all().unwrap();
        drop(second_file);

        assert_ne!(first_path, second_path);
        assert_eq!(fs::read_to_string(first_path).unwrap(), "first");
        assert_eq!(fs::read_to_string(second_path).unwrap(), "second");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_config_restores_valid_backup_before_using_defaults() {
        let dir = temp_test_dir("restore-valid-config-backup");
        let config_path = dir.join("config.json");
        let backup_path = config_backup_path(&config_path);
        let backup_contents = format!(
            "{}\n",
            encode_stored_config(&AppConfig {
                worker_name: "restored-worker".into(),
                ..AppConfig::default()
            })
            .unwrap()
        );
        fs::write(&backup_path, &backup_contents).unwrap();

        ensure_config_file(&config_path, DEFAULT_CONFIG).unwrap();

        assert_eq!(fs::read_to_string(&config_path).unwrap(), backup_contents);
        assert!(!backup_path.exists());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn invalid_backup_blocks_default_creation_and_is_left_unchanged() {
        let dir = temp_test_dir("invalid-config-backup-restore");
        let config_path = dir.join("config.json");
        let backup_path = config_backup_path(&config_path);
        fs::write(&backup_path, "{ broken").unwrap();

        let result = ensure_config_file(&config_path, DEFAULT_CONFIG);

        assert!(result.is_err());
        assert!(!config_path.exists());
        assert_eq!(fs::read_to_string(&backup_path).unwrap(), "{ broken");
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn future_schema_backup_blocks_default_creation_and_is_left_unchanged() {
        let dir = temp_test_dir("future-config-backup-restore");
        let config_path = dir.join("config.json");
        let backup_path = config_backup_path(&config_path);
        let mut future: serde_json::Value = serde_json::from_str(DEFAULT_CONFIG).unwrap();
        future["config_schema_version"] =
            serde_json::Value::from(CURRENT_CONFIG_SCHEMA_VERSION + 1);
        let future_contents = serde_json::to_string_pretty(&future).unwrap();
        fs::write(&backup_path, &future_contents).unwrap();

        let result = ensure_config_file(&config_path, DEFAULT_CONFIG);

        assert!(result.is_err());
        assert!(!config_path.exists());
        assert_eq!(fs::read_to_string(&backup_path).unwrap(), future_contents);
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn missing_config_without_backup_creates_defaults() {
        let dir = temp_test_dir("create-default-config");
        let config_path = dir.join("config.json");

        ensure_config_file(&config_path, DEFAULT_CONFIG).unwrap();

        assert_eq!(fs::read_to_string(&config_path).unwrap(), DEFAULT_CONFIG);
        fs::remove_dir_all(dir).unwrap();
    }
}
