import type { Dispatch, SetStateAction } from "react";
import Header from "./Header";
import DashboardView from "../../features/dashboard/DashboardView";
import WidgetView from "../../features/dashboard/WidgetView";
import AppFooter from "../../features/dashboard/AppFooter";
import JackpotDialog from "../../features/jackpot/JackpotDialog";
import CpuWarningDialog from "../../features/mining/CpuWarningDialog";
import PetDisplay from "../../features/pet/PetDisplay";
import SettingsPanel from "../../features/settings/SettingsPanel";
import type { MiningDashboardViewModel } from "../miningDashboardViewModel";
import type { JackpotSequenceSnapshot } from "../../domain/jackpotSequence";
import type { PetState, PetStatus } from "../../domain/petState";
import type { MiningEngine } from "../../engines/miningEngine";
import type { PetProfile } from "../../pets/profiles";
import {
  formatDifficulty,
  formatHashrate,
  presetPort,
  threadsForPreset,
} from "../../miningLogic";
import type {
  AppConfig,
  BlockFoundEvent,
  PoolDiagnosticReport,
  RealMiningStats,
  SystemInfo,
} from "../../miningLogic";

interface AppShellProps {
  displayMode: "compact" | "detail";
  setDisplayMode: Dispatch<SetStateAction<"compact" | "detail">>;
  activePetProfile: PetProfile;
  petState: PetState;
  petStatus: PetStatus;
  jackpotSequence: JackpotSequenceSnapshot;
  config: AppConfig;
  isMining: boolean;
  isCoolingDown: boolean;
  miningControlPending: boolean;
  alwaysOnTop: boolean;
  toggleAlwaysOnTop: () => void;
  dashboardViewModel: MiningDashboardViewModel;
  realStats: RealMiningStats;
  blockHeight: string;
  miningEngine: MiningEngine;
  lastShare: string;
  latestLog: string;
  openLogs: () => Promise<void>;
  copyLogPath: () => Promise<void>;
  copyDiagnostics: () => Promise<void>;
  saveDiagnostics: () => Promise<void>;
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
  runPoolDiagnostic: () => Promise<void>;
  observedEfficiencyHashrate: number | null;
  runtimeDiagnosticElapsedSeconds: number | null;
  observedCpuThreads: number | null;
  acceptedShares: number;
  rejectedShares: number;
  poolDiagnosticResult: PoolDiagnosticReport | null;
  systemInfo: SystemInfo;
  hardwareReady: boolean;
  jackpotVisible: boolean;
  jackpotBlock: BlockFoundEvent | null;
  dismissJackpotSequence: () => void;
}

export default function AppShell({
  displayMode,
  setDisplayMode,
  activePetProfile,
  petState,
  petStatus,
  jackpotSequence,
  config,
  isMining,
  isCoolingDown,
  miningControlPending,
  alwaysOnTop,
  toggleAlwaysOnTop,
  dashboardViewModel,
  realStats,
  blockHeight,
  miningEngine,
  lastShare,
  latestLog,
  openLogs,
  copyLogPath,
  copyDiagnostics,
  saveDiagnostics,
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
  runPoolDiagnostic,
  observedEfficiencyHashrate,
  runtimeDiagnosticElapsedSeconds,
  observedCpuThreads,
  acceptedShares,
  rejectedShares,
  poolDiagnosticResult,
  systemInfo,
  hardwareReady,
  jackpotVisible,
  jackpotBlock,
  dismissJackpotSequence,
}: AppShellProps) {
  const {
    displayedHashrate,
    probabilitySnapshot,
    petCompanion,
    compactRuntimeLabel,
    statusClassName,
    isMiningAnimation,
    displayStatus,
    poolStatus,
    authStatus,
    jobStatus,
    metrics,
    resourceMetrics,
  } = dashboardViewModel;
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
      companion={petCompanion}
      petStatus={petStatus}
      isMiningAnimation={isMiningAnimation}
      displayMode={displayMode}
      compactRuntimeLabel={compactRuntimeLabel}
      displayedHashrate={displayedHashrate}
      realStats={realStats}
      blockHeight={blockHeight}
      formatDifficulty={formatDifficulty}
    />
  );
  const statusSummary = (
    <div className="status-copy">
      <p className="label">Status</p>
      <p className={`status ${statusClassName}`} title={petStatus}>
        {displayStatus}
      </p>
    </div>
  );
  const luckMeter = (
    <div className="luck-meter" title="Display-only luck meter">
      <span>Luck</span>
      <b>{probabilitySnapshot.luckMeter}%</b>
      <div>
        <i style={{ width: `${probabilitySnapshot.luckMeter}%` }} />
      </div>
    </div>
  );
  const controlButton = (
    <button
      className={isMining ? "control-button stop" : "control-button start"}
      disabled={isCoolingDown || miningControlPending}
      onClick={isMining ? miningEngine.stop : miningEngine.start}
      title={miningControlPending ? "Mining command is still running" : undefined}
      type="button"
    >
      {controlButtonLabel}
    </button>
  );

  return (
    <main className={`pet-shell ${displayMode} ${displayMode === "detail" ? "dashboard" : "widget"} pet-profile-${activePetProfile.id} ${petState === "LUCKY_EVENT" ? "lucky" : ""} jackpot-${jackpotSequence.phase}`}>
      <Header
        displayMode={displayMode}
        setDisplayMode={setDisplayMode}
        alwaysOnTop={alwaysOnTop}
        toggleAlwaysOnTop={toggleAlwaysOnTop}
        settingsDisabled={isMining}
        openSettings={() => setShowSettings(true)}
      />

      {displayMode === "detail" ? (
        <DashboardView
          petDisplay={petDisplay}
          statusSummary={statusSummary}
          luckMeter={luckMeter}
          controlButton={controlButton}
          displayedHashrate={displayedHashrate}
          poolStatus={poolStatus}
          authStatus={authStatus}
          jobStatus={jobStatus}
          lastShare={lastShare}
          metrics={metrics}
          resourceMetrics={resourceMetrics}
          latestLog={latestLog}
          openLogs={openLogs}
          copyLogPath={copyLogPath}
          copyDiagnostics={copyDiagnostics}
          saveDiagnostics={saveDiagnostics}
        />
      ) : (
        <WidgetView
          petDisplay={petDisplay}
          statusSummary={statusSummary}
          luckMeter={luckMeter}
          controlButton={controlButton}
          displayedHashrate={displayedHashrate}
          poolStatus={poolStatus}
          jobStatus={jobStatus}
        />
      )}

      <AppFooter
        poolStatus={poolStatus}
        engineStatus={dashboardViewModel.modeDescription}
        effectiveCpuThreads={effectiveCpuThreads}
      />

      {errorMessage && (
        <p className="error-banner" onClick={() => setErrorMessage(null)} title="Click to dismiss">
          {errorMessage}
        </p>
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
          runPoolDiagnostic={runPoolDiagnostic}
          observedHashrate={observedEfficiencyHashrate}
          observedSampleSeconds={runtimeDiagnosticElapsedSeconds}
          observedCpuThreads={observedCpuThreads}
          acceptedShares={acceptedShares}
          rejectedShares={rejectedShares}
          staleSharesDropped={realStats.stale_shares_dropped}
          queuedSharesDropped={realStats.queued_shares_dropped}
          poolDiagnosticResult={poolDiagnosticResult}
          systemInfo={systemInfo}
          formatHashrate={formatHashrate}
          presetPort={presetPort}
          threadsForPreset={threadsForPreset}
          hardwareReady={hardwareReady}
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
