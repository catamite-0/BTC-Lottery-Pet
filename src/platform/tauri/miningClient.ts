import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  MiningBlockFoundPayload,
  MiningLogPayload,
  MiningRuntimeEventPayload,
  RealMiningStats,
  StartRealMiningSettings,
} from "../../contracts/mining";
import { TAURI_COMMANDS, TAURI_EVENTS } from "../../contracts/tauriCommands";

export interface TauriPayloadEvent<T> {
  payload: T;
}

export function listenToMiningStats(handler: (event: TauriPayloadEvent<RealMiningStats>) => void) {
  return listen<RealMiningStats>(TAURI_EVENTS.miningStats, handler);
}

export function listenToMiningLogs(handler: (event: TauriPayloadEvent<string | MiningLogPayload>) => void) {
  return listen<string | MiningLogPayload>(TAURI_EVENTS.miningLog, handler);
}

export function listenToMiningRuntimeEvents(handler: (event: TauriPayloadEvent<MiningRuntimeEventPayload>) => void) {
  return listen<MiningRuntimeEventPayload>(TAURI_EVENTS.miningEvent, handler);
}

export function listenToBlockFound(handler: (event: TauriPayloadEvent<MiningBlockFoundPayload>) => void) {
  return listen<MiningBlockFoundPayload>(TAURI_EVENTS.blockFound, handler);
}

export function startRealMining(settings: StartRealMiningSettings) {
  return invoke<number>(TAURI_COMMANDS.startRealMining, { settings });
}

export function stopRealMining() {
  return invoke<void>(TAURI_COMMANDS.stopRealMining);
}
