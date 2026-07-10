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
  cpuThreadOptions: number[];
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
  cpuThreadOptions,
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
    </section>
  );
}
