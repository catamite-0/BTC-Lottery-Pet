import { useMemo } from "react";
import {
  threadsForPreset,
  type AppConfig,
  type CpuRuntimeAlgorithmDiagnostic,
  type RealMiningStats,
  type RuntimeMiningProfile,
  type SystemInfo,
} from "../miningLogic";

const MIN_EFFICIENCY_OBSERVATION_SECONDS = 20;

export interface CpuTuningShareCounters {
  acceptedShares: number;
  rejectedShares: number;
  staleSharesDropped: number;
  queuedSharesDropped: number;
}

interface UseRuntimeAlgorithmSnapshotOptions {
  config: AppConfig;
  systemInfo: SystemInfo;
  isMining: boolean;
  miningUptime: number;
  realStats: RealMiningStats;
  activeRuntimeProfile: RuntimeMiningProfile | null;
  acceptedShares: number;
  rejectedShares: number;
}

export function useRuntimeAlgorithmSnapshot({
  config,
  systemInfo,
  isMining,
  miningUptime,
  realStats,
  activeRuntimeProfile,
  acceptedShares,
  rejectedShares,
}: UseRuntimeAlgorithmSnapshotOptions) {
  const currentTuningShareCounters = useMemo<CpuTuningShareCounters>(() => ({
    acceptedShares,
    rejectedShares,
    staleSharesDropped: realStats.stale_shares_dropped,
    queuedSharesDropped: realStats.queued_shares_dropped,
  }), [
    acceptedShares,
    realStats.queued_shares_dropped,
    realStats.stale_shares_dropped,
    rejectedShares,
  ]);

  const configuredCpuThreads = threadsForPreset(
    config.performance_preset,
    systemInfo,
    config.cpu_threads,
  );
  const effectiveCpuThreads = activeRuntimeProfile
    ? activeRuntimeProfile.cpuThreads
    : configuredCpuThreads;
  const hasEfficiencyObservation =
    isMining && miningUptime >= MIN_EFFICIENCY_OBSERVATION_SECONDS;
  const observedEfficiencyHashrate = hasEfficiencyObservation ? realStats.hashrate : null;
  const observedCpuThreads = hasEfficiencyObservation ? effectiveCpuThreads : null;
  const runtimeDiagnosticElapsedSeconds = hasEfficiencyObservation ? miningUptime : null;

  const runtimeAlgorithmDiagnostic = useMemo<CpuRuntimeAlgorithmDiagnostic>(() => ({
    runtimeRecommendation: null,
  }), []);

  return {
    effectiveCpuThreads,
    observedEfficiencyHashrate,
    observedCpuThreads,
    runtimeDiagnosticElapsedSeconds,
    runtimeDiagnosticShareCounters: currentTuningShareCounters,
    runtimeAlgorithmDiagnostic,
  };
}
