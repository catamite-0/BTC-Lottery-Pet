import type { Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  PerformancePreset,
  SystemInfo,
} from "../../miningLogic";

const poolPresets = [
  { value: "public-pool.io", label: "public-pool.io" },
  { value: "pool.nerdminer.io", label: "pool.nerdminer.io" },
  { value: "pool.nerdminers.org", label: "pool.nerdminers.org" },
] as const;

export type PoolPresetId = (typeof poolPresets)[number]["value"] | "custom";

interface BasicSettingsSectionProps {
  draftConfig: AppConfig;
  selectedPoolPreset: PoolPresetId;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setSelectedPoolPreset: Dispatch<SetStateAction<PoolPresetId>>;
  systemInfo: SystemInfo;
  presetPort: (poolHost: string, currentPort: number) => number;
  threadsForPreset: (
    preset: PerformancePreset,
    systemInfo: SystemInfo,
    customThreads: number,
  ) => number;
}

const performancePresetOptions: Array<{ value: PerformancePreset; label: string }> = [
  { value: "eco", label: "Eco" },
  { value: "normal", label: "Normal" },
  { value: "turbo", label: "Turbo" },
  { value: "custom", label: "Custom" },
];

export function poolPresetForHost(poolHost: string): PoolPresetId {
  const normalizedHost = poolHost.trim().toLowerCase();
  return poolPresets.find((preset) => preset.value === normalizedHost)?.value ?? "custom";
}

export default function BasicSettingsSection({
  draftConfig,
  selectedPoolPreset,
  setDraftConfig,
  setSelectedPoolPreset,
  systemInfo,
  presetPort,
  threadsForPreset,
}: BasicSettingsSectionProps) {
  const selectPoolPreset = (poolPreset: PoolPresetId) => {
    setSelectedPoolPreset(poolPreset);
    if (poolPreset === "custom") {
      return;
    }

    setDraftConfig((current) => ({
      ...current,
      pool_host: poolPreset,
      pool_port: presetPort(poolPreset, current.pool_port),
    }));
  };
  const selectPerformancePreset = (performancePreset: PerformancePreset) => {
    setDraftConfig((current) => ({
      ...current,
      performance_preset: performancePreset,
      cpu_threads: threadsForPreset(
        performancePreset,
        systemInfo,
        Number(current.cpu_threads),
      ),
    }));
  };

  return (
    <>
      <section className="settings-section-card" aria-label="Basic pool settings">
        <div className="settings-section-heading">
          <p className="eyebrow">POOL</p>
          <strong>Address and preset</strong>
        </div>
        <div className="form-grid">
          <label className="full-width">
            BTC ADDRESS
            <input
              value={draftConfig.btc_address}
              onChange={(event) => setDraftConfig((current) => ({
                ...current,
                btc_address: event.target.value,
              }))}
              placeholder="bc1..."
            />
          </label>
          <label className="full-width">
            POOL PRESET
            <select
              value={selectedPoolPreset}
              onChange={(event) => selectPoolPreset(event.target.value as PoolPresetId)}
            >
              {poolPresets.map((preset) => (
                <option key={preset.value} value={preset.value}>{preset.label}</option>
              ))}
              <option value="custom">Custom</option>
            </select>
          </label>
        </div>
      </section>

      <section className="device-settings-panel settings-section-card" aria-label="Basic CPU settings">
        <div className="settings-section-heading">
          <p className="eyebrow">CPU</p>
          <strong>Performance preset</strong>
        </div>
        <div className="settings-field full-width">
          PERFORMANCE PRESET
          <div className="preset-choice-group" role="group" aria-label="Performance preset">
            {performancePresetOptions.map((option) => (
              <button
                aria-pressed={draftConfig.performance_preset === option.value}
                className={draftConfig.performance_preset === option.value ? "selected" : ""}
                key={option.value}
                onClick={() => selectPerformancePreset(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-section-card" aria-label="Basic notification settings">
        <div className="settings-section-heading">
          <p className="eyebrow">NOTIFICATIONS</p>
          <strong>Local Windows alerts</strong>
        </div>
        <div className="form-grid">
          <label className="toggle-field full-width">
            <span>Enable notifications</span>
            <input
              checked={draftConfig.enable_notifications}
              onChange={(event) => setDraftConfig((current) => ({
                ...current,
                enable_notifications: event.target.checked,
              }))}
              type="checkbox"
            />
          </label>
        </div>
      </section>
    </>
  );
}
