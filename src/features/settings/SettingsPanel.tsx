import type { Dispatch, SetStateAction } from "react";
import type {
  AppConfig,
  PerformancePreset,
  PoolDiagnosticReport,
  SystemInfo,
} from "../../miningLogic";
import { getPetProfile } from "../../pets/profiles";
import CpuSettingsSection from "./CpuSettingsSection";
import DiagnosticsToolsSection from "./DiagnosticsToolsSection";
import NotificationSettingsSection from "./NotificationSettingsSection";
import PetSettingsSection from "./PetSettingsSection";
import PoolSettingsSection from "./PoolSettingsSection";

interface SettingsPanelProps {
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setShowSettings: (show: boolean) => void;
  saveSettings: () => Promise<void>;
  runPoolDiagnostic: () => Promise<void>;
  observedHashrate: number | null;
  observedSampleSeconds: number | null;
  observedCpuThreads: number | null;
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
  poolDiagnosticResult: PoolDiagnosticReport | null;
  systemInfo: SystemInfo;
  formatHashrate: (hashrate: number) => string;
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
  { id: "settings-diagnostics", label: "Diagnostics" },
] as const;

export default function SettingsPanel({
  draftConfig,
  setDraftConfig,
  setShowSettings,
  saveSettings,
  runPoolDiagnostic,
  observedHashrate,
  observedSampleSeconds,
  observedCpuThreads,
  acceptedShares,
  rejectedShares,
  staleSharesDropped,
  queuedSharesDropped,
  poolDiagnosticResult,
  systemInfo,
  formatHashrate,
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
            observedHashrate={observedHashrate}
            observedCpuThreads={observedCpuThreads}
            acceptedShares={acceptedShares}
            rejectedShares={rejectedShares}
            staleSharesDropped={staleSharesDropped}
            queuedSharesDropped={queuedSharesDropped}
            observedSampleSeconds={observedSampleSeconds}
            cpuThreadOptions={cpuThreadOptions}
            formatHashrate={formatHashrate}
            threadsForPreset={threadsForPreset}
          />

          <NotificationSettingsSection
            draftConfig={draftConfig}
            setDraftConfig={setDraftConfig}
          />

          <PetSettingsSection
            draftConfig={draftConfig}
            setDraftConfig={setDraftConfig}
            selectedPetProfile={selectedPetProfile}
          />

          <DiagnosticsToolsSection
            runPoolDiagnostic={runPoolDiagnostic}
            poolDiagnosticResult={poolDiagnosticResult}
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
