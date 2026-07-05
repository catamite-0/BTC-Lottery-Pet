import { useState, type Dispatch, type SetStateAction } from "react";
import { formatError } from "../formatting";
import { setWindowAlwaysOnTop } from "../platform/tauri/windowClient";

interface UseWindowShellControlsOptions {
  runningInTauri: boolean;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
}

export function useWindowShellControls({
  runningInTauri,
  setErrorMessage,
}: UseWindowShellControlsOptions) {
  const [alwaysOnTop, setAlwaysOnTop] = useState(true);

  const toggleAlwaysOnTop = async () => {
    setErrorMessage(null);

    const nextValue = !alwaysOnTop;

    try {
      await setWindowAlwaysOnTop(nextValue);
      setAlwaysOnTop(nextValue);
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not update always-on-top: ${formatError(error)}`);
        return;
      }

      setAlwaysOnTop(nextValue);
    }
  };

  return {
    alwaysOnTop,
    toggleAlwaysOnTop,
  };
}
