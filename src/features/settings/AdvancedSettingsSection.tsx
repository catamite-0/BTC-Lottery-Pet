import type { Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  PerformancePreset,
  SystemInfo,
} from "../../miningLogic";

interface AdvancedSettingsSectionProps {
  draftConfig: AppConfig;
  hardwareReady: boolean;
  markPoolAsCustom: () => void;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  systemInfo: SystemInfo;
  threadsForPreset: (
    preset: PerformancePreset,
    systemInfo: SystemInfo,
    customThreads: number,
  ) => number;
}

const notificationToggles: Array<{
  field:
    | "notify_on_jackpot"
    | "notify_on_share_accepted"
    | "notify_on_connection_error";
  label: string;
}> = [
  { field: "notify_on_jackpot", label: "Notify jackpot" },
  { field: "notify_on_share_accepted", label: "Notify share" },
  { field: "notify_on_connection_error", label: "Notify error" },
];

export default function AdvancedSettingsSection({
  draftConfig,
  hardwareReady,
  markPoolAsCustom,
  setDraftConfig,
  systemInfo,
  threadsForPreset,
}: AdvancedSettingsSectionProps) {
  const draftEffectiveCpuThreads = threadsForPreset(
    draftConfig.performance_preset,
    systemInfo,
    Number(draftConfig.cpu_threads),
  );
  const cpuThreadOptions = Array.from(
    { length: Math.max(1, systemInfo.available_parallelism) },
    (_, index) => index + 1,
  );
  const hardwareSummary = hardwareReady ? "CPU runtime ready" : "detecting CPU runtime";

  return (
    <>
      <section className="settings-section-card" aria-label="Advanced pool settings">
        <div className="settings-section-heading">
          <p className="eyebrow">POOL</p>
          <strong>Custom connection</strong>
        </div>
        <div className="form-grid">
          <label>
            HOST
            <input
              value={draftConfig.pool_host}
              onChange={(event) => {
                markPoolAsCustom();
                setDraftConfig((current) => ({ ...current, pool_host: event.target.value }));
              }}
            />
          </label>
          <label>
            PORT
            <input
              type="number"
              value={draftConfig.pool_port}
              onChange={(event) => setDraftConfig((current) => ({
                ...current,
                pool_port: Number(event.target.value),
              }))}
            />
          </label>
          <label>
            WORKER
            <input
              value={draftConfig.worker_name}
              onChange={(event) => setDraftConfig((current) => ({
                ...current,
                worker_name: event.target.value,
              }))}
            />
          </label>
          <label>
            POOL PASSWORD / HINT
            <input
              type="password"
              autoComplete="off"
              value={draftConfig.pool_password}
              onChange={(event) => setDraftConfig((current) => ({
                ...current,
                pool_password: event.target.value,
              }))}
              placeholder="x or d=1"
            />
          </label>
        </div>
      </section>

      <section className="device-settings-panel settings-section-card" aria-label="Advanced CPU settings">
        <div className="settings-section-heading">
          <p className="eyebrow">CPU</p>
          <strong>{hardwareSummary}</strong>
        </div>
        <div className="device-summary-grid">
          <div>
            <span>CPU</span>
            <strong>{systemInfo.available_parallelism} logical</strong>
            <small>{draftEffectiveCpuThreads} selected</small>
          </div>
        </div>
        <div className="form-grid">
          <label className="full-width">
            CPU THREADS
            <select
              disabled={draftConfig.performance_preset !== "custom"}
              value={draftEffectiveCpuThreads}
              onChange={(event) => setDraftConfig((current) => ({
                ...current,
                performance_preset: "custom",
                cpu_threads: Number(event.target.value),
              }))}
            >
              {cpuThreadOptions.map((threads) => (
                <option key={threads} value={threads}>
                  {threads} thread{threads === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="settings-section-card" aria-label="Advanced notification settings">
        <div className="settings-section-heading">
          <p className="eyebrow">NOTIFICATIONS</p>
          <strong>Alert details</strong>
        </div>
        <div className="form-grid">
          {notificationToggles.map((toggle) => (
            <label className="toggle-field" key={toggle.field}>
              <span>{toggle.label}</span>
              <input
                checked={draftConfig[toggle.field]}
                onChange={(event) => setDraftConfig((current) => ({
                  ...current,
                  [toggle.field]: event.target.checked,
                }))}
                type="checkbox"
              />
            </label>
          ))}
        </div>
      </section>
    </>
  );
}
