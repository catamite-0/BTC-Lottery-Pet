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
        <label>
          ENABLE NOTIFICATIONS
          <select
            value={draftConfig.enable_notifications ? "true" : "false"}
            onChange={(event) => setDraftConfig({ ...draftConfig, enable_notifications: event.target.value === "true" })}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>
          NOTIFY JACKPOT
          <select
            value={draftConfig.notify_on_jackpot ? "true" : "false"}
            onChange={(event) => setDraftConfig({ ...draftConfig, notify_on_jackpot: event.target.value === "true" })}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
        <label>
          NOTIFY SHARE
          <select
            value={draftConfig.notify_on_share_accepted ? "true" : "false"}
            onChange={(event) => setDraftConfig({ ...draftConfig, notify_on_share_accepted: event.target.value === "true" })}
          >
            <option value="false">Disabled</option>
            <option value="true">Enabled</option>
          </select>
        </label>
        <label>
          NOTIFY ERROR
          <select
            value={draftConfig.notify_on_connection_error ? "true" : "false"}
            onChange={(event) => setDraftConfig({ ...draftConfig, notify_on_connection_error: event.target.value === "true" })}
          >
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </select>
        </label>
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
