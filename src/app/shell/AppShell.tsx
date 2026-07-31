import type { Dispatch, SetStateAction } from "react";
import Header from "./Header";
import AppFooter from "../../features/dashboard/AppFooter";
import MainView from "../../features/dashboard/MainView";
import MiningControlPanel from "../../features/dashboard/MiningControlPanel";
import JackpotDialog from "../../features/jackpot/JackpotDialog";
import CpuWarningDialog from "../../features/mining/CpuWarningDialog";
import PetDisplay from "../../features/pet/PetDisplay";
import SettingsPanel from "../../features/settings/SettingsPanel";
import type { MiningDashboardViewModel } from "../miningDashboardViewModel";
import type { JackpotSequenceSnapshot } from "../../domain/jackpotSequence";
import type { PetState, PetStatus } from "../../domain/petState";
import type { MiningEngine } from "../../engines/miningEngine";
import type { PetProfile } from "../../pets/profiles";
import { formatDifficulty, presetPort, threadsForPreset } from "../../miningLogic";
import type {
  AppConfig,
  BlockFoundEvent,
  SystemInfo,
} from "../../miningLogic";

interface AppShellProps {
  detailsOpen: boolean;
  setDetailsOpen: Dispatch<SetStateAction<boolean>>;
  activePetProfile: PetProfile;
  petState: PetState;
  petStatus: PetStatus;
  jackpotSequence: JackpotSequenceSnapshot;
  isMining: boolean;
  isCoolingDown: boolean;
  miningControlPending: boolean;
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
  dashboardViewModel: MiningDashboardViewModel;
  miningEngine: MiningEngine;
  latestLog: string;
  openLogs: () => Promise<void>;
  copyLogPath: () => Promise<void>;
  effectiveCpuThreads: number;
  errorMessage: string | null;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  showCpuWarning: boolean;
  setShowCpuWarning: Dispatch<SetStateAction<boolean>>;
  confirmCpuWarning: () => Promise<void>;
  showSettings: boolean;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  draftConfig: AppConfig;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  saveSettings: () => Promise<void>;
  systemInfo: SystemInfo;
  hardwareReady: boolean;
  jackpotVisible: boolean;
  jackpotBlock: BlockFoundEvent | null;
  dismissJackpotSequence: () => void;
}

export default function AppShell({
  detailsOpen,
  setDetailsOpen,
  activePetProfile,
  petState,
  petStatus,
  jackpotSequence,
  isMining,
  isCoolingDown,
  miningControlPending,
  alwaysOnTop,
  toggleAlwaysOnTop,
  dashboardViewModel,
  miningEngine,
  latestLog,
  openLogs,
  copyLogPath,
  effectiveCpuThreads,
  errorMessage,
  setErrorMessage,
  showCpuWarning,
  setShowCpuWarning,
  confirmCpuWarning,
  showSettings,
  setShowSettings,
  draftConfig,
  setDraftConfig,
  saveSettings,
  systemInfo,
  hardwareReady,
  jackpotVisible,
  jackpotBlock,
  dismissJackpotSequence,
}: AppShellProps) {
  const controlButtonLabel = miningControlPending
    ? "Wait"
    : isCoolingDown
      ? "Cool"
      : isMining
        ? "Stop"
        : "Start";
  const petDisplay = (
    <PetDisplay
      petProfile={activePetProfile}
      companion={dashboardViewModel.petCompanion}
      petStatus={petStatus}
      isMiningAnimation={dashboardViewModel.isMiningAnimation}
    />
  );
  const controlPanel = (
    <MiningControlPanel
      displayedHashrate={dashboardViewModel.displayedHashrate}
      displayStatus={dashboardViewModel.displayStatus}
      statusClassName={dashboardViewModel.statusClassName}
      connectionStatus={dashboardViewModel.connectionStatus}
      controlButtonLabel={controlButtonLabel}
      controlDisabled={isCoolingDown || miningControlPending}
      isMining={isMining}
      onControl={isMining ? miningEngine.stop : miningEngine.start}
    />
  );

  return (
    <main className={`pet-shell main pet-profile-${activePetProfile.id} ${petState === "LUCKY_EVENT" ? "lucky" : ""} jackpot-${jackpotSequence.phase}`}>
      <Header
        detailsOpen={detailsOpen}
        toggleDetails={() => setDetailsOpen((open) => !open)}
        alwaysOnTop={alwaysOnTop}
        toggleAlwaysOnTop={toggleAlwaysOnTop}
        settingsDisabled={isMining}
        openSettings={() => setShowSettings(true)}
      />

      <MainView
        petDisplay={petDisplay}
        controlPanel={controlPanel}
        viewModel={dashboardViewModel}
        detailsOpen={detailsOpen}
        latestLog={latestLog}
        openLogs={openLogs}
        copyLogPath={copyLogPath}
      />

      <AppFooter
        poolStatus={dashboardViewModel.poolStatus}
        engineStatus={dashboardViewModel.modeDescription}
        effectiveCpuThreads={effectiveCpuThreads}
      />

      {errorMessage && !showSettings && (
        <button
          className="error-banner"
          onClick={() => setErrorMessage(null)}
          title="Dismiss error"
          type="button"
        >
          <span role="alert">{errorMessage}</span>
          <b>Dismiss</b>
        </button>
      )}

      {showCpuWarning && (
        <CpuWarningDialog
          setShowCpuWarning={setShowCpuWarning}
          confirmCpuWarning={confirmCpuWarning}
        />
      )}

      {showSettings && (
        <SettingsPanel
          draftConfig={draftConfig}
          setDraftConfig={setDraftConfig}
          setShowSettings={setShowSettings}
          saveSettings={saveSettings}
          systemInfo={systemInfo}
          presetPort={presetPort}
          threadsForPreset={threadsForPreset}
          hardwareReady={hardwareReady}
          errorMessage={errorMessage}
          dismissError={() => setErrorMessage(null)}
        />
      )}

      {jackpotVisible && jackpotBlock && (
        <JackpotDialog
          jackpotSequence={jackpotSequence}
          jackpotBlock={jackpotBlock}
          formatDifficulty={formatDifficulty}
          openLogs={openLogs}
          dismissJackpotSequence={dismissJackpotSequence}
        />
      )}
    </main>
  );
}
