import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  listenToBlockFound,
  listenToMiningLogs,
  listenToMiningRuntimeEvents,
  listenToMiningStats,
  stopRealMining,
} from "../platform/tauri/miningClient";
import {
  notifyConnectionError,
  notifyJackpot,
  notifyShareAccepted,
} from "../platform/tauri/notificationClient";
import {
  createBlockCandidateEvent,
  createJackpotEvent,
  createShareEvent,
  type MiningEvent,
} from "../domain/miningEvents";
import {
  cleanMiningLogMessage,
  createStructuredMiningEventState,
  reduceStructuredMiningEvents,
  structuredMiningEventFromBlockCandidate,
  structuredMiningEventFromRuntimePayload,
} from "../domain/structuredMiningEvents";
import {
  startJackpotSequence,
  type JackpotSequenceSnapshot,
} from "../domain/jackpotSequence";
import { formatError } from "../formatting";
import type { AppConfig, RealMiningStats } from "../miningLogic";
import { notificationSettingsFromConfig } from "../notificationSettings";
import type { MiningEngineKind } from "../engines/miningEngine";

interface LatestRef<T> {
  current: T;
}

interface UseMiningEventsOptions {
  runningInTauri: boolean;
  configRef: LatestRef<AppConfig>;
  realStatsRef: LatestRef<RealMiningStats>;
  isMiningRef: LatestRef<boolean>;
  activeMiningSessionIdRef: LatestRef<number | null>;
  setIsMining: Dispatch<SetStateAction<boolean>>;
  setActiveMiningSessionId: Dispatch<SetStateAction<number | null>>;
  setMiningControlPending: Dispatch<SetStateAction<boolean>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setRealStats: Dispatch<SetStateAction<RealMiningStats>>;
  setLastShare: Dispatch<SetStateAction<string>>;
  setJackpotSequence: Dispatch<SetStateAction<JackpotSequenceSnapshot>>;
  appendDevLog: (source: "stratum", message: string) => void;
  appendPetLog: (message: string) => void;
  emitMiningEvent: (event: MiningEvent) => void;
}

