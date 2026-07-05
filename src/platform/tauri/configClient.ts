import { invoke } from "@tauri-apps/api/core";
import type { AppConfig, SystemInfo } from "../../contracts/config";
import { TAURI_COMMANDS } from "../../contracts/tauriCommands";

export function getConfig() {
  return invoke<AppConfig>(TAURI_COMMANDS.getConfig);
}

export function saveConfig(config: AppConfig) {
  return invoke<AppConfig>(TAURI_COMMANDS.saveConfig, { config });
}

export function getSystemInfo() {
  return invoke<SystemInfo>(TAURI_COMMANDS.getSystemInfo);
}
