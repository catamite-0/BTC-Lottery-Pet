import { invoke } from "@tauri-apps/api/core";
import { useCallback, useState } from "react";
import {
  backendDiagnosticBridgeFromKernelBenchmark,
  emptyBackendDiagnosticBridge,
} from "../domain/diagnosticSnapshotBridge";
import type { BackendDiagnosticSnapshotBridge } from "../domain/diagnosticSnapshotBridge";
import type { HashKernelBenchmarkLike } from "../domain/hashKernelBenchmark";
import type { DevLogEntry } from "../domain/miningLogs";
import { formatError } from "../formatting";

interface UseAlgorithmDiagnosticsBridgeArgs {
  runningInTauri: boolean;
  appendDevLog: (source: DevLogEntry["source"], message: string) => void;
}

export function useAlgorithmDiagnosticsBridge({
  runningInTauri,
  appendDevLog,
}: UseAlgorithmDiagnosticsBridgeArgs) {
  const [backendDiagnosticBridge, setBackendDiagnosticBridge] =
    useState<BackendDiagnosticSnapshotBridge>(emptyBackendDiagnosticBridge);

  const loadBackendDiagnosticBridge = useCallback(async () => {
    if (!runningInTauri) {
      return emptyBackendDiagnosticBridge;
    }

    try {
      const benchmark = await invoke<HashKernelBenchmarkLike>("get_algorithm_kernel_benchmark");
      return backendDiagnosticBridgeFromKernelBenchmark(benchmark);
    } catch (error) {
      appendDevLog("diagnostic", `Algorithm diagnostic bridge unavailable: ${formatError(error)}`);
      return emptyBackendDiagnosticBridge;
    }
  }, [appendDevLog, runningInTauri]);

  const refreshBackendDiagnosticBridge = useCallback(async () => {
    const bridge = await loadBackendDiagnosticBridge();
    setBackendDiagnosticBridge(bridge);
    return bridge;
  }, [loadBackendDiagnosticBridge]);

  return {
    backendDiagnosticBridge,
    loadBackendDiagnosticBridge,
    refreshBackendDiagnosticBridge,
    setBackendDiagnosticBridge,
  };
}