export function useMiningEvents({
  runningInTauri,
  configRef,
  realStatsRef,
  isMiningRef,
  activeMiningSessionIdRef,
  setIsMining,
  setActiveMiningSessionId,
  setMiningControlPending,
  setErrorMessage,
  setRealStats,
  setLastShare,
  setJackpotSequence,
  appendDevLog,
  appendPetLog,
  emitMiningEvent,
}: UseMiningEventsOptions) {
  const lastConnectionNotificationRef = useRef(0);
  const isCurrentSession = (sessionId: number) => activeMiningSessionIdRef.current === sessionId;

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listenToMiningStats((event) => {
      if (!isCurrentSession(event.payload.session_id)) {
        return;
      }

      setRealStats((current) => {
        if (!isMiningRef.current) {
          if (
            event.payload.connection_status === "Stopped"
          ) {
            return { ...event.payload, hashrate: 0 };
          }

          return current;
        }

        if (event.payload.connection_status === "Stopped") {
          return current;
        }

        return {
          ...event.payload,
          accepted_shares: Math.max(current.accepted_shares, event.payload.accepted_shares),
          rejected_shares: Math.max(current.rejected_shares, event.payload.rejected_shares),
          stale_shares_dropped: Math.max(current.stale_shares_dropped, event.payload.stale_shares_dropped),
          queued_shares_dropped: Math.max(current.queued_shares_dropped, event.payload.queued_shares_dropped ?? 0),
        };
      });
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining stats: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, [
    activeMiningSessionIdRef,
    isMiningRef,
    runningInTauri,
    setErrorMessage,
    setIsMining,
    setRealStats,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listenToMiningLogs((event) => {
      const message = typeof event.payload === "string"
        ? event.payload
        : event.payload.message;
      appendDevLog("stratum", message);
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining logs: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, [
    appendDevLog,
    runningInTauri,
    setErrorMessage,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listenToMiningRuntimeEvents((event) => {
      const payload = event.payload;
      if (!isCurrentSession(payload.session_id)) {
        return;
      }

      if (!isMiningRef.current) {
        return;
      }

      const cleanMessage = "message" in payload
        ? cleanMiningLogMessage(payload.message)
        : "";
      const structuredState = reduceStructuredMiningEvents(
        createStructuredMiningEventState(realStatsRef.current),
        [structuredMiningEventFromRuntimePayload(payload)],
      );

      if (structuredState.petLogMessage) {
        appendPetLog(structuredState.petLogMessage);
      }

      if (structuredState.lastShare) {
        setLastShare(structuredState.lastShare);
      }

      if (
        structuredState.connectionStatus !== realStatsRef.current.connection_status ||
        structuredState.currentJobId !== realStatsRef.current.current_job_id
      ) {
        setRealStats((current) => ({
          ...current,
          current_job_id: structuredState.currentJobId ?? current.current_job_id,
          connection_status: structuredState.connectionStatus ?? current.connection_status,
        }));
      }

      if (structuredState.shareEventType) {
        emitMiningEvent(createShareEvent(structuredState.shareEventType, "cpu", cleanMessage));
      }

      if (structuredState.shareEventType === "share_accepted") {
        void notifyShareAccepted(notificationSettingsFromConfig(configRef.current)).catch(() => {});
      }

      if (structuredState.connectionErrorStatus) {
        const now = Date.now();
        if (now - lastConnectionNotificationRef.current > 60_000) {
          lastConnectionNotificationRef.current = now;
          void notifyConnectionError(
            notificationSettingsFromConfig(configRef.current),
            structuredState.connectionErrorStatus,
          ).catch(() => {});
        }
      }
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining events: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, [
    activeMiningSessionIdRef,
    appendDevLog,
    appendPetLog,
    configRef,
    emitMiningEvent,
    isMiningRef,
    realStatsRef,
    runningInTauri,
    setErrorMessage,
    setLastShare,
    setRealStats,
  ]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    listenToBlockFound((event) => {
      if (!isCurrentSession(event.payload.session_id)) {
        return;
      }

      const block = event.payload.block;
      const wasMining = isMiningRef.current;
      const structuredState = reduceStructuredMiningEvents(
        createStructuredMiningEventState(realStatsRef.current),
        [structuredMiningEventFromBlockCandidate(block)],
      );
      const engineKind: MiningEngineKind = "cpu";

      emitMiningEvent(createBlockCandidateEvent("cpu", block));
      emitMiningEvent(createJackpotEvent(block));
      appendDevLog("stratum", `Block candidate found: job=${block.job_id}, hash=${block.hash}`);
      setJackpotSequence(startJackpotSequence(block, wasMining, engineKind));

      if (wasMining && structuredState.jackpotPauseRequested) {
        isMiningRef.current = false;
        setIsMining(false);
        setRealStats((current) => ({
          ...current,
          hashrate: 0,
          connection_status: structuredState.connectionStatus ?? "Jackpot pause",
        }));
        setMiningControlPending(true);
        void stopRealMining()
          .then(() => setActiveMiningSessionId(null))
          .catch((error) => {
            appendDevLog("stratum", `Jackpot pause failed: ${formatError(error)}`);
          })
          .finally(() => {
            setMiningControlPending(false);
          });
      }

      void notifyJackpot(notificationSettingsFromConfig(configRef.current), {
        pool: block.pool,
        jobId: block.job_id,
        hash: block.hash,
        difficulty: block.difficulty,
        timestamp: block.timestamp,
      }).catch(() => {});
    })
      .then((cleanup) => {
        if (unmounted) { cleanup(); } else { unlisten = cleanup; }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for block candidate events: ${formatError(error)}`);
        }
      });

    return () => { unmounted = true; unlisten?.(); };
  }, [
    appendDevLog,
    activeMiningSessionIdRef,
    configRef,
    emitMiningEvent,
    isMiningRef,
    realStatsRef,
    runningInTauri,
    setActiveMiningSessionId,
    setErrorMessage,
    setIsMining,
    setJackpotSequence,
    setMiningControlPending,
    setRealStats,
  ]);
}
