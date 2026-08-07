import { useCallback, useEffect, useState, useRef } from "react";
import AppShell from "./app/shell/AppShell";
import { idleJackpotSequence } from "./domain/jackpotSequence";
import type { JackpotSequenceSnapshot } from "./domain/jackpotSequence";
import {
  createDevLogEntry,
  createPetLogEntry,
  latestPetLogMessage,
  petLogMessageFromMiningEvent,
} from "./domain/miningLogs";
import type { DevLogEntry, PetLogEntry } from "./domain/miningLogs";
import type { MiningEvent } from "./domain/miningEvents";
import {
  derivePetState,
  petStatusFromState,
} from "./domain/petState";
import { createMiningDashboardViewModel } from "./app/miningDashboardViewModel";
import {
  fallbackConfig,
  fallbackSystemInfo,
  idleRealStats,
  runningInTauri,
} from "./app/appDefaults";
import { useBlockHeight } from "./hooks/useBlockHeight";
import { useLogActions } from "./hooks/useLogActions";
import { useJackpotFlow } from "./hooks/useJackpotFlow";
import { useMiningEvents } from "./hooks/useMiningEvents";
import { useStartupState } from "./hooks/useStartupState";
import { useMiningSessionControls } from "./hooks/useMiningSessionControls";
import { useSettingsActions } from "./hooks/useSettingsActions";
import { useWindowShellControls } from "./hooks/useWindowShellControls";
import { notificationSettingsFromConfig } from "./domain/notificationSettings";
import { getPetProfile } from "./pets/profiles";
import { threadsForPreset } from "./domain/appConfig";
import type { AppConfig, SystemInfo } from "./contracts/config";
import type { RealMiningStats, RuntimeMiningProfile } from "./contracts/mining";
import type { PetStatus } from "./domain/petState";

function useLatestRef<T>(val: T) {
  const ref = useRef(val);
  ref.current = val;
  return ref;
}

