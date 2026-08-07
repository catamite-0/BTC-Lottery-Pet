import { useCallback, useState } from "react";
import {
  createDevLogEntry,
  createPetLogEntry,
  latestPetLogMessage,
  type DevLogEntry,
  type PetLogEntry,
} from "../../domain/miningLogs";
import type { MiningEvent } from "../../domain/miningEvents";

export function useMiningLogState() {
  const [latestLog, setLatestLog] = useState("Ready for CPU mining.");
  const [petLogs, setPetLogs] = useState<PetLogEntry[]>([]);
  const [devLogs, setDevLogs] = useState<DevLogEntry[]>([]);
  const [lastMiningEvent, setLastMiningEvent] = useState<MiningEvent | null>(null);
  const [attentionEvent, setAttentionEvent] = useState<MiningEvent | null>(null);

  const appendPetLog = useCallback((message: string) => {
    const entry = createPetLogEntry(message);
    setPetLogs((current) => [entry, ...current].slice(0, 20));
    setLatestLog(latestPetLogMessage(entry));
  }, []);

  const appendDevLog = useCallback((source: DevLogEntry["source"], message: string) => {
    const entry = createDevLogEntry(source, message);
    setDevLogs((current) => [entry, ...current].slice(0, 80));
  }, []);

  // Attention / dashboard EVENT label only. Pet copy comes from miningRuntimeEffects.
  const emitMiningEvent = useCallback((event: MiningEvent) => {
    setLastMiningEvent(event);
    if (
      event.type === "share_accepted" ||
      event.type === "block_candidate" ||
      event.type === "jackpot"
    ) {
      setAttentionEvent(event);
    }
  }, []);

  return {
    latestLog,
    petLogs,
    devLogs,
    lastMiningEvent,
    attentionEvent,
    setAttentionEvent,
    appendPetLog,
    appendDevLog,
    emitMiningEvent,
  };
}
