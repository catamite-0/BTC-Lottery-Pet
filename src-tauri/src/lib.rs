mod app_adapter;
mod mining_runtime;

pub(crate) use app_adapter::{config, mining_settings, notifications};
pub(crate) use mining_runtime::{
    block as mining_block, connection as mining_connection, controller as miner,
    events as mining_events, hash as mining_hash, kernel as mining_kernel, log as mining_log,
    protocol as mining_protocol, state as mining_state, workers as mining_workers,
};

use std::{fs, path::PathBuf, process::Command};

use config::{
    available_parallelism, load_config, recommended_cpu_threads,
    reset_saved_config_to_safe_defaults, write_config, AppConfig, SystemInfo,
};
use miner::MiningController;
use mining_settings::RealMiningSettings;
use notifications::{JackpotNotificationEvent, NotificationSettings};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, State, WebviewWindow, WindowEvent,
};

#[tauri::command]
fn get_config(app: AppHandle) -> Result<AppConfig, String> {
    load_config(&app)
}

#[tauri::command]
fn save_config(app: AppHandle, config: AppConfig) -> Result<AppConfig, String> {
    let config = config.normalized();
    write_config(&app, &config)?;

    Ok(config)
}

#[tauri::command]
fn get_system_info() -> SystemInfo {
    let available_parallelism = available_parallelism();

    SystemInfo {
        available_parallelism,
        default_cpu_threads: 1,
        recommended_cpu_threads: recommended_cpu_threads(),
    }
}

#[tauri::command]
fn start_real_mining(
    app: AppHandle,
    state: State<'_, MiningController>,
    settings: RealMiningSettings,
) -> Result<u64, String> {
    state.start(app, settings)
}

#[tauri::command]
fn stop_real_mining(app: AppHandle, state: State<'_, MiningController>) -> Result<(), String> {
    state.stop(&app)
}

#[tauri::command]
fn notify_jackpot(
    app: AppHandle,
    settings: NotificationSettings,
    event: JackpotNotificationEvent,
) -> Result<(), String> {
    notifications::notify_jackpot(&app, settings, event);
    Ok(())
}

#[tauri::command]
fn notify_share_accepted(app: AppHandle, settings: NotificationSettings) -> Result<(), String> {
    notifications::notify_share_accepted(&app, settings);
    Ok(())
}

#[tauri::command]
fn notify_connection_error(
    app: AppHandle,
    settings: NotificationSettings,
    status: String,
) -> Result<(), String> {
    notifications::notify_connection_error(&app, settings, status);
    Ok(())
}

#[tauri::command]
fn get_log_path(app: AppHandle) -> Result<String, String> {
    Ok(ensure_log_dir(&app)?.display().to_string())
}

#[tauri::command]
fn open_log_folder(app: AppHandle) -> Result<(), String> {
    open_log_folder_impl(&app)
}

#[tauri::command]
fn set_window_always_on_top(window: WebviewWindow, always_on_top: bool) -> Result<(), String> {
    window
        .set_always_on_top(always_on_top)
        .map_err(|error| format!("failed to update always-on-top setting: {error}"))
}

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn hide_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

fn ensure_log_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let log_dir = app
        .path()
        .app_log_dir()
        .map_err(|error| format!("failed to locate log folder: {error}"))?;
    fs::create_dir_all(&log_dir)
        .map_err(|error| format!("failed to create log folder: {error}"))?;
    Ok(log_dir)
}

