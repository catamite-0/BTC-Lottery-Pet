use std::fs;

use serde::{Deserialize, Serialize};
use tauri::AppHandle;

use crate::algorithm_diagnostics::{
    diagnostic_algorithm_kernel_benchmark, AlgorithmKernelBenchmark, DIAGNOSTIC_SCHEMA_VERSION,
};
use crate::config::{
    load_config, normalize_pool_password, AppConfig, PerformancePreset, DEFAULT_POOL_PASSWORD,
};
use crate::ensure_log_dir;
use crate::notifications::{HeartbeatInterval, NotificationChannel};

#[derive(Clone, Debug, Serialize)]
pub(crate) struct DiagnosticConfig {
    pub(crate) pool_host: String,
    pub(crate) pool_port: u16,
    pub(crate) worker_name: String,
    pub(crate) cpu_threads: usize,
    pub(crate) performance_preset: PerformancePreset,
    pub(crate) pet_profile_id: String,
    pub(crate) enable_notifications: bool,
    pub(crate) notify_on_jackpot: bool,
    pub(crate) notify_on_share_accepted: bool,
    pub(crate) notify_on_connection_error: bool,
    pub(crate) heartbeat_interval: HeartbeatInterval,
    pub(crate) notification_channel: NotificationChannel,
}

#[derive(Clone, Debug, Serialize)]
pub(crate) struct DiagnosticSnapshot {
    pub(crate) diagnostic_schema_version: u32,
    pub(crate) generated_at: String,
    pub(crate) product_name: String,
    pub(crate) app_version: String,
    pub(crate) identifier: String,
    pub(crate) config: DiagnosticConfig,
    pub(crate) algorithm_kernel_benchmark: AlgorithmKernelBenchmark,
    pub(crate) log_path: String,
    pub(crate) recent_log_lines: Vec<String>,
    pub(crate) last_connection_error: Option<String>,
    pub(crate) redacted_fields: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct FrontendDiagnosticSection {
    pub(crate) title: String,
    pub(crate) body: String,
    #[serde(default, alias = "bodyJson", skip_serializing_if = "Option::is_none")]
    pub(crate) body_json: Option<serde_json::Value>,
}

#[derive(Clone, Debug, Serialize)]
struct DiagnosticBundle {
    diagnostic_bundle_schema_version: u32,
    generated_at: String,
    backend_snapshot: serde_json::Value,
    frontend_sections: Vec<FrontendDiagnosticSection>,
}

pub(crate) fn diagnostic_config(config: AppConfig) -> DiagnosticConfig {
    DiagnosticConfig {
        pool_host: config.pool_host,
        pool_port: config.pool_port,
        worker_name: config.worker_name,
        cpu_threads: config.cpu_threads,
        performance_preset: config.performance_preset,
        pet_profile_id: config.pet_profile_id,
        enable_notifications: config.enable_notifications,
        notify_on_jackpot: config.notify_on_jackpot,
        notify_on_share_accepted: config.notify_on_share_accepted,
        notify_on_connection_error: config.notify_on_connection_error,
        heartbeat_interval: config.heartbeat_interval,
        notification_channel: config.notification_channel,
    }
}

fn read_recent_log_lines(
    app: &AppHandle,
    max_lines: usize,
) -> Result<(String, Vec<String>), String> {
    let log_dir = ensure_log_dir(app)?;
    let log_path = log_dir.join("mining.log");
    let log_path_string = log_path.display().to_string();

    if !log_path.exists() {
        return Ok((log_path_string, Vec::new()));
    }

    let contents = fs::read_to_string(&log_path)
        .map_err(|error| format!("failed to read mining log for diagnostics: {error}"))?;
    let mut lines = contents
        .lines()
        .rev()
        .take(max_lines)
        .map(str::to_owned)
        .collect::<Vec<_>>();
    lines.reverse();

    Ok((log_path_string, lines))
}

pub(crate) fn sanitize_diagnostic_line(line: &str, config: &AppConfig) -> String {
    let mut sanitized = line.to_owned();
    for (value, replacement) in [
        (config.btc_address.trim(), "[redacted btc address]"),
        (config.webhook_url.trim(), "[redacted webhook url]"),
    ] {
        if !value.is_empty() {
            sanitized = sanitized.replace(value, replacement);
        }
    }

    let pool_password = normalize_pool_password(&config.pool_password);
    if pool_password != DEFAULT_POOL_PASSWORD {
        sanitized = sanitized.replace(&pool_password, "[redacted pool password]");
    }

    sanitized
}

pub(crate) fn diagnostic_redacted_fields(config: &AppConfig) -> Vec<String> {
    let mut fields = Vec::new();
    if !config.btc_address.trim().is_empty() {
        fields.push("btc_address".to_owned());
    }
    if normalize_pool_password(&config.pool_password) != DEFAULT_POOL_PASSWORD {
        fields.push("pool_password".to_owned());
    }
    if !config.webhook_url.trim().is_empty() {
        fields.push("webhook_url".to_owned());
    }
    fields
}

pub(crate) fn diagnostic_save_payload(
    snapshot: String,
    frontend_sections: Vec<FrontendDiagnosticSection>,
) -> Result<String, String> {
    if frontend_sections.is_empty() {
        return Ok(snapshot);
    }

    let backend_snapshot = serde_json::from_str(&snapshot)
        .map_err(|error| format!("failed to parse backend diagnostic snapshot: {error}"))?;
    let bundle = DiagnosticBundle {
        diagnostic_bundle_schema_version: 1,
        generated_at: chrono::Utc::now().to_rfc3339(),
        backend_snapshot,
        frontend_sections,
    };
    serde_json::to_string_pretty(&bundle)
        .map_err(|error| format!("failed to encode diagnostic bundle: {error}"))
}

pub(crate) fn build_diagnostic_snapshot(app: &AppHandle) -> Result<String, String> {
    let config = load_config(app)?;
    let redacted_fields = diagnostic_redacted_fields(&config);
    let (log_path, recent_log_lines) = read_recent_log_lines(app, 80)?;
    let recent_log_lines = recent_log_lines
        .into_iter()
        .map(|line| sanitize_diagnostic_line(&line, &config))
        .collect::<Vec<_>>();
    let last_connection_error = recent_log_lines
        .iter()
        .rev()
        .find(|line| line.to_ascii_lowercase().contains("connection error"))
        .cloned();
    let snapshot = DiagnosticSnapshot {
        diagnostic_schema_version: DIAGNOSTIC_SCHEMA_VERSION,
        generated_at: chrono::Utc::now().to_rfc3339(),
        product_name: app
            .config()
            .product_name
            .clone()
            .unwrap_or_else(|| "BTC Lottery Pet".into()),
        app_version: env!("CARGO_PKG_VERSION").into(),
        identifier: app.config().identifier.clone(),
        config: diagnostic_config(config),
        algorithm_kernel_benchmark: diagnostic_algorithm_kernel_benchmark(),
        log_path,
        recent_log_lines,
        last_connection_error,
        redacted_fields,
    };

    serde_json::to_string_pretty(&snapshot)
        .map_err(|error| format!("failed to encode diagnostic snapshot: {error}"))
}
