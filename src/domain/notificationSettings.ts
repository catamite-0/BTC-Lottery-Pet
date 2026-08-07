import type { AppConfig } from "../contracts/config";
import type { NotificationSettingsPayload } from "../contracts/notifications";

export function notificationSettingsFromConfig(config: AppConfig): NotificationSettingsPayload {
  return {
    enableNotifications: config.enable_notifications,
    notifyOnJackpot: config.notify_on_jackpot,
    notifyOnShareAccepted: config.notify_on_share_accepted,
    notifyOnConnectionError: config.notify_on_connection_error,
  };
}
