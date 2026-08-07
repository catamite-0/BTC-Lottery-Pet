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

export function latestPetLogMessage(entry: PetLogEntry | null) {
  return entry?.message ?? "Ready for CPU mining.";
}
