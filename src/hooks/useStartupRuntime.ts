import { invoke } from "@tauri-apps/api/core";
import { useEffect } from "react";
import type { Dispatch, SetStateAction } from "react";
import type { BackendDiagnosticSnapshotBridge } from "../domain/diagnosticSnapshotBridge";
import type { DevLogEntry } from "../domain/miningLogs";
import { formatError } from "../formatting";
import { adaptConfigForHardware } from "../miningLogic";
import type { AppConfig, GpuDevice, SystemInfo } from "../miningLogic";

interface UseStartupRuntimeArgs {
  runningInTauri: boolean;
  fallbackConfig: AppConfig;
  fallbackSystemInfo: SystemInfo;
  fallbackGpuDevices: GpuDevice[];
  appendDevLog: (source: DevLogEntry["source"], message: string) => void;
  appendPetLog: (message: string) => void;
  loadBackendDiagnosticBridge: () => Promise<BackendDiagnosticSnapshotBridge>;
  setBackendDiagnosticBridge: Dispatch<SetStateAction<BackendDiagnosticSnapshotBridge>>;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setGpuDevices: Dispatch<SetStateAction<GpuDevice[]>>;
  setHardwareReady: Dispatch<SetStateAction<boolean>>;
  setSystemInfo: Dispatch<SetStateAction<SystemInfo>>;
}

export function useStartupRuntime({
  runningInTauri,
  fallbackConfig,
  fallbackSystemInfo,
  fallbackGpuDevices,
  appendDevLog,
  appendPetLog,
  loadBackendDiagnosticBridge,
  setBackendDiagnosticBridge,
  setConfig,
  setDraftConfig,
  setErrorMessage,
  setGpuDevices,
  setHardwareReady,
  setSystemInfo,
}: UseStartupRuntimeArgs) {
  useEffect(() => {
    let cancelled = false;

    const loadStartupState = async () => {
      const loadConfig = async () => {
        try {
          return await invoke<AppConfig>("get_config");
        } catch (error) {
          if (runningInTauri && !cancelled) {
            setErrorMessage(`Could not load settings: ${formatError(error)}`);
          }
          return fallbackConfig;
        }
      };

      const loadSystemInfo = async () => {
        try {
          return await invoke<SystemInfo>("get_system_info");
        } catch {
          return fallbackSystemInfo;
        }
      };

      const loadGpuDevices = async () => {
        try {
          return await invoke<GpuDevice[]>("get_gpu_devices");
        } catch (error) {
          appendDevLog("system", `GPU detection failed: ${formatError(error)}`);
          return fallbackGpuDevices;
        }
      };

      const [loadedConfig, detectedSystemInfo, detectedGpuDevices, detectedBackendDiagnosticBridge] = await Promise.all([
        loadConfig(),
        loadSystemInfo(),
        loadGpuDevices(),
        loadBackendDiagnosticBridge(),
      ]);
      if (cancelled) {
        return;
      }

      const gpuDiagnostics = detectedGpuDevices
        .map((device) => device.diagnostic)
        .filter((diagnostic): diagnostic is string => Boolean(diagnostic));
      if (gpuDiagnostics.length > 0) {
        appendDevLog("system", `GPU detection diagnostic: ${gpuDiagnostics.join(" ")}`);
      }

      const adaptation = adaptConfigForHardware(loadedConfig, detectedSystemInfo, detectedGpuDevices);
      if (adaptation.changed && adaptation.messages.length > 0) {
        appendDevLog("system", `Hardware adaptation: ${adaptation.messages.join(" ")}`);
        appendPetLog("Adjusted settings for this device.");
      }

      setSystemInfo(detectedSystemInfo);
      setGpuDevices(detectedGpuDevices);
      setBackendDiagnosticBridge(detectedBackendDiagnosticBridge);
      setConfig(adaptation.config);
      setDraftConfig(adaptation.config);
      setHardwareReady(true);
    };

    void loadStartupState();

    return () => {
      cancelled = true;
    };
  }, [
    appendDevLog,
    appendPetLog,
    fallbackConfig,
    fallbackGpuDevices,
    fallbackSystemInfo,
    loadBackendDiagnosticBridge,
    runningInTauri,
    setBackendDiagnosticBridge,
    setConfig,
    setDraftConfig,
    setErrorMessage,
    setGpuDevices,
    setHardwareReady,
    setSystemInfo,
  ]);
}
