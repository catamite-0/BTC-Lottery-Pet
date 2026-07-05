import { invoke } from "@tauri-apps/api/core";
import { TAURI_COMMANDS } from "../../contracts/tauriCommands";

export function setWindowAlwaysOnTop(alwaysOnTop: boolean) {
  return invoke<void>(TAURI_COMMANDS.setWindowAlwaysOnTop, { alwaysOnTop });
}
