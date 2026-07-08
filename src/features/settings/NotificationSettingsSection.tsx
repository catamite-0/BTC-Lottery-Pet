import type { Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  HeartbeatInterval,
  NotificationChannel,
} from "../../miningLogic";

interface NotificationSettingsSectionProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
}

const notificationToggles: Array<{
  field:
    | "enable_notifications"
    | "notify_on_jackpot"
    | "notify_on_share_accepted"
    | "notify_on_connection_error";
  label: string;
}> = [
  { field: "enable_notifications", label: "Enable notifications" },
  { field: "notify_on_jackpot", label: "Notify jackpot" },
  { field: "notify_on_share_accepted", label: "Notify share" },
  { field: "notify_on_connection_error", label: "Notify error" },
];

export default function NotificationSettingsSection({
  draftConfig,
  setDraftConfig,
}: NotificationSettingsSectionProps) {
  return (
    <section id="settings-notifications" className="settings-section-card" aria-label="Notification settings">
      <div className="settings-section-heading">
        <p className="eyebrow">NOTIFICATIONS</p>
        <strong>Local alerts and optional webhook</strong>
      </div>
      <div className="form-grid">
        {notificationToggles.map((toggle) => (
          <label className="toggle-field" key={toggle.field}>
            <span>{toggle.label}</span>
            <input
              checked={draftConfig[toggle.field]}
              onChange={(event) => setDraftConfig({
                ...draftConfig,
                [toggle.field]: event.target.checked,
              })}
              type="checkbox"
            />
          </label>
        ))}
        <label>
          HEARTBEAT
          <select
            value={draftConfig.heartbeat_interval}
            onChange={(event) => setDraftConfig({ ...draftConfig, heartbeat_interval: event.target.value as HeartbeatInterval })}
          >
            <option value="off">Off</option>
            <option value="30min">30 min</option>
            <option value="1h">1 hour</option>
            <option value="6h">6 hours</option>
          </select>
        </label>
        <label>
          NOTIFICATION CHANNEL
          <select
            value={draftConfig.notification_channel}
            onChange={(event) => setDraftConfig({ ...draftConfig, notification_channel: event.target.value as NotificationChannel })}
          >
            <option value="local_windows_toast">Local Windows Toast</option>
            <option value="webhook">Webhook</option>
          </select>
        </label>
        <label className="full-width">
          WEBHOOK URL
          <input
            disabled={draftConfig.notification_channel !== "webhook"}
            value={draftConfig.webhook_url}
            onChange={(event) => setDraftConfig({ ...draftConfig, webhook_url: event.target.value })}
            placeholder="https://example.com/btc-lottery-pet"
          />
        </label>
      </div>
    </section>
  );
}
