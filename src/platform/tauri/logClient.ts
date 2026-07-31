import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "../../contracts/tauriCommands";

export function openLogFolder() {
  return invoke<void>(TAURI_COMMANDS.openLogFolder);
}

export function getLogPath() {
  return invoke<string>(TAURI_COMMANDS.getLogPath);
}
