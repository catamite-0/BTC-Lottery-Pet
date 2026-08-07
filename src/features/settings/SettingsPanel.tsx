import type { Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  PerformancePreset,
  SystemInfo,
} from "../../contracts/config";
import { getPetProfile } from "../../pets/profiles";
import CpuSettingsSection from "./CpuSettingsSection";
import NotificationSettingsSection from "./NotificationSettingsSection";
import PetSettingsSection from "./PetSettingsSection";
import PoolSettingsSection from "./PoolSettingsSection";

interface SettingsPanelProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setShowSettings: (show: boolean) => void;
  saveSettings: () => Promise<void>;
  systemInfo: SystemInfo;
  presetPort: (poolHost: string, currentPort: number) => number;
  threadsForPreset: (
    preset: PerformancePreset,
    systemInfo: SystemInfo,
    customThreads: number,
  ) => number;
  hardwareReady: boolean;
}

const settingsSections = [
  { id: "settings-pool", label: "Pool" },
  { id: "settings-cpu", label: "CPU" },
  { id: "settings-notifications", label: "Alerts" },
  { id: "settings-pet", label: "Pet" },
] as const;

export default function SettingsPanel({
  draftConfig,
  setDraftConfig,
  setShowSettings,
  saveSettings,
  systemInfo,
  presetPort,
  threadsForPreset,
  hardwareReady,
}: SettingsPanelProps) {
  const selectedPetProfile = getPetProfile(draftConfig.pet_profile_id);
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
    <section className="overlay" role="dialog" aria-modal="true" aria-label="Mining settings">
      <div className="settings-panel">
        <div className="panel-heading">
          <div>
            <p className="eyebrow">LOCAL CONFIG</p>
            <h2>Mining settings</h2>
          </div>
          <button className="close-button" onClick={() => setShowSettings(false)} type="button">
            X
          </button>
        </div>

        <nav className="settings-section-tabs" aria-label="Settings sections">
          {settingsSections.map((section) => (
            <button
              key={section.id}
              onClick={() => document.getElementById(section.id)?.scrollIntoView({ block: "start", behavior: "smooth" })}
              type="button"
            >
              {section.label}
            </button>
          ))}
        </nav>

        <div className="settings-content">
          <PoolSettingsSection
            draftConfig={draftConfig}
            setDraftConfig={setDraftConfig}
            presetPort={presetPort}
          />

          <CpuSettingsSection
            draftConfig={draftConfig}
            setDraftConfig={setDraftConfig}
            hardwareSummary={hardwareSummary}
            systemInfo={systemInfo}
            draftEffectiveCpuThreads={draftEffectiveCpuThreads}
            cpuThreadOptions={cpuThreadOptions}
            threadsForPreset={threadsForPreset}
          />

          <NotificationSettingsSection
            draftConfig={draftConfig}
            setDraftConfig={setDraftConfig}
          />

          <PetSettingsSection
            selectedPetProfile={selectedPetProfile}
          />
        </div>

        <div className="panel-actions">
          <span>CPU-only settings are applied before mining starts.</span>
          <button className="confirm-button" onClick={() => void saveSettings()} type="button">SAVE</button>
        </div>
      </div>
    </section>
  );
}
