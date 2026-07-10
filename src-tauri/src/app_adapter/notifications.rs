use serde::Deserialize;
use tauri::AppHandle;

use crate::mining_log::log_message;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct NotificationSettings {
    pub enable_notifications: bool,
    pub notify_on_jackpot: bool,
    pub notify_on_share_accepted: bool,
    pub notify_on_connection_error: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct JackpotNotificationEvent {
    pub pool: String,
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq)]
struct LocalNotification {
    title: String,
    body: String,
    play_sound: bool,
}

pub(crate) fn notify_jackpot(
    app: &AppHandle,
    settings: NotificationSettings,
    event: JackpotNotificationEvent,
) {
    run_actions(app, jackpot_actions(&settings, &event));
}

pub(crate) fn notify_share_accepted(app: &AppHandle, settings: NotificationSettings) {
    run_actions(app, share_accepted_actions(&settings));
}

pub(crate) fn notify_connection_error(
    app: &AppHandle,
    settings: NotificationSettings,
    status: String,
) {
    run_actions(app, connection_error_actions(&settings, &status));
}

fn jackpot_actions(
    settings: &NotificationSettings,
    event: &JackpotNotificationEvent,
) -> Vec<LocalNotification> {
    if !settings.enable_notifications || !settings.notify_on_jackpot {
        return Vec::new();
    }

    vec![LocalNotification {
        title: "BTC Lottery Pet JACKPOT".into(),
        body: format!(
            "Block candidate found on {}. Hash: {}",
            event.pool, event.hash
        ),
        play_sound: true,
    }]
}

fn share_accepted_actions(settings: &NotificationSettings) -> Vec<LocalNotification> {
    if !settings.enable_notifications || !settings.notify_on_share_accepted {
        return Vec::new();
    }

    vec![LocalNotification {
        title: "BTC Lottery Pet".into(),
        body: "Share accepted.".into(),
        play_sound: false,
    }]
}

fn connection_error_actions(
    settings: &NotificationSettings,
    status: &str,
) -> Vec<LocalNotification> {
    if !settings.enable_notifications || !settings.notify_on_connection_error {
        return Vec::new();
    }

    vec![LocalNotification {
        title: "BTC Lottery Pet connection warning".into(),
        body: status.to_owned(),
        play_sound: true,
    }]
}

fn run_actions(app: &AppHandle, actions: Vec<LocalNotification>) {
    // Use this app instance's identifier as the toast AppUserModelID so
    // notifications attribute to the installed app.
    let app_id = app.config().identifier.clone();
    for action in actions {
        if show_local_notification(&app_id, &action.title, &action.body, action.play_sound).is_err()
        {
            log_message(app, "[Warning] Local notification failed.");
        }
    }
}

fn show_local_notification(
    app_id: &str,
    title: &str,
    body: &str,
    play_sound: bool,
) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winrt_notification::{Sound, Toast};
        let mut toast = Toast::new(app_id).title(title).text1(body);
        if play_sound {
            toast = toast.sound(Some(Sound::SMS));
        } else {
            toast = toast.sound(None);
        }
        toast
            .show()
            .map_err(|error| format!("failed to show local notification: {:?}", error))?;
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (app_id, title, body, play_sound);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{
        connection_error_actions, jackpot_actions, share_accepted_actions,
        JackpotNotificationEvent, NotificationSettings,
    };

    fn settings() -> NotificationSettings {
        NotificationSettings {
            enable_notifications: true,
            notify_on_jackpot: true,
            notify_on_share_accepted: false,
            notify_on_connection_error: true,
        }
    }

    fn jackpot_event() -> JackpotNotificationEvent {
        JackpotNotificationEvent {
            pool: "public-pool.io:3333".into(),
            hash: "000000abc".into(),
        }
    }

    #[test]
    fn block_found_triggers_local_notification_with_sound() {
        let actions = jackpot_actions(&settings(), &jackpot_event());

        assert_eq!(actions.len(), 1);
        assert!(actions[0].play_sound);
        assert!(actions[0].body.contains("public-pool.io:3333"));
    }

    #[test]
    fn jackpot_notification_respects_disabled_setting() {
        let mut disabled = settings();
        disabled.notify_on_jackpot = false;
        assert!(jackpot_actions(&disabled, &jackpot_event()).is_empty());

        let mut all_off = settings();
        all_off.enable_notifications = false;
        assert!(jackpot_actions(&all_off, &jackpot_event()).is_empty());
    }

    #[test]
    fn share_accepted_notification_defaults_off() {
        assert!(share_accepted_actions(&settings()).is_empty());
    }

    #[test]
    fn connection_error_notification_respects_setting() {
        assert!(!connection_error_actions(&settings(), "Connection error").is_empty());

        let mut disabled = settings();
        disabled.notify_on_connection_error = false;
        assert!(connection_error_actions(&disabled, "Connection error").is_empty());
    }
}
