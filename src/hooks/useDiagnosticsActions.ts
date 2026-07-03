import { invoke } from "@tauri-apps/api/core";
import type { Dispatch, SetStateAction } from "react";
import { parseBackendDiagnosticBridge } from "../domain/diagnosticSnapshotBridge";
import { formatError } from "../formatting";

interface FrontendDiagnosticSection {
  title: string;
  body: string;
  bodyJson?: unknown;
}

interface FrontendDiagnosticContext {
  backendDiagnosticSnapshot: ReturnType<typeof parseBackendDiagnosticBridge>;
}

interface UseDiagnosticsActionsArgs {
  runningInTauri: boolean;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setPetLogMessage: (message: string) => void;
  getDevLogSnapshot?: () => string;
  getFrontendDiagnosticSections?: (context: FrontendDiagnosticContext) => FrontendDiagnosticSection[];
}

export function useDiagnosticsActions({
  runningInTauri,
  setErrorMessage,
  setPetLogMessage,
  getDevLogSnapshot,
  getFrontendDiagnosticSections,
}: UseDiagnosticsActionsArgs) {

  const formatFrontendDiagnosticSection = (section: FrontendDiagnosticSection) =>
    `--- ${section.title} ---\n${section.body}`;
  const frontendSectionsForSnapshot = (snapshot: string) => {
    const backendDiagnosticSnapshot = parseBackendDiagnosticBridge(snapshot);
    return getFrontendDiagnosticSections?.({ backendDiagnosticSnapshot }) ?? [];
  };
  const structuredFrontendSectionsForSnapshot = (snapshot: string) => frontendSectionsForSnapshot(snapshot)
    .map((section) => {
      try {
        return { ...section, bodyJson: JSON.parse(section.body) };
      } catch {
        return section;
      }
    });
  const openLogs = async () => {
    setErrorMessage(null);

    try {
      await invoke("open_log_folder");
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
      const path = await invoke<string>("get_log_path");
      await navigator.clipboard.writeText(path);
      setPetLogMessage("Log path copied.");
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not copy log path: ${formatError(error)}`);
      } else {
        setErrorMessage("Log path copy is available in the desktop app.");
      }
    }
  };

  const copyDiagnostics = async () => {
    setErrorMessage(null);

    try {
      const snapshot = await invoke<string>("get_diagnostic_snapshot");

      const frontendSections = frontendSectionsForSnapshot(snapshot);

      const devLogSnapshot = getDevLogSnapshot?.();
      const diagnosticSections = [
        snapshot,
        ...frontendSections.map(formatFrontendDiagnosticSection),
        devLogSnapshot ? `--- Frontend DEV LOG ---\n${devLogSnapshot}` : "",
      ].filter(Boolean);
      await navigator.clipboard.writeText(diagnosticSections.join("\n\n"));
      setPetLogMessage("Diagnostic snapshot copied.");
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not copy diagnostics: ${formatError(error)}`);
      } else {
        setErrorMessage("Diagnostics export is available in the desktop app.");
      }
    }
  };

  const saveDiagnostics = async () => {
    setErrorMessage(null);

    try {
      const snapshot = await invoke<string>("get_diagnostic_snapshot");
      const frontendSections = structuredFrontendSectionsForSnapshot(snapshot);
      await invoke("save_diagnostic_snapshot", { frontendSections });
      setPetLogMessage("Diagnostic snapshot saved.");
    } catch (error) {
      if (runningInTauri) {
        setErrorMessage(`Could not save diagnostics: ${formatError(error)}`);
      } else {
        setErrorMessage("Diagnostics save is available in the desktop app.");
      }
    }
  };

  return {
    openLogs,
    copyLogPath,
    copyDiagnostics,
    saveDiagnostics,
  };
}
