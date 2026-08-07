import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  listenToMiningLogs,
  listenToMiningRuntimeEvents,
  listenToMiningStats,
  stopRealMining,
} from "../platform/tauri/miningClient";
import { miningLogMessageForActiveSession } from "../contracts/mining";
import {
  notifyConnectionError,
  notifyJackpot,
  notifyShareAccepted,
} from "../platform/tauri/notificationClient";
import type { MiningEvent } from "../domain/miningEvents";
import { effectsFromRuntimePayload } from "../domain/miningRuntimeEffects";
import {
  startJackpotSequence,
  type JackpotSequenceSnapshot,
} from "../domain/jackpotSequence";
import { formatError } from "../domain/formatting";
import type { AppConfig } from "../contracts/config";
import type { RealMiningStats } from "../contracts/mining";
import { notificationSettingsFromConfig } from "../domain/notificationSettings";

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
          if (event.payload.connection_status === "Stopped") {
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
        if (unmounted) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining stats: ${formatError(error)}`);
        }
      });

    return () => {
      unmounted = true;
      unlisten?.();
    };
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
      const message = miningLogMessageForActiveSession(
        event.payload,
        activeMiningSessionIdRef.current,
      );
      if (message === null) {
        return;
      }

      appendDevLog("stratum", message);
    })
      .then((cleanup) => {
        if (unmounted) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining logs: ${formatError(error)}`);
        }
      });

    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, [
    activeMiningSessionIdRef,
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

      const wasMining = isMiningRef.current;
      const effects = effectsFromRuntimePayload(payload, {
        wasMining,
        stats: realStatsRef.current,
      });

      if (payload.type !== "block_candidate" && !wasMining) {
        return;
      }

      for (const message of effects.petLogMessages) {
        appendPetLog(message);
      }

      for (const uiEvent of effects.uiEvents) {
        emitMiningEvent(uiEvent);
      }

      if (effects.lastShare) {
        setLastShare(effects.lastShare);
      }

      if (
        effects.connectionStatus !== realStatsRef.current.connection_status ||
        effects.currentJobId !== realStatsRef.current.current_job_id
      ) {
        setRealStats((current) => ({
          ...current,
          current_job_id: effects.currentJobId ?? current.current_job_id,
          connection_status: effects.connectionStatus ?? current.connection_status,
        }));
      }

      if (effects.devLogMessage) {
        appendDevLog("stratum", effects.devLogMessage);
      }

      if (effects.notifyShareAccepted) {
        void notifyShareAccepted(notificationSettingsFromConfig(configRef.current)).catch(() => {});
      }

      if (effects.connectionErrorMessage) {
        const now = Date.now();
        if (now - lastConnectionNotificationRef.current > 60_000) {
          lastConnectionNotificationRef.current = now;
          void notifyConnectionError(
            notificationSettingsFromConfig(configRef.current),
            effects.connectionErrorMessage,
          ).catch(() => {});
        }
      }

      if (payload.type === "block_candidate" && effects.blockCandidate) {
        const block = effects.blockCandidate;
        setJackpotSequence(startJackpotSequence(block, wasMining));

        if (effects.jackpotPauseRequested) {
          isMiningRef.current = false;
          setIsMining(false);
          setRealStats((current) => ({
            ...current,
            hashrate: 0,
            connection_status: effects.connectionStatus ?? "Jackpot pause",
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

        if (effects.notifyJackpot) {
          void notifyJackpot(notificationSettingsFromConfig(configRef.current), {
            pool: block.pool,
            jobId: block.job_id,
            hash: block.hash,
            difficulty: block.difficulty,
            timestamp: block.timestamp,
          }).catch(() => {});
        }
      }
    })
      .then((cleanup) => {
        if (unmounted) {
          cleanup();
        } else {
          unlisten = cleanup;
        }
      })
      .catch((error) => {
        if (runningInTauri) {
          setErrorMessage(`Could not listen for mining events: ${formatError(error)}`);
        }
      });

    return () => {
      unmounted = true;
      unlisten?.();
    };
  }, [
    activeMiningSessionIdRef,
    appendDevLog,
    appendPetLog,
    configRef,
    emitMiningEvent,
    isMiningRef,
    realStatsRef,
    runningInTauri,
    setActiveMiningSessionId,
    setErrorMessage,
    setIsMining,
    setJackpotSequence,
    setLastShare,
    setMiningControlPending,
    setRealStats,
  ]);
}