fn open_log_folder_impl(app: &AppHandle) -> Result<(), String> {
    let log_dir = ensure_log_dir(app)?;

    #[cfg(windows)]
    let mut command = Command::new("explorer");

    #[cfg(target_os = "macos")]
    let mut command = Command::new("open");

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = Command::new("xdg-open");

    command
        .arg(&log_dir)
        .spawn()
        .map_err(|error| format!("failed to open log folder: {error}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .manage(MiningController::default())
        .setup(|app| {
            reset_saved_config_to_safe_defaults(app.handle()).map_err(std::io::Error::other)?;

            let show = MenuItem::with_id(app, "show", "Show BTC Lottery Pet", true, None::<&str>)?;
            let hide = MenuItem::with_id(app, "hide", "Hide to Tray", true, None::<&str>)?;
            let open_logs = MenuItem::with_id(app, "open_logs", "Open Logs", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &hide, &open_logs, &quit])?;

            TrayIconBuilder::new()
                .icon(
                    app.default_window_icon()
                        .cloned()
                        .expect("bundled window icon"),
                )
                .tooltip("BTC Lottery Pet")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "hide" => hide_main_window(app),
                    "open_logs" => {
                        let _ = open_log_folder_impl(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_config,
            save_config,
            get_system_info,
            start_real_mining,
            stop_real_mining,
            notify_jackpot,
            notify_share_accepted,
            notify_connection_error,
            get_log_path,
            open_log_folder,
            set_window_always_on_top
        ])
        .run(tauri::generate_context!())
        .expect("error while running BTC Lottery Pet");
}

#[cfg(test)]
mod tests {
    use super::get_system_info;
    use crate::config::{
        available_parallelism, backup_broken_config, recommended_cpu_threads,
        replace_file_with_backup, turbo_cpu_threads, AppConfig, PerformancePreset,
    };
    #[test]
    fn normalizes_saved_config_to_safe_startup_values() {
        let config = AppConfig {
            cpu_threads: available_parallelism() + 5,
            performance_preset: PerformancePreset::Custom,
            ..AppConfig::default()
        };

        let normalized = config.normalized();

        assert_eq!(normalized.cpu_threads, available_parallelism());
    }

    #[test]
    fn removed_runtime_fields_are_ignored() {
        let config: AppConfig = serde_json::from_str(
            r#"{
                "removed_runtime_mode": "device",
                "removed_runtime_enabled": true,
                "removed_runtime_id": "simulated-device",
                "removed_runtime_endpoint": " device://future-miner ",
                "removed_runtime_polling_enabled": true
            }"#,
        )
        .unwrap();

        let normalized = config.normalized();
        let value = serde_json::to_value(normalized).unwrap();

        assert!(value.get("removed_runtime_mode").is_none());
        assert!(value.get("removed_runtime_enabled").is_none());
        assert!(value.get("removed_runtime_id").is_none());
        assert!(value.get("removed_runtime_endpoint").is_none());
        assert!(value.get("removed_runtime_polling_enabled").is_none());
    }

    #[test]
    fn migrates_known_pool_default_ports() {
        for pool_host in ["public-pool.io", "pool.nerdminer.io", "pool.nerdminers.org"] {
            let normalized = AppConfig {
                pool_host: pool_host.into(),
                pool_port: 21496,
                ..AppConfig::default()
            }
            .normalized();

            assert_eq!(normalized.pool_host, pool_host);
            assert_eq!(normalized.pool_port, 3333);
        }

        let custom = AppConfig {
            pool_host: "example.invalid".into(),
            pool_port: 21496,
            ..AppConfig::default()
        }
        .normalized();

        assert_eq!(custom.pool_host, "example.invalid");
        assert_eq!(custom.pool_port, 21496);
    }

    #[test]
    fn normalization_defaults_blank_worker_and_zero_port() {
        let config = AppConfig {
            pool_host: " example.invalid ".into(),
            pool_port: 0,
            worker_name: "   ".into(),
            ..AppConfig::default()
        };

        let normalized = config.normalized();

        assert_eq!(normalized.pool_host, "example.invalid");
        assert_eq!(normalized.pool_port, 3333);
        assert_eq!(normalized.worker_name, "btc-lottery-pet");
    }

    #[test]
    fn pet_profile_id_defaults_and_rejects_unknown_values() {
        let default = AppConfig::default().normalized();
        assert_eq!(default.pet_profile_id, "classic-slot");

        let known = AppConfig {
            pet_profile_id: " classic-slot ".into(),
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(known.pet_profile_id, "classic-slot");

        // Profiles that are no longer built in normalize back to the default.
        let unknown = AppConfig {
            pet_profile_id: "cyber-miner".into(),
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(unknown.pet_profile_id, "classic-slot");
    }

    #[test]
    fn performance_presets_control_cpu_threads() {
        let available_threads = available_parallelism();
        let recommended_threads = recommended_cpu_threads();

        let eco = AppConfig {
            performance_preset: PerformancePreset::Eco,
            cpu_threads: available_threads,
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(eco.cpu_threads, 1);

        let normal = AppConfig {
            performance_preset: PerformancePreset::Normal,
            cpu_threads: 1,
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(normal.cpu_threads, recommended_threads);

        let turbo = AppConfig {
            performance_preset: PerformancePreset::Turbo,
            cpu_threads: 1,
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(turbo.cpu_threads, turbo_cpu_threads());
        assert!(turbo.cpu_threads <= available_threads);

        let custom = AppConfig {
            performance_preset: PerformancePreset::Custom,
            cpu_threads: available_threads + 1,
            ..AppConfig::default()
        }
        .normalized();
        assert_eq!(custom.cpu_threads, available_threads);
    }

    #[test]
    fn reports_conservative_cpu_thread_defaults() {
        let info = get_system_info();

        assert!(info.available_parallelism >= 1);
        assert_eq!(info.default_cpu_threads, 1);
        assert!(info.recommended_cpu_threads >= 1);
        assert!(info.recommended_cpu_threads <= info.available_parallelism);
    }

    fn temp_test_dir(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "btc-lottery-pet-{name}-{}-{}",
            std::process::id(),
            chrono::Utc::now().timestamp_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn replace_file_with_backup_replaces_existing_config() {
        let dir = temp_test_dir("config-replace");
        let destination = dir.join("config.json");
        let source = dir.join("config.json.tmp");

        std::fs::write(&destination, "old config").unwrap();
        std::fs::write(&source, "new config").unwrap();

        replace_file_with_backup(&source, &destination).unwrap();

        assert_eq!(std::fs::read_to_string(&destination).unwrap(), "new config");
        assert!(!source.exists());
        assert!(!destination.with_extension("json.bak").exists());

        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn broken_config_backup_preserves_bad_payload() {
        let dir = temp_test_dir("config-broken");
        let config_path = dir.join("config.json");
        let backup = backup_broken_config(&config_path, "{ broken json").unwrap();

        assert!(backup
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("config.broken-"));
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "{ broken json");

        let _ = std::fs::remove_dir_all(dir);
    }
}
