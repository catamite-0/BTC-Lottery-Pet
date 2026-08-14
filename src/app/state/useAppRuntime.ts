import { useEffect, useRef, useState } from "react";
import { idleJackpotSequence, type JackpotSequenceSnapshot } from "../../domain/jackpotSequence";
import {
  derivePetState,
  petStatusFromState,
  type PetStatus,
} from "../../domain/petState";
import { createMiningDashboardViewModel } from "../miningDashboardViewModel";
import {
  fallbackConfig,
  fallbackSystemInfo,
  idleRealStats,
  runningInTauri,
} from "../appDefaults";
import { useDocumentVisibility } from "../../hooks/useDocumentVisibility";
import { useLogActions } from "../../hooks/useLogActions";
import { useJackpotFlow } from "../../hooks/useJackpotFlow";
import { useMiningEvents } from "../../hooks/useMiningEvents";
import { useStartupState } from "../../hooks/useStartupState";
import { useMiningSessionControls } from "../../hooks/useMiningSessionControls";
import { useSettingsActions } from "../../hooks/useSettingsActions";
import { useWindowShellControls } from "../../hooks/useWindowShellControls";
import { getPetProfile } from "../../pets/profiles";
import { threadsForPreset } from "../../domain/appConfig";
import type { AppConfig, SystemInfo } from "../../contracts/config";
import type { RealMiningStats, RuntimeMiningProfile } from "../../contracts/mining";
import { useLatestRef } from "./useLatestRef";
import { useMiningLogState } from "./useMiningLogState";

export function useAppRuntime() {
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
  const [lastShare, setLastShare] = useState("None");
  const [jackpotSequence, setJackpotSequence] =
    useState<JackpotSequenceSnapshot>(idleJackpotSequence);
  const [isCoolingDown, setIsCoolingDown] = useState(false);
  const [displayMode, setDisplayMode] = useState<"compact" | "detail">("compact");
  const [systemInfo, setSystemInfo] = useState<SystemInfo>(fallbackSystemInfo);
  const [hardwareReady, setHardwareReady] = useState(false);

  const windowVisible = useDocumentVisibility();
  const coolingDownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStartedAtRef = useRef(Date.now());
  const miningStartedAtRef = useRef<number | null>(null);
  const configRef = useLatestRef(config);
  const realStatsRef = useLatestRef(realStats);
  const isMiningRef = useLatestRef(isMining);
  const activeMiningSessionIdRef = useLatestRef(activeMiningSessionId);

  const {
    latestLog,
    petLogs,
    devLogs,
    lastMiningEvent,
    attentionEvent,
    setAttentionEvent,
    appendPetLog,
    appendDevLog,
    emitMiningEvent,
  } = useMiningLogState();

  useEffect(() => {
    return () => {
      if (coolingDownTimerRef.current) {
        clearTimeout(coolingDownTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (isMining) {
      miningStartedAtRef.current ??= Date.now();
      return;
    }

    miningStartedAtRef.current = null;
  }, [isMining]);

  useEffect(() => {
    if (!windowVisible) {
      return;
    }

    const syncUptime = () => {
      setAppUptime(Math.floor((Date.now() - appStartedAtRef.current) / 1000));
      if (miningStartedAtRef.current !== null) {
        setMiningUptime(Math.floor((Date.now() - miningStartedAtRef.current) / 1000));
      }
    };

    syncUptime();
    const timer = window.setInterval(syncUptime, 1_000);
    return () => window.clearInterval(timer);
  }, [windowVisible]);

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
    setErrorMessage,
    setRealStats,
    setLastShare,
    setJackpotSequence,
    appendDevLog,
    appendPetLog,
    emitMiningEvent,
  });

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
  }, [attentionEvent, setAttentionEvent]);

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
    petLogsCount: petLogs.length,
    devLogsCount: devLogs.length,
  });

  return {
    shell: {
      displayMode,
      setDisplayMode,
      alwaysOnTop,
      toggleAlwaysOnTop,
      errorMessage,
      setErrorMessage,
    },
    mining: {
      isMining,
      isCoolingDown,
      miningControlPending,
      realStats,
      lastShare,
      latestLog,
      effectiveCpuThreads,
      onStartMining: startMining,
      onStopMining: stopMining,
      openLogs,
      copyLogPath,
      dashboardViewModel,
    },
    pet: {
      activePetProfile,
      petState,
      petStatus,
      jackpotSequence,
      config,
    },
    settings: {
      showSettings,
      setShowSettings,
      draftConfig,
      setDraftConfig,
      saveSettings,
      systemInfo,
      hardwareReady,
    },
    overlays: {
      showCpuWarning,
      setShowCpuWarning,
      confirmCpuWarning,
      jackpotVisible,
      jackpotBlock,
      dismissJackpotSequence,
    },
  };
}

export type AppRuntimeModel = ReturnType<typeof useAppRuntime>;