function App() {
  const [isMining, setIsMining] = useState(false);
  const [appUptime, setAppUptime] = useState(0);
  const [miningUptime, setMiningUptime] = useState(0);
  const [config, setConfig] = useState<AppConfig>(fallbackConfig);
  const [draftConfig, setDraftConfig] = useState<AppConfig>(fallbackConfig);
  const [showCpuWarning, setShowCpuWarning] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [realStats, setRealStats] = useState<RealMiningStats>(idleRealStats);
  const [activeRuntimeProfile, setActiveRuntimeProfile] = useState<RuntimeMiningProfile | null>(null);
  const [activeMiningSessionId, setActiveMiningSessionId] = useState<number | null>(null);
  const [miningControlPending, setMiningControlPending] = useState(false);
  const blockHeight = useBlockHeight();
  const [latestLog, setLatestLog] = useState("Ready for CPU mining.");
  const [petLogs, setPetLogs] = useState<PetLogEntry[]>([]);
  const [devLogs, setDevLogs] = useState<DevLogEntry[]>([]);
  const [lastMiningEvent, setLastMiningEvent] = useState<MiningEvent | null>(null);
  const [attentionEvent, setAttentionEvent] = useState<MiningEvent | null>(null);
  const [lastShare, setLastShare] = useState("None");
  const [jackpotSequence, setJackpotSequence] =
    useState<JackpotSequenceSnapshot>(idleJackpotSequence);

  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [displayMode, setDisplayMode] = useState<"compact" | "detail">("compact");
  const [systemInfo, setSystemInfo] = useState<SystemInfo>(fallbackSystemInfo);
  const [hardwareReady, setHardwareReady] = useState(false);
  const coolingDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const configRef = useLatestRef(config);
  const realStatsRef = useLatestRef(realStats);
  const isMiningRef = useLatestRef(isMining);
  const activeMiningSessionIdRef = useLatestRef(activeMiningSessionId);

  const appendPetLog = useCallback((message: string) => {
    const entry = createPetLogEntry(message);
    setPetLogs((current) => [entry, ...current].slice(0, 20));
    setLatestLog(latestPetLogMessage(entry));
  }, []);
  const appendDevLog = useCallback((source: DevLogEntry["source"], message: string) => {
    const entry = createDevLogEntry(source, message);
    setDevLogs((current) => [entry, ...current].slice(0, 80));
  }, []);
  const emitMiningEvent = useCallback((event: MiningEvent) => {
    if (event.level !== "LOW_LEVEL") {
      setLastMiningEvent(event);
      if (event.type === "share_accepted" || event.type === "block_candidate" || event.type === "jackpot") {
        setAttentionEvent(event);
      }

      const petMessage = petLogMessageFromMiningEvent(event);
      if (petMessage) {
        appendPetLog(petMessage);
      }
    }
  }, [appendPetLog]);

  // Component unmount cleanup
  useEffect(() => {
    return () => {
      if (coolingDownTimerRef.current) clearTimeout(coolingDownTimerRef.current);
    };
  }, []);

  // App Uptime Timer
  useEffect(() => {
    const timer = window.setInterval(() => {
      setAppUptime((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Mining Uptime Timer
  useEffect(() => {
    if (!isMining) return;
    const timer = window.setInterval(() => {
      setMiningUptime((value) => value + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [isMining]);

  useStartupState({
    runningInTauri,
    fallbackConfig,
    fallbackSystemInfo,
    appendDevLog,
    appendPetLog,
    setErrorMessage,
    setConfig,
    setDraftConfig,
    setSystemInfo,
    setHardwareReady,
  });

  useMiningEvents({
    runningInTauri,
    configRef,
    realStatsRef,
    isMiningRef,
    activeMiningSessionIdRef,
    setIsMining,
    setActiveMiningSessionId,
    setMiningControlPending,
    setErrorMessage,
    setRealStats,
    setLastShare,
    setJackpotSequence,
    appendDevLog,
    appendPetLog,
    emitMiningEvent,
  });

  // Track New Best Difficulty
  const activeBestDiff = realStats.best_difficulty;
  const prevBestDiffRef = useRef(0);

  useEffect(() => {
    if (activeMiningSessionId !== null) {
      prevBestDiffRef.current = 0;
    }
  }, [activeMiningSessionId]);

  useEffect(() => {
    if (!isMining) {
      prevBestDiffRef.current = activeBestDiff;
      return;
    }
    if (activeBestDiff > prevBestDiffRef.current) {
      if (prevBestDiffRef.current > 0) {
        appendPetLog("I found a sharper pattern.");
        prevBestDiffRef.current = activeBestDiff;
        return;
      }
      prevBestDiffRef.current = activeBestDiff;
    }
  }, [activeBestDiff, appendPetLog, isMining]);

  const { saveSettings } = useSettingsActions({
    runningInTauri,
    draftConfig,
    systemInfo,
    setConfig,
    setDraftConfig,
    setShowSettings,
    setErrorMessage,
    appendPetLog,
    appendDevLog,
  });

  const { alwaysOnTop, toggleAlwaysOnTop } = useWindowShellControls({
    runningInTauri,
    setErrorMessage,
  });

  const petStateContext = {
    isMining,
    isCoolingDown,
    attentionEventType: attentionEvent?.type ?? null,
    jackpotPhase: jackpotSequence.phase,
    connectionStatus: realStats.connection_status,
    currentJobId: realStats.current_job_id,
  };
  const petState = derivePetState(petStateContext);
  const petStatus: PetStatus = petStatusFromState(petState, petStateContext);
  const activePetProfile = getPetProfile(config.pet_profile_id);

  useEffect(() => {
    if (!attentionEvent) {
      return;
    }

    const timer = window.setTimeout(() => setAttentionEvent(null), 3000);
    return () => window.clearTimeout(timer);
  }, [attentionEvent]);

  const acceptedShares = realStats.accepted_shares;
  const rejectedShares = realStats.rejected_shares;
  const effectiveCpuThreads = activeRuntimeProfile
    ? activeRuntimeProfile.cpuThreads
    : threadsForPreset(config.performance_preset, systemInfo, Number(config.cpu_threads));
  const { openLogs, copyLogPath } = useLogActions({
    runningInTauri,
    setErrorMessage,
    appendPetLog,
  });
  const {
    startMining,
    stopMining,
    miningSessionStatus,
    startRealMiningConfirmed,
    runtimeMiningProfileForConfig,
    confirmCpuWarning,
  } = useMiningSessionControls({
    runningInTauri,
    config,
    systemInfo,
    isMining,
    petState,
    isMiningRef,
    setActiveMiningSessionId,
    setMiningControlPending,
    coolingDownTimerRef,
    setIsMining,
    setMiningUptime,
    setIsCoolingDown,
    setActiveRuntimeProfile,
    setRealStats,
    setLastShare,
    setAttentionEvent,
    setErrorMessage,
    setShowSettings,
    setShowCpuWarning,
    appendPetLog,
    appendDevLog,
  });
  const {
    dismissJackpotSequence,
    jackpotVisible,
    jackpotBlock,
  } = useJackpotFlow({
    jackpotSequence,
    setJackpotSequence,
    startRealMiningConfirmed,
    runtimeMiningProfileForConfig,
  });
  const dashboardViewModel = createMiningDashboardViewModel({
    config,
    systemInfo,
    activePetProfile,
    miningSessionStatus,
    realStats,
    isMining,
    petState,
    petStatus,
    latestLog,
    lastMiningEvent,
    acceptedShares,
    rejectedShares,
    activeBestDiff,
    effectiveCpuThreads,
    miningUptime,
    appUptime,
    blockHeight,
    petLogsCount: petLogs.length,
    devLogsCount: devLogs.length,
  });
  return (
    <AppShell
      displayMode={displayMode}
      setDisplayMode={setDisplayMode}
      activePetProfile={activePetProfile}
      petState={petState}
      petStatus={petStatus}
      jackpotSequence={jackpotSequence}
      config={config}
      isMining={isMining}
      isCoolingDown={isCoolingDown}
      miningControlPending={miningControlPending}
      alwaysOnTop={alwaysOnTop}
      toggleAlwaysOnTop={toggleAlwaysOnTop}
      dashboardViewModel={dashboardViewModel}
      realStats={realStats}
      blockHeight={blockHeight}
      onStartMining={startMining}
      onStopMining={stopMining}
      lastShare={lastShare}
      latestLog={latestLog}
      openLogs={openLogs}
      copyLogPath={copyLogPath}
      effectiveCpuThreads={effectiveCpuThreads}
      errorMessage={errorMessage}
      setErrorMessage={setErrorMessage}
      showCpuWarning={showCpuWarning}
      setShowCpuWarning={setShowCpuWarning}
      confirmCpuWarning={confirmCpuWarning}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
      draftConfig={draftConfig}
      setDraftConfig={setDraftConfig}
      saveSettings={saveSettings}
      systemInfo={systemInfo}
      hardwareReady={hardwareReady}
      jackpotVisible={jackpotVisible}
      jackpotBlock={jackpotBlock}
      dismissJackpotSequence={dismissJackpotSequence}
    />
  );
}

export default App;
