import type { MiningEvent } from "./miningEvents";

export type DevLogSource = "system" | "stratum" | "cpu";

export interface DevLogEntry {
  id: string;
  timestamp: string;
  source: DevLogSource;
  message: string;
}

export interface PetLogEntry {
  id: string;
  timestamp: string;
  message: string;
}

function entryId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createDevLogEntry(source: DevLogSource, message: string): DevLogEntry {
  return {
    id: entryId("dev"),
    timestamp: new Date().toISOString(),
    source,
    message,
  };
}

export function createPetLogEntry(message: string): PetLogEntry {
  return {
    id: entryId("pet"),
    timestamp: new Date().toISOString(),
    message,
  };
}

export function petLogMessageFromMiningEvent(event: MiningEvent) {
  switch (event.type) {
    case "hash_attempt":
      return null;
    case "share_accepted":
      return "I feel lucky...";
    case "share_rejected":
      return "That pattern slipped away.";
    case "block_candidate":
      return "Something is happening...";
    case "jackpot":
      return "I found a strange pattern...";
  }
}

export function latestPetLogMessage(entry: PetLogEntry | null) {
  return entry?.message ?? "Ready for CPU mining.";
}
