import { invoke } from "@tauri-apps/api/core";
import type {
  HeartbeatNotificationSnapshot,
  JackpotNotificationPayload,
  NotificationSettingsPayload,
} from "../../contracts/notifications";
import { TAURI_COMMANDS } from "../../contracts/tauriCommands";

export function notifyJackpot(
  settings: NotificationSettingsPayload,
  event: JackpotNotificationPayload,
) {
  return invoke<void>(TAURI_COMMANDS.notifyJackpot, { settings, event });
}

export function notifyShareAccepted(settings: NotificationSettingsPayload) {
  return invoke<void>(TAURI_COMMANDS.notifyShareAccepted, { settings });
}

export function notifyConnectionError(settings: NotificationSettingsPayload, status: string) {
  return invoke<void>(TAURI_COMMANDS.notifyConnectionError, { settings, status });
}

export function sendHeartbeatNotification(
  settings: NotificationSettingsPayload,
  snapshot: HeartbeatNotificationSnapshot,
) {
  return invoke<void>(TAURI_COMMANDS.sendHeartbeatNotification, { settings, snapshot });
}
