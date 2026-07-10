import type { Dispatch, SetStateAction } from "react";
import { formatError } from "../formatting";
import { getLogPath, openLogFolder } from "../platform/tauri/logClient";

interface UseLogActionsOptions {
  runningInTauri: boolean;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  appendPetLog: (message: string) => void;
}

export function useLogActions({
  runningInTauri,
  setErrorMessage,
  appendPetLog,
}: UseLogActionsOptions) {
  const openLogs = async () => {
    setErrorMessage(null);

    try {
      await openLogFolder();
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not open logs: ${formatError(error)}`);
      } else {
        setErrorMessage("Log folder is available in the desktop app.");
      }
    }
  };

  const copyLogPath = async () => {
    setErrorMessage(null);

    try {
      const path = await getLogPath();
      await navigator.clipboard.writeText(path);
      appendPetLog("Log path copied.");
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not copy log path: ${formatError(error)}`);
      } else {
        setErrorMessage("Log path copy is available in the desktop app.");
      }
    }
  };

  return { openLogs, copyLogPath };
}
