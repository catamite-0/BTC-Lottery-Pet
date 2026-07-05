import { invoke } from "@tauri-apps/api/core";
import type { FrontendDiagnosticSection } from "../../contracts/diagnostics";
import { TAURI_COMMANDS } from "../../contracts/tauriCommands";

export function openLogFolder() {
  return invoke<void>(TAURI_COMMANDS.openLogFolder);
}

export function getLogPath() {
  return invoke<string>(TAURI_COMMANDS.getLogPath);
}

export function getDiagnosticSnapshot() {
  return invoke<string>(TAURI_COMMANDS.getDiagnosticSnapshot);
}

export function saveDiagnosticSnapshot(frontendSections: FrontendDiagnosticSection[]) {
  return invoke<string>(TAURI_COMMANDS.saveDiagnosticSnapshot, { frontendSections });
}
