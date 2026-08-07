import { useEffect, type Dispatch, type SetStateAction } from "react";
import { getConfig, getSystemInfo } from "../platform/tauri/configClient";
import { formatError } from "../domain/formatting";
import type { AppConfig, SystemInfo } from "../contracts/config";
import { adaptConfigForHardware } from "../domain/appConfig";

interface UseStartupStateOptions {
  runningInTauri: boolean;
  fallbackConfig: AppConfig;
  fallbackSystemInfo: SystemInfo;
  appendDevLog: (source: "system", message: string) => void;
  appendPetLog: (message: string) => void;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setConfig: Dispatch<SetStateAction<AppConfig>>;
  setDraftConfig: Dispatch<SetStateAction<AppConfig>>;
  setSystemInfo: Dispatch<SetStateAction<SystemInfo>>;
  setHardwareReady: Dispatch<SetStateAction<boolean>>;
}

export function useStartupState({
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
}: UseStartupStateOptions) {
  useEffect(() => {
    let cancelled = false;

    const loadStartupState = async () => {
      const loadConfig = async () => {
        try {
          return await getConfig();
        } catch (error) {
          if (runningInTauri && !cancelled) {
            setErrorMessage(`Could not load settings: ${formatError(error)}`);
          }
          return fallbackConfig;
        }
      };

      const loadSystemInfo = async () => {
        try {
          return await getSystemInfo();
        } catch {
          return fallbackSystemInfo;
        }
      };

      const [loadedConfig, detectedSystemInfo] = await Promise.all([
        loadConfig(),
        loadSystemInfo(),
      ]);
      if (cancelled) {
        return;
      }

      const adaptation = adaptConfigForHardware(loadedConfig, detectedSystemInfo);
      if (adaptation.changed && adaptation.messages.length > 0) {
        appendDevLog("system", `CPU runtime adaptation: ${adaptation.messages.join(" ")}`);
        appendPetLog("Adjusted settings for this device.");
      }

      setSystemInfo(detectedSystemInfo);
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
    fallbackSystemInfo,
    runningInTauri,
    setConfig,
    setDraftConfig,
    setErrorMessage,
    setHardwareReady,
    setSystemInfo,
  ]);
}
