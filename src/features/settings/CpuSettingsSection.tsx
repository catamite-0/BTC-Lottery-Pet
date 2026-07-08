import type { Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  PerformancePreset,
  SystemInfo,
} from "../../miningLogic";

interface CpuSettingsSectionProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  hardwareSummary: string;
  systemInfo: SystemInfo;
  draftEffectiveCpuThreads: number;
  observedHashrate: number | null;
  observedCpuThreads: number | null;
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
  observedSampleSeconds: number | null;
  cpuThreadOptions: number[];
  formatHashrate: (hashrate: number) => string;
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

export default function CpuSettingsSection({
  draftConfig,
  setDraftConfig,
  hardwareSummary,
  systemInfo,
  draftEffectiveCpuThreads,
  observedHashrate,
  observedCpuThreads,
  acceptedShares,
  rejectedShares,
  staleSharesDropped,
  queuedSharesDropped,
  observedSampleSeconds,
  cpuThreadOptions,
  formatHashrate,
  threadsForPreset,
}: CpuSettingsSectionProps) {
  const setPerformancePreset = (performancePreset: PerformancePreset) => {
    setDraftConfig({
      ...draftConfig,
      performance_preset: performancePreset,
      cpu_threads: threadsForPreset(performancePreset, systemInfo, Number(draftConfig.cpu_threads)),
    });
  };

  return (
    <section id="settings-cpu" className="device-settings-panel settings-section-card" aria-label="CPU settings">
      <div className="settings-section-heading">
        <p className="eyebrow">CPU</p>
        <strong>{hardwareSummary}</strong>
      </div>
      <div className="device-summary-grid">
        <div><span>CPU</span><strong>{systemInfo.available_parallelism} logical</strong><small>{draftEffectiveCpuThreads} selected</small></div>
        <div><span>LIVE HASH</span><strong>{observedHashrate !== null ? formatHashrate(observedHashrate) : "Waiting"}</strong><small>{observedCpuThreads ?? draftEffectiveCpuThreads} CPU threads</small></div>
        <div><span>SHARES</span><strong>{acceptedShares}</strong><small>{rejectedShares} rejected</small></div>
      </div>
      <div className="form-grid">
        <div className="settings-field full-width">
          PERFORMANCE PRESET
          <div className="preset-choice-group" role="group" aria-label="Performance preset">
            {performancePresetOptions.map((option) => (
              <button
                aria-pressed={draftConfig.performance_preset === option.value}
                className={draftConfig.performance_preset === option.value ? "selected" : ""}
                key={option.value}
                onClick={() => setPerformancePreset(option.value)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label>
          CPU THREADS
          <select
            disabled={draftConfig.performance_preset !== "custom"}
            value={draftEffectiveCpuThreads}
            onChange={(event) => setDraftConfig({
              ...draftConfig,
              performance_preset: "custom",
              cpu_threads: Number(event.target.value),
            })}
          >
            {cpuThreadOptions.map((threads) => (
              <option key={threads} value={threads}>{threads} thread{threads === 1 ? "" : "s"}</option>
            ))}
          </select>
        </label>
      </div>
      <div className="tuning-session-summary" aria-label="CPU tuning evidence">
        <div><span>LIVE HASH</span><b>{observedHashrate !== null ? formatHashrate(observedHashrate) : "Waiting"}</b><small>CPU observation</small></div>
        <div><span>DROPS</span><b>{staleSharesDropped + queuedSharesDropped}</b><small>{observedSampleSeconds ?? 0}s window</small></div>
      </div>
    </section>
  );
}
