import { useState, type Dispatch, type SetStateAction } from "react";
import type { DevLogEntry } from "../domain/miningLogs";
import { formatError } from "../formatting";
import { saveConfig } from "../platform/tauri/configClient";
import { diagnosePoolConnection } from "../platform/tauri/miningClient";
import {
  adaptConfigForHardware,
  normalizeAppConfig,
  type AppConfig,
  type PoolDiagnosticReport,
  type SystemInfo,
} from "../miningLogic";

interface UseSettingsActionsOptions {
  runningInTauri: boolean;
  draftConfig: AppConfig;
  systemInfo: SystemInfo;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setShowSettings: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  appendPetLog: (message: string) => void;
  appendDevLog: (source: DevLogEntry["source"], message: string) => void;
}

export function useSettingsActions({
  runningInTauri,
  draftConfig,
  systemInfo,
  setConfig,
  setDraftConfig,
  setShowSettings,
  setErrorMessage,
  appendPetLog,
  appendDevLog,
}: UseSettingsActionsOptions) {
  const [poolDiagnosticResult, setPoolDiagnosticResult] = useState<PoolDiagnosticReport | null>(null);

  const saveSettings = async () => {
    setErrorMessage(null);

    const adaptation = adaptConfigForHardware(draftConfig, systemInfo);
    const settings = adaptation.config;
    if (adaptation.messages.length > 0) {
      appendDevLog("system", `Settings adapted for this device: ${adaptation.messages.join(" ")}`);
      appendPetLog("Settings adjusted for this device.");
    }

    try {
      const savedSettings = await saveConfig(settings);
      setConfig(savedSettings);
      setDraftConfig(savedSettings);
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not save settings: ${formatError(error)}`);
        return;
      }

      setConfig(settings);
      setDraftConfig(settings);
    }

    setShowSettings(false);
  };

  const runPoolDiagnostic = async () => {
    setErrorMessage(null);
    setPoolDiagnosticResult(null);

    const settings = normalizeAppConfig(draftConfig, systemInfo);

    try {
      const result = await diagnosePoolConnection({
        poolHost: settings.pool_host,
        poolPort: settings.pool_port,
        poolPassword: settings.pool_password,
        btcAddress: settings.btc_address,
        workerName: settings.worker_name,
      });
      setPoolDiagnosticResult(result);
      appendDevLog("diagnostic", `Pool diagnostic: ${result.summary}`);
      appendPetLog("Pool diagnostic finished.");
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not run pool diagnostic: ${formatError(error)}`);
        return;
      }

      const result: PoolDiagnosticReport = {
        generated_at: new Date().toISOString(),
        pool: `${settings.pool_host}:${settings.pool_port}`,
        steps: [
          {
            name: "DESKTOP",
            status: "skipped",
            message: "Pool diagnostics require the desktop runtime.",
            duration_ms: 0,
          },
        ],
        summary: "Desktop runtime required for pool diagnostics.",
      };
      setPoolDiagnosticResult(result);
      appendDevLog("diagnostic", `Pool diagnostic: ${result.summary}`);
      appendPetLog("Pool diagnostic needs the desktop app.");
    }
  };

  return {
    poolDiagnosticResult,
    saveSettings,
    runPoolDiagnostic,
  };
}
