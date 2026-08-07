import Header from "./Header";
import DashboardView from "../../features/dashboard/DashboardView";
import WidgetView from "../../features/dashboard/WidgetView";
import AppFooter from "../../features/dashboard/AppFooter";
import JackpotDialog from "../../features/jackpot/JackpotDialog";
import CpuWarningDialog from "../../features/mining/CpuWarningDialog";
import PetDisplay from "../../features/pet/PetDisplay";
import SettingsPanel from "../../features/settings/SettingsPanel";
import { presetPort, threadsForPreset } from "../../domain/appConfig";
import { formatDifficulty } from "../../domain/miningFormatters";
import type { AppRuntimeModel } from "../state/useAppRuntime";

export default function AppShell({
  shell,
  mining,
  pet,
  settings,
  overlays,
}: AppRuntimeModel) {
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
  } = mining.dashboardViewModel;

  const controlButtonLabel = mining.miningControlPending
    ? "Wait"
    : mining.isCoolingDown
      ? "Cool"
      : mining.isMining
        ? "Stop"
        : "Start";

  const petDisplay = (
    <PetDisplay
      petProfile={pet.activePetProfile}
      companion={petCompanion}
      petStatus={pet.petStatus}
      isMiningAnimation={isMiningAnimation}
      displayMode={shell.displayMode}
      compactRuntimeLabel={compactRuntimeLabel}
      displayedHashrate={displayedHashrate}
      realStats={mining.realStats}
      blockHeight={mining.blockHeight}
      formatDifficulty={formatDifficulty}
    />
  );

  const statusSummary = (
    <div className="status-copy">
      <p className="label">Status</p>
      <p className={`status ${statusClassName}`} title={pet.petStatus}>
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
      className={mining.isMining ? "control-button stop" : "control-button start"}
      disabled={mining.isCoolingDown || mining.miningControlPending}
      onClick={mining.isMining ? mining.onStopMining : mining.onStartMining}
      title={mining.miningControlPending ? "Mining command is still running" : undefined}
      type="button"
    >
      {controlButtonLabel}
    </button>
  );

  return (
    <main
      className={`pet-shell ${shell.displayMode} ${shell.displayMode === "detail" ? "dashboard" : "widget"} pet-profile-${pet.activePetProfile.id} ${pet.petState === "LUCKY_EVENT" ? "lucky" : ""} jackpot-${pet.jackpotSequence.phase}`}
    >
      <Header
        displayMode={shell.displayMode}
        setDisplayMode={shell.setDisplayMode}
        alwaysOnTop={shell.alwaysOnTop}
        toggleAlwaysOnTop={shell.toggleAlwaysOnTop}
        settingsDisabled={mining.isMining}
        openSettings={() => settings.setShowSettings(true)}
      />

      {shell.displayMode === "detail" ? (
        <DashboardView
          petDisplay={petDisplay}
          statusSummary={statusSummary}
          luckMeter={luckMeter}
          controlButton={controlButton}
          displayedHashrate={displayedHashrate}
          poolStatus={poolStatus}
          authStatus={authStatus}
          jobStatus={jobStatus}
          lastShare={mining.lastShare}
          metrics={metrics}
          resourceMetrics={resourceMetrics}
          latestLog={mining.latestLog}
          openLogs={mining.openLogs}
          copyLogPath={mining.copyLogPath}
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
        engineStatus={mining.dashboardViewModel.modeDescription}
        effectiveCpuThreads={mining.effectiveCpuThreads}
      />

      {shell.errorMessage && (
        <p
          className="error-banner"
          onClick={() => shell.setErrorMessage(null)}
          title="Click to dismiss"
        >
          {shell.errorMessage}
        </p>
      )}

      {overlays.showCpuWarning && (
        <CpuWarningDialog
          setShowCpuWarning={overlays.setShowCpuWarning}
          confirmCpuWarning={overlays.confirmCpuWarning}
        />
      )}

      {settings.showSettings && (
        <SettingsPanel
          draftConfig={settings.draftConfig}
          setDraftConfig={settings.setDraftConfig}
          setShowSettings={settings.setShowSettings}
          saveSettings={settings.saveSettings}
          systemInfo={settings.systemInfo}
          presetPort={presetPort}
          threadsForPreset={threadsForPreset}
          hardwareReady={settings.hardwareReady}
        />
      )}

      {overlays.jackpotVisible && overlays.jackpotBlock && (
        <JackpotDialog
          jackpotSequence={pet.jackpotSequence}
          jackpotBlock={overlays.jackpotBlock}
          formatDifficulty={formatDifficulty}
          openLogs={mining.openLogs}
          dismissJackpotSequence={overlays.dismissJackpotSequence}
        />
      )}
    </main>
  );
}
