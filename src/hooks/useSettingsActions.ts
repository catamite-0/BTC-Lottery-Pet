import type { Dispatch, SetStateAction } from "react";
import { formatError } from "../formatting";
import { saveConfig } from "../platform/tauri/configClient";
import {
  adaptConfigForHardware,
  type AppConfig,
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
}: UseSettingsActionsOptions) {
  const saveSettings = async () => {
    setErrorMessage(null);

    const adaptation = adaptConfigForHardware(draftConfig, systemInfo);
    const settings = adaptation.config;
    if (adaptation.messages.length > 0) {
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

  return { saveSettings };
}
