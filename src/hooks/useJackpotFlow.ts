import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  idleJackpotSequence,
  isJackpotOverlayVisible,
  jackpotPhaseDurationMs,
  nextJackpotPhase,
  type JackpotSequenceSnapshot,
} from "../domain/jackpotSequence";
import type { BlockFoundEvent, RuntimeMiningProfile } from "../contracts/mining";

interface UseJackpotFlowOptions {
  jackpotSequence: JackpotSequenceSnapshot;
  setJackpotSequence: Dispatch<SetStateAction<JackpotSequenceSnapshot>>;
  startRealMiningConfirmed: (runtimeProfile: RuntimeMiningProfile) => Promise<void>;
  runtimeMiningProfileForConfig: () => RuntimeMiningProfile;
}

export function useJackpotFlow({
  jackpotSequence,
  setJackpotSequence,
  startRealMiningConfirmed,
  runtimeMiningProfileForConfig,
}: UseJackpotFlowOptions) {
  const startRealMiningConfirmedRef = useRef(startRealMiningConfirmed);
  const runtimeMiningProfileForConfigRef = useRef(runtimeMiningProfileForConfig);

  useEffect(() => {
    startRealMiningConfirmedRef.current = startRealMiningConfirmed;
    runtimeMiningProfileForConfigRef.current = runtimeMiningProfileForConfig;
  });

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

  useEffect(() => {
    if (jackpotSequence.phase !== "resume") {
      return;
    }

    let cancelled = false;
    const resumeMining = async () => {
      if (jackpotSequence.wasMining) {
        await startRealMiningConfirmedRef.current(runtimeMiningProfileForConfigRef.current());
      }

      if (!cancelled) {
        setJackpotSequence((current) => (
          current.id === jackpotSequence.id
            ? { ...current, phase: "complete" }
            : current
        ));
      }
    };

    void resumeMining();
    return () => {
      cancelled = true;
    };
  }, [
    jackpotSequence.id,
    jackpotSequence.phase,
    jackpotSequence.wasMining,
    setJackpotSequence,
  ]);

  const dismissJackpotSequence = useCallback(() => {
    setJackpotSequence((current) => (
      current.phase === "idle" || current.phase === "complete"
        ? idleJackpotSequence
        : { ...current, phase: "resume" }
    ));
  }, [setJackpotSequence]);

  return {
    dismissJackpotSequence,
    jackpotVisible: isJackpotOverlayVisible(jackpotSequence),
    jackpotBlock: jackpotSequence.block as BlockFoundEvent | null,
  };
}
