import type { Dispatch, SetStateAction } from "react";
import type { AppConfig } from "../../miningLogic";

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
        <strong>Local Windows alerts</strong>
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
      </div>
    </section>
  );
}
