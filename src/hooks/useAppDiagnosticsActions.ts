import type { Dispatch, SetStateAction } from "react";
import type { DevLogEntry } from "../domain/miningLogs";
import type { AppConfig, SystemInfo } from "../miningLogic";
import type { CpuTuningShareCounters } from "./useRuntimeAlgorithmSnapshot";
import { useDiagnosticsActions } from "./useDiagnosticsActions";

interface UseAppDiagnosticsActionsOptions {
  runningInTauri: boolean;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  appendPetLog: (message: string) => void;
  devLogs: DevLogEntry[];
  config: AppConfig;
  systemInfo: SystemInfo;
  observedEfficiencyHashrate: number | null;
  observedCpuThreads: number | null;
  runtimeDiagnosticElapsedSeconds: number | null;
  runtimeDiagnosticShareCounters: CpuTuningShareCounters;
  effectiveCpuThreads: number;
}

export function useAppDiagnosticsActions({
  runningInTauri,
  setErrorMessage,
  appendPetLog,
  devLogs,
  config,
  systemInfo,
  observedEfficiencyHashrate,
  observedCpuThreads,
  runtimeDiagnosticElapsedSeconds,
  runtimeDiagnosticShareCounters,
  effectiveCpuThreads,
}: UseAppDiagnosticsActionsOptions) {
  return useDiagnosticsActions({
    runningInTauri,
    setErrorMessage,
    setPetLogMessage: appendPetLog,
    getDevLogSnapshot: () => devLogs
      .slice(0, 40)
      .map((entry) => `[${entry.timestamp}] ${entry.source}: ${entry.message}`)
      .join("\n"),
    getFrontendDiagnosticSections: () => [
      {
        title: "Frontend CPU Runtime",
        body: JSON.stringify({
          mode: "cpu",
          poolHost: config.pool_host,
          poolPort: config.pool_port,
          performancePreset: config.performance_preset,
          configuredCpuThreads: config.cpu_threads,
          effectiveCpuThreads,
          availableCpuThreads: systemInfo.available_parallelism,
          recommendedCpuThreads: systemInfo.recommended_cpu_threads,
          observedHashrate: observedEfficiencyHashrate,
          observedCpuThreads,
          observedSampleSeconds: runtimeDiagnosticElapsedSeconds,
          shareCounters: runtimeDiagnosticShareCounters,
        }, null, 2),
      },
    ],
  });
}
