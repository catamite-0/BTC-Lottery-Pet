import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";
import {
  idleJackpotSequence,
  isJackpotOverlayVisible,
  jackpotPhaseDurationMs,
  nextJackpotPhase,
  type JackpotSequenceSnapshot,
} from "../domain/jackpotSequence";
import type { BlockFoundEvent } from "../contracts/mining";

interface UseJackpotFlowOptions {
  jackpotSequence: JackpotSequenceSnapshot;
  setJackpotSequence: Dispatch<SetStateAction<JackpotSequenceSnapshot>>;
}

export function useJackpotFlow({
  jackpotSequence,
  setJackpotSequence,
}: UseJackpotFlowOptions) {
  useEffect(() => {
    const duration = jackpotPhaseDurationMs(jackpotSequence.phase);
    if (duration === null) {
      return;
    }

    const sequenceId = jackpotSequence.id;
    const timer = window.setTimeout(() => {
      setJackpotSequence((current) => (
        current.id === sequenceId
          ? { ...current, phase: nextJackpotPhase(current.phase) }
          : current
      ));
    }, duration);

    return () => window.clearTimeout(timer);
  }, [jackpotSequence.id, jackpotSequence.phase, setJackpotSequence]);

  const dismissJackpotSequence = useCallback(() => {
    setJackpotSequence((current) => (
      current.phase === "idle" || current.phase === "complete"
        ? idleJackpotSequence
        : { ...current, phase: "complete" }
    ));
  }, [setJackpotSequence]);

  return {
    dismissJackpotSequence,
    jackpotVisible: isJackpotOverlayVisible(jackpotSequence),
    jackpotBlock: jackpotSequence.block as BlockFoundEvent | null,
  };
}
