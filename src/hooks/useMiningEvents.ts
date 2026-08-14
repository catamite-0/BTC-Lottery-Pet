import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  listenToMiningLogs,
  listenToMiningRuntimeEvents,
  listenToMiningStats,
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
  setErrorMessage,
  setRealStats,
  setLastShare,
  setJackpotSequence,
  appendDevLog,
  appendPetLog,
  emitMiningEvent,
}: UseMiningEventsOptions) {
  const lastConnectionNotificationRef = useRef(0);
  const pendingStatsRef = useRef<RealMiningStats | null>(null);
  const isCurrentSession = (sessionId: number) => activeMiningSessionIdRef.current === sessionId;

  const applyStatsPayload = (payload: RealMiningStats) => {
    setRealStats((current) => {
      if (!isMiningRef.current) {
        if (payload.connection_status === "Stopped") {
          return { ...payload, hashrate: 0 };
        }

        return current;
      }

      if (payload.connection_status === "Stopped") {
        return current;
      }

      return {
        ...payload,
        accepted_shares: Math.max(current.accepted_shares, payload.accepted_shares),
        rejected_shares: Math.max(current.rejected_shares, payload.rejected_shares),
        stale_shares_dropped: Math.max(current.stale_shares_dropped, payload.stale_shares_dropped),
        queued_shares_dropped: Math.max(current.queued_shares_dropped, payload.queued_shares_dropped ?? 0),
      };
    });
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let unmounted = false;

    const flushPendingStats = () => {
      if (document.visibilityState === "hidden") {
        return;
      }

      const pending = pendingStatsRef.current;
      if (!pending) {
        return;
      }

      pendingStatsRef.current = null;
      applyStatsPayload(pending);
    };

    listenToMiningStats((event) => {
      if (!isCurrentSession(event.payload.session_id)) {
        return;
      }

      if (document.visibilityState === "hidden") {
        pendingStatsRef.current = event.payload;
        return;
      }

      applyStatsPayload(event.payload);
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

    document.addEventListener("visibilitychange", flushPendingStats);

    return () => {
      unmounted = true;
      document.removeEventListener("visibilitychange", flushPendingStats);
      unlisten?.();
    };
  }, [
    activeMiningSessionIdRef,
    isMiningRef,
    runningInTauri,
    setErrorMessage,
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
    setErrorMessage,
    setJackpotSequence,
    setLastShare,
    setRealStats,
  ]);
}
