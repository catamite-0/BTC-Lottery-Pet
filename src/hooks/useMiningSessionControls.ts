import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import { startRealMining, stopRealMining } from "../platform/tauri/miningClient";
import { useMiningEngineController } from "./useMiningEngineController";
import type { MiningEvent } from "../domain/miningEvents";
import { petStateLabel, type PetState } from "../domain/petState";
import type { MiningEngineKind } from "../engines/miningEngine";
import { formatError } from "../formatting";
import {
  realMiningStartError,
  resolveRuntimeMiningProfile,
  type AppConfig,
  type RealMiningStats,
  type RuntimeMiningProfile,
  type SystemInfo,
} from "../miningLogic";

interface LatestRef<T> {
  current: T;
}

interface UseMiningSessionControlsOptions {
  runningInTauri: boolean;
  config: AppConfig;
  systemInfo: SystemInfo;
  isMining: boolean;
  petState: PetState;
  isMiningRef: LatestRef<boolean>;
  setActiveMiningSessionId: Dispatch<SetStateAction<number | null>>;
  setMiningControlPending: Dispatch<SetStateAction<boolean>>;
  coolingDownTimerRef: MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setIsMining: Dispatch<SetStateAction<boolean>>;
  setMiningUptime: Dispatch<SetStateAction<number>>;
  setIsCoolingDown: Dispatch<SetStateAction<boolean>>;
  setActiveRuntimeProfile: Dispatch<SetStateAction<RuntimeMiningProfile | null>>;
  setRealStats: Dispatch<SetStateAction<RealMiningStats>>;
  setLastShare: Dispatch<SetStateAction<string>>;
  setAttentionEvent: Dispatch<SetStateAction<MiningEvent | null>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setShowCpuWarning: Dispatch<SetStateAction<boolean>>;
  appendPetLog: (message: string) => void;
}

export function useMiningSessionControls({
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
}: UseMiningSessionControlsOptions) {
  const startRealMiningConfirmed = async (runtimeProfile: RuntimeMiningProfile) => {
    setMiningControlPending(true);
    isMiningRef.current = true;
    setIsMining(true);
    setActiveRuntimeProfile(runtimeProfile);
    setRealStats((current) => ({
      ...current,
      hashrate: 0,
      accepted_shares: 0,
      rejected_shares: 0,
      stale_shares_dropped: 0,
      queued_shares_dropped: 0,
      best_difficulty: 0,
      share_difficulty: 0,
      current_job_id: "",
      connection_status: "Connecting",
    }));

    try {
      const sessionId = await startRealMining({
        poolHost: config.pool_host,
        poolPort: config.pool_port,
        poolPassword: config.pool_password,
        btcAddress: config.btc_address,
        workerName: config.worker_name,
        cpuThreads: runtimeProfile.cpuThreads,
        confirmedCpuUse: true,
      });
      setActiveMiningSessionId(sessionId);
    } catch (error) {
      isMiningRef.current = false;
      setIsMining(false);
      setActiveRuntimeProfile(null);
      setActiveMiningSessionId(null);
      setErrorMessage(String(error));
      setRealStats((current) => ({ ...current, connection_status: "Connection Error" }));
    } finally {
      setMiningControlPending(false);
    }
  };

  const prepareMiningStart = () => {
    setErrorMessage(null);
    setMiningUptime(0);
    setIsCoolingDown(false);
    setLastShare("None");
    setAttentionEvent(null);
    if (coolingDownTimerRef.current) {
      clearTimeout(coolingDownTimerRef.current);
      coolingDownTimerRef.current = null;
    }
  };

  const runtimeMiningProfileForConfig = () => resolveRuntimeMiningProfile(config, systemInfo);

  const startRealMiningSession = async () => {
    const startError = realMiningStartError(config);
    if (startError) {
      setErrorMessage(startError);
      setShowSettings(true);
      return;
    }

    const runtimeProfile = runtimeMiningProfileForConfig();
    const highCpuRequested =
      runtimeProfile.cpuThreads > 0 &&
      (config.performance_preset === "turbo" ||
        runtimeProfile.cpuThreads > systemInfo.recommended_cpu_threads);

    if (highCpuRequested) {
      setShowCpuWarning(true);
      return;
    }

    appendPetLog("I am listening for pool work.");
    await startRealMiningConfirmed(runtimeProfile);
  };

  const confirmCpuWarning = async () => {
    setShowCpuWarning(false);
    await startRealMiningConfirmed(runtimeMiningProfileForConfig());
  };

  const beginMiningCooldown = () => {
    isMiningRef.current = false;
    setIsMining(false);
    setActiveRuntimeProfile(null);
    setIsCoolingDown(true);
    setAttentionEvent(null);

    if (coolingDownTimerRef.current) {
      clearTimeout(coolingDownTimerRef.current);
    }
    coolingDownTimerRef.current = setTimeout(() => {
      setIsCoolingDown(false);
      coolingDownTimerRef.current = null;
    }, 4000);
  };

  const stopRealMiningSession = async () => {
    setMiningControlPending(true);
    beginMiningCooldown();
    appendPetLog("I am stepping away from the pool.");
    setRealStats((current) => ({
      ...current,
      hashrate: 0,
      connection_status: "Stopped",
    }));

    try {
      await stopRealMining();
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not stop mining: ${formatError(error)}`);
      }
    } finally {
      setActiveMiningSessionId(null);
      setMiningControlPending(false);
    }
  };

  const miningEngine = useMiningEngineController({
    lifecycle: {
      prepareStart: prepareMiningStart,
      startReal: startRealMiningSession,
      stopReal: stopRealMiningSession,
      status: (kind: MiningEngineKind) => ({
        kind,
        petState,
        running: isMining,
        label: petStateLabel(petState),
      }),
    },
  });

  return {
    miningEngine,
    miningEngineStatus: miningEngine.status(),
    startRealMiningConfirmed,
    runtimeMiningProfileForConfig,
    confirmCpuWarning,
  };
}
